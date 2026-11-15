import json
import logging
import secrets

import google.generativeai as genai
import requests
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from .r2 import R2NotConfigured, get_r2_client

log = logging.getLogger(__name__)

# Include the user's name only occasionally, not in every tip: otherwise it feels repetitive.
NAME_CHANCE = 0.35

GEMINI_PROMPTS = {
    "es": (
        "Eres un experto nutricional. Recibes un JSON con alimentos, sus gramos calculados y sus "
        "macronutrientes basados en datos del USDA. Tu objetivo es dar un consejo ultra-conciso "
        "(máximo 3 oraciones) sobre este plato. No recalcules las calorías, asume que los datos son "
        "exactos. Enfócate en el impacto metabólico (ej. picos de glucosa, saciedad, balance). "
        "Tono directo y amigable. Responde siempre en español y no repitas el JSON."
    ),
    "en": (
        "You are a nutrition expert. You receive a JSON with foods, their estimated grams and their "
        "USDA-based macros. Give an ultra-concise tip (max 3 sentences) about this plate. Do not "
        "recalculate calories, assume the data is exact. Focus on the metabolic impact (e.g. glucose "
        "spikes, satiety, balance). Direct, friendly tone. Always answer in English and do not repeat "
        "the JSON."
    ),
}


def prompt_for(locale: str, name: str | None = None) -> str:
    """Return the prompt in the requested language; any unknown locale falls back to Spanish.

    `name` is only passed when personalizing (see `pick_name`) so the assistant does not
    repeat the user's name in every tip.
    """
    is_en = (locale or "").lower().startswith("en")
    base = GEMINI_PROMPTS["en" if is_en else "es"]
    if not name:
        return base
    if is_en:
        return f"{base} You may address the user as {name} once, naturally; skip it if it does not fit."
    return f"{base} Puedes dirigirte al usuario como {name} una sola vez, de forma natural; si no encaja, no lo menciones."


def pick_name(first_name: str) -> str | None:
    """First name for the greeting, used occasionally; None most of the time."""
    name = (first_name or "").strip().split(" ")[0][:40]
    if not name or (secrets.randbelow(100) / 100.0) >= NAME_CHANCE:
        return None
    return name


class ServiceError(Exception):
    """External service failure (Modal / R2)."""


# ---------------------------------------------------------------- R2 + Modal
def download_image_from_r2(key: str) -> tuple[bytes, str]:
    """Download the object into memory (nothing is written to disk). Returns (bytes, content_type)."""
    try:
        obj = get_r2_client().get_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        return obj["Body"].read(), obj.get("ContentType", "image/jpeg")
    except R2NotConfigured as exc:
        raise ServiceError(str(exc)) from exc
    except (ClientError, BotoCoreError) as exc:
        raise ServiceError(f"No se pudo leer la imagen en R2: {exc}") from exc


def run_inference(
    image_bytes: bytes,
    content_type: str,
    pipeline: str = "B",
    fov_deg: float | None = None,
    f35_mm: float | None = None,
    depth_model: str = "small",
) -> dict:
    """Send the image to the Modal endpoint with the X-Modal-Secret header.

    `f35_mm` is the 35 mm equivalent focal length read from EXIF in the browser: the
    upload is recompressed (without EXIF), so the pipeline cannot read it on its own.
    `depth_model` selects the Depth Anything V2 variant ("small" or "large").
    """
    params = {"pipeline": pipeline, "depth_model": depth_model}
    if fov_deg is not None:
        params["fov_deg"] = fov_deg
    if f35_mm is not None:
        params["f35_mm"] = f35_mm
    try:
        resp = requests.post(
            settings.MODAL_ENDPOINT_URL,
            params=params,
            headers={"X-Modal-Secret": settings.MODAL_SHARED_SECRET},
            files={"file": ("image", image_bytes, content_type)},
            timeout=settings.MODAL_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as exc:
        raise ServiceError(f"Fallo en la inferencia (Modal): {exc}") from exc


# ---------------------------------------------------------------- Gemini
def get_nutrition_advice(
    inference: dict, locale: str = "es", user_name: str | None = None, timeout_s: int = 10
) -> str:
    """Return Gemini's nutrition tip; returns '' on any failure (never blocks saving the log)."""
    if not inference.get("alimentos") or not settings.GEMINI_API_KEY:
        return ""
    # Only what is relevant for the LLM.
    payload = {
        "alimentos": [
            {
                "nombre": f["nombre"],
                "peso_g": f["peso_g"],
                **{k: v for k, v in f["nutricion"].items() if k != "por_100g"},
            }
            for f in inference["alimentos"]
        ],
        "totales": {k: v for k, v in inference["totales"].items() if k != "clases_detectadas"},
    }
    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        payload_json = json.dumps(payload, ensure_ascii=False)
        # The configured model may be overloaded (we saw timeouts with `gemini-flash-latest`):
        # try it first, then fall back to the lite variant, which is fast and sufficient.
        models = [settings.GEMINI_MODEL, "gemini-flash-lite-latest"]
        for name in dict.fromkeys(m for m in models if m):
            try:
                model = genai.GenerativeModel(name, system_instruction=prompt_for(locale, user_name))
                resp = model.generate_content(
                    payload_json,
                    generation_config={"temperature": 0.4, "max_output_tokens": 200},
                    # Without this, the SDK can hang and block the entire POST request.
                    request_options={"timeout": timeout_s},
                )
                text = (resp.text or "").strip()
                if text:
                    return text
            except Exception:  # noqa: BLE001
                log.warning("Gemini did not respond with %s; trying next model", name)
        return ""
    except Exception:  # SDK raises various errors (safety block, quota, network...)
        log.exception("Gemini unavailable")
        return ""

