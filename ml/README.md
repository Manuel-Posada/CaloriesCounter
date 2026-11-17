# Inference Pipeline (Modal)

```
ml/
├── modal_app.py            # Modal app: image, FoodInference class, POST endpoint
├── run_local.py            # Run the pipeline locally (no Modal)
├── data/                   # <- place nutrition_wide_densidad.csv here
├── samples/                # test images
├── pipeline/
│   ├── config.py           # paths, model IDs, thresholds
│   ├── segmentation.py     # YoloSegmenter (A) · Mask2FormerSegmenter (B)
│   ├── classification.py   # InceptionV4Classifier (B)
│   ├── depth.py            # Depth Anything V2 (metric, in meters)
│   ├── volume.py           # depth + mask -> cm³ (pure numpy)
│   ├── nutrition.py        # CSV -> grams -> kcal / macros (pure Python)
│   └── runner.py           # A/B orchestrator
└── tests/test_core.py      # volume and nutrition (no GPU needed)
```

## Deploying to Modal

Requirements: a Modal account, `ml/data/nutrition_wide_densidad.csv`, and the three weight files at the
repo root (`*.pt` files are **not** versioned: they go into the Volume).

```bash
cd ml
pip install -r requirements.txt
modal setup                       # or `modal token new`

# 1. Volume with your own weights (paths are /models/<file>)
modal volume create caloriescounter-models
modal volume put caloriescounter-models ../yolo26_seg_food323.pt /yolo26_seg_food323.pt
modal volume put caloriescounter-models ../inception_v4_food323.pt /inception_v4_food323.pt
modal volume put caloriescounter-models ../mask2former_agnostic.pt /mask2former_agnostic.pt

# 2. Secret shared with Django (same value in backend/.env)
modal secret create caloriescounter-modal MODAL_SHARED_SECRET=<long-random-string>

# 3. Deploy
modal deploy modal_app.py
```

`modal deploy` prints the endpoint URL:
`https://<workspace>--calories-counter-inference-foodinference-predict.modal.run`.
Paste it into `backend/.env` along with the same secret:

```dotenv
MODAL_ENDPOINT_URL=https://<workspace>--calories-counter-inference-foodinference-predict.modal.run
MODAL_SHARED_SECRET=<the same string>
```

Django sends the secret in the `X-Modal-Secret` header; Modal responds with 401 if it is missing or
doesn't match, so **the endpoint cannot be used from the outside**.

Notes:

- The first `modal deploy` builds the image (torch + transformers), which takes several minutes.
- `_download_hf_models()` bakes Depth Anything V2 and the Mask2Former configuration into the image,
  so cold starts never download weights.
- GPU is an `A10G`; the class sets `scaledown_window=300`, so it shuts down after 5 minutes of inactivity.
- For development with hot reload: `modal serve modal_app.py` (temporary URL).
- `CORS_ALLOWED_ORIGINS` only affects direct calls from the browser; Django calls from the server,
  so it isn't needed for the app.
- When you change pipeline code, just run `modal deploy` again; the weights in the Volume are untouched.

## Local Testing (no Modal)

```powershell
cd ml
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # no GPU
pip install transformers timm pillow opencv-python-headless numpy pytest

# Pipeline B: mask2former_agnostic.pt + inception_v4_food323.pt
python run_local.py ..\my_plate.jpg --pipeline B

# Pipeline A: yolo26_seg_food323.pt
pip install "ultralytics>=8.4.0"
python run_local.py ..\my_plate.jpg --pipeline A
```

`run_local.py` loads the weights from the repo root; you can override them with
`MODELS_DIR`, `MASK2FORMER_WEIGHTS`, `INCEPTION_WEIGHTS`, `YOLO_WEIGHTS`, `DEPTH_MODEL_ID`
and `NUTRITION_CSV`.

> **Depth model:** the default is the *Small* variant (`DEPTH_MODEL_ID`), which is the one validated
> end to end. The *Large* variant overestimates distance in close-ups (in `samples/pizza.jpg` it
> estimates 1.8 m where the real distance is ~0.4 m), and the volume blows up (200 L instead of
> 0.17 L). You can try it with `--depth-model ...-Large-hf`, but uncalibrated it is not suitable for
> production. It is also slower and weighs ~1.3 GB more.

```powershell
python run_local.py ..\my_plate.jpg --pipeline B `
  --depth-model depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf
```

## Usage

```bash
curl -X POST "https://<workspace>--calories-counter-inference-foodinference-predict.modal.run?pipeline=B" \
     -F "file=@plate.jpg"
```

Parameters:

- `pipeline=A|B`: defaults to `B` (Mask2Former + Inception); `A` is YOLO26-seg.
- `fov_deg`: the camera's horizontal FOV. If omitted, the EXIF `FocalLengthIn35mmFilm` is used, and if that is missing, 65°.
- `f35_mm`: the 35 mm-equivalent focal length read from EXIF in the browser, for uploads that arrive recompressed without metadata.

Response (abridged):

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

- `totales` maps 1:1 to Django's `FoodLog` (`clases_detectadas`, `calorias_totales`, `volumen_estimado`, `macronutrientes`).
- `poligono` is the outer contour of the mask (at most 40 points, coordinates normalized to 0..1 over the image)
  and `centroide` is its center: the frontend uses them to draw the zone and its label over the photo.
- `nutricion.por_100g` holds the table values as-is, so the user can look them up.
- `angulo_camara_deg` is the camera's tilt from the vertical, estimated from the support-plane normal:
  `0` = top-down. It is `null` when no segment yielded a reliable plane (a `0` is never made up). If it exceeds
  `TILT_WARN_DEG` (15° by default) a warning is added, but inference is not blocked.

## Tests

```bash
pip install numpy opencv-python-headless pytest
pytest
```

## Assumptions to Validate

- **CSV**: nutritional columns with the exact names from the spec; the density column is auto-detected
  (`densidad` / `density` / any column containing "dens"); `idx` and name are detected by alias (`idx`, `clase`, `nombre`…),
  and if there is no `idx`, row order is used. It must have exactly 323 rows or the container fails on startup.
- **Scale**: volume depends on metric depth and focal length. Calibrate with objects of known volume.
- **Inception-V4 preprocessing**: the default `timm` preprocessing; it must match your training setup.
- **Mask2Former**: `mask2former_agnostic.pt` is loaded onto the architecture inferred from its Swin encoder
  (the `class_predictor` class is ignored because segmentation is class-agnostic). Without a checkpoint, the
  Hugging Face `MASK2FORMER_ID` is used.