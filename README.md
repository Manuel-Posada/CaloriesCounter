# Calorie Counter: A Decoupled Modular Pipeline for Monocular 3D Food Portion Estimation and Grounded LLM Nutritional Guidance

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Angular](https://img.shields.io/badge/Angular-20-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![Django](https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.x-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Modal](https://img.shields.io/badge/Deployment-Modal_GPU_A10G-00FF66)](https://modal.com/)
[![Gemini](https://img.shields.io/badge/LLM-Gemini_Flash_Lite-8E75B2?logo=google-gemini&logoColor=white)](https://ai.google.dev/)

**Calorie Counter** is a decoupled, intelligent system that estimates the 3D volume and nutritional content of food from a **single smartphone photo**, taken in real-world, uncontrolled environments.

The project tackles two well-known problems: the arithmetic hallucinations of end-to-end multimodal models, and the hardware constraints of RGB-D/LiDAR-based systems. It does so with a **four-stage decoupled pipeline**:

1. **Visual perception**: instance-level segmentation and classification.
2. **Metric monocular depth and 3D volume estimation.**
3. **Standardized gravimetric and nutritional mapping** (USDA FoodData Central).
4. **LLM-guided metabolic reasoning** (Google Gemini Flash Lite).

The key design principle: **every number is computed deterministically; the LLM only interprets them.** It never performs arithmetic, so it cannot hallucinate it.

---

## 🏗️ System Architecture

```
[ Smartphone Photo ]
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. VISUAL PERCEPTION (Instance-first)                                  │
│    • Pipeline B (Production / Decoupled):                              │
│        Mask2Former Swin-Tiny (class-agnostic) ──> Crops ──> Inception-V4│
│    • Pipeline A (Lightweight / Joint):                                 │
│        YOLO26-seg (segmentation + classification in a single pass)     │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ 2D masks + classes
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. METRIC DEPTH AND 3D VOLUME                                          │
│    • Metric depth: Depth Anything V2 (Metric Indoor Small / Large)     │
│    • Scale calibration: plate detection (circular Hough + f_px)        │
│    • 3D geometry: table-plane fitting with RANSAC                      │
│    • Integration: height h above plane × differential area (cm³)       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Apparent volume V (cm³)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. GRAVIMETRIC AND NUTRITIONAL MAPPING (Deterministic)                 │
│    • Apparent density ρ (g/cm³) calibrated for 323 classes             │
│    • Computed mass: m = V · ρ (grams)                                  │
│    • USDA FoodData Central catalog (323 classes × 219 nutrients)       │
│    • Macros: kcal = (m / 100) · kcal_100g, plus protein, carbs, fat    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Structured JSON
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. METABOLIC REASONING (Google Gemini Flash Lite)                      │
│    • Receives aggregated data only (no numerical recomputation)        │
│    • Concise advice (≤ 3 sentences): glycemic impact, satiety, macros  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Experimental Results and Validation

Comprehensive evaluation on the harmonized **323-class** taxonomy of *Food Recognition 2022* (stratified hold-out test set, $N = 7{,}301$ annotations).

### Instance Segmentation (Test Set)

| Model / Configuration | Evaluation Mode | AP50 | AP (0.5:0.95) | AR100 | Parameters | GPU Latency |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **A4 · Mask2Former Swin-T** (640px) | Class-agnostic | **0.752** | **0.548** | **0.726** | 47.4 M | 111.3 ms |
| **A1 · YOLO26m-seg** (640px) | Class-agnostic | 0.682 | 0.475 | 0.551 | 26.9 M | 20.8 ms |
| **A2 · YOLO26n-seg** (224px) | Class-agnostic | 0.651 | 0.445 | 0.535 | 3.1 M | 16.0 ms |
| **B4 · Mask2Former Swin-T** (224px) | 323 classes (class-agnostic) | 0.352 (0.657) | 0.265 (0.454) | 0.605 (0.709) | 47.5 M | 74.2 ms |
| **B1 · YOLO26m-seg** (640px) | 323 classes (class-agnostic) | 0.325 (0.670) | 0.232 (0.433) | 0.326 (0.567) | 27.5 M | 19.9 ms |
| **B2 · YOLO26n-seg** (224px) | 323 classes (class-agnostic) | 0.207 (0.601) | 0.148 (0.387) | 0.236 (0.553) | 3.3 M | 15.8 ms |

### Crop Classifiers (Ground-Truth Crops, $N = 7{,}301$)

| Model | Top-1 Accuracy (95% CI) | Top-5 Accuracy | Macro-F1 | Parameters | Latency per Crop |
|---|:---:|:---:|:---:|:---:|:---:|
| **C2 · MobileNetV3-Large** | **0.579** (0.567 – 0.590) | **0.840** | 0.423 | **4.62 M** | **10.7 ms** |
| **C3 · Inception-V4** | 0.578 (0.566 – 0.590) | 0.835 | **0.427** | 41.64 M | 30.6 ms |
| **C1 · Custom CNN Baseline** | 0.506 (0.493 – 0.517) | 0.776 | 0.308 | 11.44 M | 6.9 ms |

### Volumetric and Gravimetric Validation on a Real Scene

Evaluated on a real plate with three non-homogeneous ingredients, weighed on a digital scale ($302.0\text{ g}$ in total):

| Food | Apparent Volume | Density $\rho$ | Estimated Weight | Actual Weight (Scale) | Gravimetric Error |
|---|:---:|:---:|:---:|:---:|:---:|
| Banana | $97.9\text{ cm}^3$ | $0.793\text{ g/cm}^3$ | $77.6\text{ g}$ | $34.0\text{ g}$ | Overestimated (edge spillover) |
| Grilled Pork | $234.7\text{ cm}^3$ | $0.812\text{ g/cm}^3$ | $190.6\text{ g}$ | $163.0\text{ g}$ | **+17.0%** |
| Baked Potato | $85.1\text{ cm}^3$ | $1.060\text{ g/cm}^3$ | $90.2\text{ g}$ | $105.0\text{ g}$ | **−14.1%** |
| **Plate Total** | **$417.6\text{ cm}^3$** | — | **$358.4\text{ g}$** | **$302.0\text{ g}$** | **+18.7%** |

---

## 📁 Repository Structure

```
CaloriesCounter/
├── backend/                  # Django 6.1 REST API (orchestration, R2, auth, Gemini)
│   ├── config/               # Core configuration (settings, urls, wsgi)
│   ├── core/                 # Domain app (models, serializers, views, nutrition)
│   │   ├── data/             # nutrition_catalog.csv (fast-lookup catalog for the backend)
│   │   └── services.py       # Google Gemini Flash Lite integration
│   └── requirements.txt      # Backend dependencies
│
├── frontend/                 # Angular 20 Progressive Web App
│   ├── src/app/
│   │   ├── core/             # Session, gyroscope (TiltService) and API services
│   │   └── features/         # Views: top-down level capture, SVG results, history
│   └── package.json          # Frontend dependencies
│
├── ml/                       # Pipeline inference and deployment modules
│   ├── pipeline/             # Decoupled, modular components:
│   │   ├── segmentation.py   # Inference with YOLO26-seg or Mask2Former
│   │   ├── classification.py # Crop classification with Inception-V4 / MobileNet
│   │   ├── depth.py          # Depth Anything V2 (Small and Large metric variants)
│   │   ├── plate.py          # Circular-Hough plate detection and scale recovery
│   │   ├── volume.py         # RANSAC table fitting and volume integration (cm³)
│   │   └── nutrition.py      # Deterministic conversion to grams, calories and macros
│   ├── data/                 # nutrition_wide_densidad.csv and food_names_es.csv
│   ├── run_local.py          # CLI script to run the full pipeline 100% locally
│   ├── modal_app.py          # Serverless GPU container definition for Modal
│   └── tests/test_core.py    # Unit tests for volume, geometry and nutrition
│
├── research/                 # Experimental research and training notebooks
│   ├── notebooks/            # Reproducible notebooks (00 to 99)
│   │   ├── 00_data_preparation.ipynb
│   │   ├── A1..A4            # Class-agnostic segmenters (YOLO / Mask2Former)
│   │   ├── B1..B4            # Multi-class segmenters
│   │   ├── C1..C3            # Crop classifiers (custom CNN, MobileNetV3, Inception-V4)
│   │   ├── D1_depth_calibration_nutrition5k.ipynb  # Depth and Nutrition5k
│   │   └── 99_results_comparison.ipynb             # Global metrics comparison
│   ├── nutrition_mapping/    # Construction and audit of the USDA nutrition table
│   └── visual_resources/     # Scripts that generate figures and 3D visualizations
│
├── .gitignore                # Strict exclusion rules (weights, temp files, runs)
└── ROADMAP.md                # Log of completed milestones and future work
```

> [!NOTE]
> **Weights management and privacy:** Weight files (`*.pt`, `*.pth`) and local run folders (`/runs/`) are excluded from Git via `.gitignore` to keep the repository lightweight and within size policies. In production, weights are hosted in a private *Modal Volume* (`caloriescounter-models`).

---

## 🚀 Running and Testing Locally

### 1. Local Machine Learning Inference

You can run the full pipeline locally (CPU or CUDA GPU) with no dependency on Modal's cloud:

```powershell
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install PyTorch and dependencies
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install transformers timm pillow opencv-python-headless numpy pytest

# Run on a sample image (Pipeline B: Mask2Former + Inception, default Depth Small)
python run_local.py samples/pizza.jpg --pipeline B

# Run with the calibrated Depth Anything V2 Large variant
python run_local.py samples/pizza.jpg --pipeline B --depth-size large
```

### 2. Geometry and Nutrition Unit Tests

```powershell
cd ml
pytest tests/test_core.py -v
```

### 3. Run the Backend (Django)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Configure environment variables (.env)
python manage.py migrate
python manage.py runserver
```

### 4. Run the Frontend (Angular)

```powershell
cd frontend
npm install
npm start
```

The web app will be available at `http://localhost:4200`, featuring interactive capture, a top-down leveling reticle and macronutrient visualization.

---

## 🌐 Cloud Deployment

The production stack is fully decoupled and incurs **zero fixed compute cost while idle**:

* **Frontend:** deployed on **Vercel** (Edge CDN).
* **Orchestration API:** deployed on **Render** (Django REST + Python 3.12).
* **Database and Storage:** **Neon PostgreSQL** (logs and users, 30-day retention) and **Cloudflare R2** (plate photos via presigned URLs, 72-hour lifecycle).
* **GPU Inference:** serverless container on **Modal** with an NVIDIA A10G GPU (auto-scales to zero after 5 minutes of inactivity).
* **Reasoning Layer:** **Google Gemini Flash Lite** via the Google Generative AI API, with response times under 2 s.

---

## 📖 References and Datasets

1. **Food Recognition Benchmark 2022:** MyFoodRepo / AIcrowd (323 classes, harmonized taxonomy v2.1).
2. **Nutrition5k:** Q. Thames, A. Karpur, W. Norris, F. Xia, L. Panait, A. Reiter, H. Zhou. "Nutrition5k: Towards Automatic Nutritional Understanding of Generic Food", CVPR 2021.
3. **USDA FoodData Central:** SR Legacy, FNDDS and Foundation reference tables for gravimetry and macronutrient profiles.
4. **Depth Anything V2:** L. Yang et al. "Depth Anything V2", 2024 (metric indoor variant).