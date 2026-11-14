"""CaloriesCounter inference pipeline on Modal.

Deploy (from ml/):   modal deploy modal_app.py
Dev with hot-reload: modal serve modal_app.py

POST multipart/form-data  field `file` = image
Query params:  pipeline=A|B (default B) · fov_deg=<horizontal FOV in degrees> (optional)
               · f35_mm=<35mm-equivalent focal length from EXIF> (optional)
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

if modal.is_local() and not NUTRITION_CSV_LOCAL.exists():
    # Checked only on the deploying machine: inside the build container the module is
    # imported from /root and the CSV is not copied yet (it is added further down).
    raise FileNotFoundError(f"Missing {NUTRITION_CSV_LOCAL}. Copy nutrition_wide_densidad.csv here before deploying.")


def _download_hf_models():
    """Run during image build: bake HF weights in to avoid slow cold starts."""
    from pipeline import config
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation, Mask2FormerConfig

    AutoImageProcessor.from_pretrained(config.DEPTH_MODEL_SMALL_ID)
    AutoModelForDepthEstimation.from_pretrained(config.DEPTH_MODEL_SMALL_ID)
    AutoImageProcessor.from_pretrained(config.DEPTH_MODEL_LARGE_ID)
    AutoModelForDepthEstimation.from_pretrained(config.DEPTH_MODEL_LARGE_ID)
    # For Mask2Former only preprocessing and architecture are needed: weights come
    # from the Volume (mask2former_agnostic.pt).
    AutoImageProcessor.from_pretrained(config.MASK2FORMER_ID)
    Mask2FormerConfig.from_pretrained(config.MASK2FORMER_ID)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "torch",
        "torchvision",
        "ultralytics>=8.4.0",  # first series with YOLO26
        "transformers",
        "accelerate",
        "timm",
        "scipy",  # required by Mask2FormerLoss (transformers >= 5)
        "opencv-python-headless",
        "numpy",
        "pillow",
        "fastapi[standard]",
        "python-multipart",
    )
    .env({"HF_HOME": "/cache/hf", "CORS_ALLOWED_ORIGINS": CORS_ALLOWED_ORIGINS})
    # add_local_* must go at the end of the chain. Package goes before HF build.
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
    # modal secret create caloriescounter-modal MODAL_SHARED_SECRET=<same value as in Django>
    secrets=[modal.Secret.from_name("caloriescounter-modal")],
    scaledown_window=300,
    timeout=120,
)
class FoodInference:
    @modal.enter()
    def load(self):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        nutrition = NutritionTable.load(config.NUTRITION_CSV)  # 323 classes, fail fast on mismatch
        depth_estimators = {
            "small": DepthEstimator(config.DEPTH_MODEL_SMALL_ID, device),
        }
        try:
            depth_estimators["large"] = DepthEstimator(config.DEPTH_MODEL_LARGE_ID, device)
        except Exception as exc:
            print(f"Warning: Depth Large not initialized ({exc})")

        yolo = YoloSegmenter(config.YOLO_WEIGHTS, device, config.YOLO_CONF, config.YOLO_IMGSZ)
        m2f = Mask2FormerSegmenter(
            config.MASK2FORMER_ID, device, config.MASK2FORMER_THRESHOLD, config.MASK2FORMER_WEIGHTS
        )
        inception = InceptionV4Classifier(config.INCEPTION_WEIGHTS, config.NUM_CLASSES, device)

        self.pipeline = FoodPipeline(
            strategies={"A": build_strategy_a(yolo), "B": build_strategy_b(m2f, inception)},
            depth=depth_estimators,
            nutrition=nutrition,
        )

    # `@modal.web_endpoint` was renamed to `@modal.fastapi_endpoint` (same behavior).
    @modal.fastapi_endpoint(method="POST", docs=False)
    def predict(
        self,
        request: Request,
        file: UploadFile,
        pipeline: str = "B",
        depth_model: str = "small",
        fov_deg: float | None = None,
        f35_mm: float | None = None,
        x_modal_secret: str | None = Header(default=None),
    ):
        # Only Django knows the secret; constant-time comparison.
        expected = os.environ.get("MODAL_SHARED_SECRET", "")
        if not expected or not hmac.compare_digest(x_modal_secret or "", expected):
            return JSONResponse({"detail": "No autorizado"}, status_code=401)

        pipeline = pipeline.upper()
        if pipeline not in ("A", "B"):
            return _reply(request, {"detail": "pipeline debe ser 'A' o 'B'"}, 400)

        depth_model = depth_model.lower()
        if depth_model not in ("small", "large"):
            depth_model = "small"

        raw = file.file.read(config.MAX_UPLOAD_BYTES + 1)
        if len(raw) > config.MAX_UPLOAD_BYTES:
            return _reply(request, {"detail": "Imagen demasiado grande (máx. 10 MB)"}, 413)
        try:
            img, f35 = load_image(raw)
        except Exception:
            return _reply(request, {"detail": "No se pudo decodificar la imagen"}, 400)

        # File EXIF takes precedence; if the upload was recompressed (no EXIF), use the
        # focal length read from the original by the browser.
        if f35 is None:
            f35 = f35_mm

        try:
            result = self.pipeline.run(
                img, pipeline, fov_deg=fov_deg, f35_mm=f35, depth_model=depth_model
            )
        except ValueError as exc:  # e.g. fov_deg out of range
            return _reply(request, {"detail": str(exc)}, 400)
        return _reply(request, result)
