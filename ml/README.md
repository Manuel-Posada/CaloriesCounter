# Inference Pipeline (Modal)

```
ml/
├── modal_app.py            # Modal app: container image, FoodInference class, POST endpoint
├── run_local.py            # Run the pipeline locally (without Modal)
├── data/                   # Place nutrition_wide_densidad.csv here
├── samples/                # Sample test images
├── pipeline/
│   ├── config.py           # Paths, model IDs, thresholds
│   ├── segmentation.py     # YoloSegmenter (A) · Mask2FormerSegmenter (B)
│   ├── classification.py   # InceptionV4Classifier (B)
│   ├── depth.py            # Depth Anything V2 (metric, meters)
│   ├── volume.py           # Depth + mask -> cm³ (pure NumPy)
│   ├── nutrition.py        # CSV -> grams -> kcal / macros (pure Python)
│   └── runner.py           # A/B pipeline orchestrator
└── tests/test_core.py      # Volume, overlay, and nutrition unit tests (no GPU)
```

## Deploying to Modal

Requirements: Modal account, `ml/data/nutrition_wide_densidad.csv`, and the three model weight files in the repository root (`*.pt` files are **not** tracked in Git; they go into a Modal Volume).

```bash
cd ml
pip install -r requirements.txt
modal setup                       # or `modal token new`

# 1. Create Volume with custom weights (mounted at /models/<filename>)
modal volume create caloriescounter-models
modal volume put caloriescounter-models ../yolo26_seg_food323.pt /yolo26_seg_food323.pt
modal volume put caloriescounter-models ../inception_v4_food323.pt /inception_v4_food323.pt
modal volume put caloriescounter-models ../mask2former_agnostic.pt /mask2former_agnostic.pt

# 2. Shared secret with Django (same value in backend/.env)
modal secret create caloriescounter-modal MODAL_SHARED_SECRET=<long-random-string>

# 3. Deploy
modal deploy modal_app.py
```

`modal deploy` outputs the endpoint URL:
`https://<workspace>--calories-counter-inference-foodinference-predict.modal.run`.
Add it to `backend/.env` along with the shared secret:

```dotenv
MODAL_ENDPOINT_URL=https://<workspace>--calories-counter-inference-foodinference-predict.modal.run
MODAL_SHARED_SECRET=<same-secret>
```

Django sends the secret in the `X-Modal-Secret` header; Modal returns `401` if missing or mismatched, so **the endpoint is not publicly callable**.

Notes:

- The first `modal deploy` builds the image (PyTorch + Transformers) and takes several minutes.
- `_download_hf_models()` bakes Depth Anything V2 and the Mask2Former config into the image so cold starts do not download weights.
- Runs on an `A10G` GPU with `scaledown_window=300` (scales to zero after 5 minutes of inactivity).
- For live-reload development: `modal serve modal_app.py` (temporary URL).
- `CORS_ALLOWED_ORIGINS` only affects direct browser requests; Django calls Modal server-to-server.
- When updating pipeline code, just re-run `modal deploy`; Volume weights remain untouched.

## Local Execution (without Modal)

```powershell
cd ml
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # CPU-only
pip install transformers timm pillow opencv-python-headless numpy pytest

# Pipeline B: mask2former_agnostic.pt + inception_v4_food323.pt
python run_local.py ..\my_plate.jpg --pipeline B

# Pipeline A: yolo26_seg_food323.pt
pip install "ultralytics>=8.4.0"
python run_local.py ..\my_plate.jpg --pipeline A
```

`run_local.py` loads weights from the repository root by default; override via `MODELS_DIR`, `MASK2FORMER_WEIGHTS`, `INCEPTION_WEIGHTS`, `YOLO_WEIGHTS`, `DEPTH_MODEL_ID`, and `NUTRITION_CSV`.

> **Depth model:** The default is the *Small* variant (`DEPTH_MODEL_ID`), which is validated end-to-end. The *Large* variant overestimates close-up distance—on `samples/pizza.jpg` it predicts 1.8 m where the true distance is ~0.4 m, inflating volume (200 L instead of 0.17 L). You can test it with `--depth-size large`, though without calibration it is not production-ready and adds ~1.3 GB.

```powershell
python run_local.py ..\my_plate.jpg --pipeline B `
  --depth-model depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf
```

## API Usage

```bash
curl -X POST "https://<workspace>--calories-counter-inference-foodinference-predict.modal.run?pipeline=B" \
     -F "file=@plate.jpg"
```

Query parameters: `pipeline=A|B` (default `B`: Mask2Former + Inception; `A` is YOLO26-seg), `fov_deg` (horizontal camera FOV; falls back to EXIF `FocalLengthIn35mmFilm`, then 65°), and `f35_mm` (35 mm equivalent focal length extracted client-side before recompression).

Response summary (JSON contract keys are preserved across `ml/`, `backend/`, and `frontend/`):

```json
{
  "alimentos": [{
    "idx": 12, "nombre": "arroz", "nombre_es": "arroz", "confianza": 0.91,
    "volumen_cm3": 210.4, "peso_g": 178.84, "densidad_g_cm3": 0.85, "densidad_asumida": false,
    "poligono": [[0.35,0.52],[0.38,0.28],[0.61,0.24],[0.66,0.55],[0.52,0.71]],
    "centroide": [0.50, 0.46],
    "nutricion": {
      "calorias_kcal": 232.5, "proteinas_g": 4.83, "carbohidratos_g": 50.08, "grasas_g": 0.54,
      "por_100g": {"calorias_kcal": 130, "proteinas_g": 2.7, "carbohidratos_g": 28, "grasas_g": 0.3}
    }
  }],
  "totales": {"volumen_cm3": 210.4, "peso_g": 178.84, "calorias_kcal": 232.5, "proteinas_g": 4.83,
              "carbohidratos_g": 50.08, "grasas_g": 0.54, "clases_detectadas": [12]},
  "angulo_camara_deg": 4.2,
  "advertencias": []
}
```

`totales` maps 1:1 to Django's `FoodLog` (`clases_detectadas`, `calorias_totales`, `volumen_estimado`, `macronutrientes`).
`poligono` is the outer mask contour (up to 40 points, normalized 0..1 coordinates) and `centroide` is its center for frontend SVG rendering.
`nutricion.por_100g` returns raw per-100 g values from the catalog.
`angulo_camara_deg` is camera tilt from vertical estimated via the support plane normal (`0` = zenithal; `null` if no segment yielded a reliable plane). Exceeding `TILT_WARN_DEG` (default 15°) adds a warning without blocking inference.

## Tests

```bash
pip install numpy opencv-python-headless pillow pytest
pytest
```

## Assumptions to Validate

- **CSV:** Nutritional columns must match expected headers; density column is auto-detected (`densidad`/`density`/contains `dens`); `idx` and name use alias matching (`idx`, `clase`, `nombre`, etc.). Must contain exactly 323 rows or container startup fails.
- **Scale:** Volume depends on metric depth and focal length. Calibrate against objects of known volume.
- **Inception-V4 preprocessing:** Uses `timm` default transforms; must match training preprocessing.
- **Mask2Former:** `mask2former_agnostic.pt` loads onto the architecture inferred from its Swin encoder (`class_predictor` labels are ignored for class-agnostic segmentation). Falls back to Hugging Face `MASK2FORMER_ID` if no checkpoint is provided.
