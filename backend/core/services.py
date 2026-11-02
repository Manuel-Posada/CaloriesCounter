import json
import logging
import random

import google.generativeai as genai
import requests
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from .r2 import R2NotConfigured, get_r2_client

log = logging.getLogger(__name__)

# El nombre del usuario aparece de vez en cuando, no en cada consejo: cansa y suena artificial.
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
    """Prompt en el idioma pedido; cualquier idioma desconocido cae a español.

    `name` solo se pasa cuando toca personalizar (ver `pick_name`): así el asistente no
    repite el nombre en cada consejo.
    """
    is_en = (locale or "").lower().startswith("en")
    base = GEMINI_PROMPTS["en" if is_en else "es"]
    if not name:
        return base
    if is_en:
        return f"{base} You may address the user as {name} once, naturally; skip it if it does not fit."
    return f"{base} Puedes dirigirte al usuario como {name} una sola vez, de forma natural; si no encaja, no lo menciones."


def pick_name(first_name: str) -> str | None:
    """Nombre de pila para el saludo, solo a veces; None la mayoría de las veces."""
    name = (first_name or "").strip().split(" ")[0][:40]
    if not name or random.random() >= NAME_CHANCE:
        return None
    return name


class ServiceError(Exception):
    """Fallo de un servicio externo (Modal / R2)."""


# ---------------------------------------------------------------- R2 + Modal
def download_image_from_r2(key: str) -> tuple[bytes, str]:
    """Descarga el objeto a memoria (nada se escribe en disco). Devuelve (bytes, content_type)."""
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
) -> dict:
    """Envía la imagen al endpoint de Modal con el header X-Modal-Secret.

    `f35_mm` es la focal equivalente en 35 mm leída del EXIF en el navegador: la subida
    va recomprimida (sin EXIF), así que el pipeline no puede leerla por su cuenta.
    """
    params = {"pipeline": pipeline}
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
    """Devuelve el consejo de Gemini; ante cualquier fallo devuelve '' (no bloquea el registro)."""
    if not inference.get("alimentos") or not settings.GEMINI_API_KEY:
        return ""
    # Solo lo relevante para el LLM.
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
        # El modelo configurado puede estar saturado (vimos timeouts con `gemini-flash-latest`):
        # se intenta primero ese y, si falla, la variante lite, que es rápida y suficiente.
        models = [settings.GEMINI_MODEL, "gemini-flash-lite-latest"]
        for name in dict.fromkeys(m for m in models if m):
            try:
                model = genai.GenerativeModel(name, system_instruction=prompt_for(locale, user_name))
                resp = model.generate_content(
                    payload_json,
                    generation_config={"temperature": 0.4, "max_output_tokens": 200},
                    # Sin esto el SDK puede quedarse esperando y bloquear el POST completo.
                    request_options={"timeout": timeout_s},
                )
                text = (resp.text or "").strip()
                if text:
                    return text
            except Exception:  # noqa: BLE001
                log.warning("Gemini no respondió con %s; se prueba el siguiente", name)
        return ""
    except Exception:  # SDK lanza varios tipos (bloqueo de seguridad, cuota, red...)
        log.exception("Gemini no disponible")
        return ""

