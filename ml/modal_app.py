"""Pipeline de inferencia de CaloriesCounter en Modal.

Deploy (desde ml/):   modal deploy modal_app.py
Dev con hot-reload:    modal serve modal_app.py

POST multipart/form-data  campo `file` = imagen
Query params:  pipeline=A|B (default B) · fov_deg=<FOV horizontal en grados> (opcional)
               · f35_mm=<focal equivalente 35 mm del EXIF> (opcional)
"""
import hmac
import os
from pathlib import Path

import modal
from fastapi import Header, Request, UploadFile
from fastapi.responses import JSONResponse

HERE = Path(__file__).parent
NUTRITION_CSV_LOCAL = HERE / "data" / "nutrition_wide_densidad.csv"
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:4200")

if not NUTRITION_CSV_LOCAL.exists():
    raise FileNotFoundError(f"Falta {NUTRITION_CSV_LOCAL}. Copia aquí nutrition_wide_densidad.csv antes de desplegar.")


def _download_hf_models():
    """Se ejecuta en el build de la imagen: hornea los pesos de HF para evitar cold starts lentos."""
    from pipeline import config
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation, Mask2FormerConfig

    AutoImageProcessor.from_pretrained(config.DEPTH_MODEL_ID)
    AutoModelForDepthEstimation.from_pretrained(config.DEPTH_MODEL_ID)
    # De Mask2Former sólo hace falta el preprocesado y la arquitectura: los pesos
    # salen del Volume (mask2former_agnostic.pt).
    AutoImageProcessor.from_pretrained(config.MASK2FORMER_ID)
    Mask2FormerConfig.from_pretrained(config.MASK2FORMER_ID)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "torch",
        "torchvision",
        "ultralytics>=8.4.0",  # primera serie con YOLO26
        "transformers",
        "accelerate",
        "timm",
        "scipy",  # Mask2FormerLoss (transformers >= 5) lo exige
        "opencv-python-headless",
        "numpy",
        "pillow",
        "fastapi[standard]",
        "python-multipart",
    )
    .env({"HF_HOME": "/cache/hf", "CORS_ALLOWED_ORIGINS": CORS_ALLOWED_ORIGINS})
    # add_local_* deben ir al final de la cadena. El paquete va antes del build de HF.
    .add_local_python_source("pipeline", copy=True)
    .run_function(_download_hf_models)
    .add_local_file(NUTRITION_CSV_LOCAL, "/data/nutrition_wide_densidad.csv")
)

app = modal.App("calories-counter-inference")
models_volume = modal.Volume.from_name("caloriescounter-models", create_if_missing=True)

with image.imports():
    import torch
    from pipeline import config
    from pipeline.classification import InceptionV4Classifier
    from pipeline.depth import DepthEstimator
    from pipeline.imaging import load_image
    from pipeline.nutrition import NutritionTable
    from pipeline.runner import FoodPipeline, build_strategy_a, build_strategy_b
    from pipeline.segmentation import Mask2FormerSegmenter, YoloSegmenter


def _cors_headers(request: Request) -> dict:
    allowed = {o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()}
    origin = request.headers.get("origin")
    if origin and ("*" in allowed or origin in allowed):
        return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
    return {}


def _reply(request: Request, payload: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(payload, status_code=status, headers=_cors_headers(request))


@app.cls(
    image=image,
    gpu="A10G",
    volumes={"/models": models_volume},
    # modal secret create caloriescounter-modal MODAL_SHARED_SECRET=<mismo valor que en Django>
    secrets=[modal.Secret.from_name("caloriescounter-modal")],
    scaledown_window=300,
    timeout=120,
)
class FoodInference:
    @modal.enter()
    def load(self):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        nutrition = NutritionTable.load(config.NUTRITION_CSV)  # 323 clases, falla rápido si no cuadra
        depth = DepthEstimator(config.DEPTH_MODEL_ID, device)

        yolo = YoloSegmenter(config.YOLO_WEIGHTS, device, config.YOLO_CONF, config.YOLO_IMGSZ)
        m2f = Mask2FormerSegmenter(
            config.MASK2FORMER_ID, device, config.MASK2FORMER_THRESHOLD, config.MASK2FORMER_WEIGHTS
        )
        inception = InceptionV4Classifier(config.INCEPTION_WEIGHTS, config.NUM_CLASSES, device)

        self.pipeline = FoodPipeline(
            strategies={"A": build_strategy_a(yolo), "B": build_strategy_b(m2f, inception)},
            depth=depth,
            nutrition=nutrition,
        )

    # `@modal.web_endpoint` fue renombrado a `@modal.fastapi_endpoint` (mismo comportamiento).
    @modal.fastapi_endpoint(method="POST", docs=False)
    def predict(
        self,
        request: Request,
        file: UploadFile,
        pipeline: str = "B",
        fov_deg: float | None = None,
        f35_mm: float | None = None,
        x_modal_secret: str | None = Header(default=None),
    ):
        # Solo Django conoce el secreto; comparación en tiempo constante.
        expected = os.environ.get("MODAL_SHARED_SECRET", "")
        if not expected or not hmac.compare_digest(x_modal_secret or "", expected):
            return JSONResponse({"detail": "No autorizado"}, status_code=401)

        pipeline = pipeline.upper()
        if pipeline not in ("A", "B"):
            return _reply(request, {"detail": "pipeline debe ser 'A' o 'B'"}, 400)

        raw = file.file.read(config.MAX_UPLOAD_BYTES + 1)
        if len(raw) > config.MAX_UPLOAD_BYTES:
            return _reply(request, {"detail": "Imagen demasiado grande (máx. 10 MB)"}, 413)
        try:
            img, f35 = load_image(raw)
        except Exception:
            return _reply(request, {"detail": "No se pudo decodificar la imagen"}, 400)

        # El EXIF del fichero manda; si la subida viene recomprimida (sin EXIF), se usa la
        # focal que el navegador leyó del original.
        if f35 is None:
            f35 = f35_mm

        try:
            result = self.pipeline.run(img, pipeline, fov_deg=fov_deg, f35_mm=f35)
        except ValueError as exc:  # p. ej. fov_deg fuera de rango
            return _reply(request, {"detail": str(exc)}, 400)
        return _reply(request, result)
