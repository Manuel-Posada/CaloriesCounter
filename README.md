# Calorie Counter: A Decoupled Modular Pipeline for Monocular 3D Food Portion Estimation and Grounded LLM Nutritional Guidance

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Angular](https://img.shields.io/badge/Angular-20-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![Django](https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.x-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Modal](https://img.shields.io/badge/Deployment-Modal_GPU_A10G-00FF66)](https://modal.com/)
[![Gemini](https://img.shields.io/badge/LLM-Gemini_Flash_Lite-8E75B2?logo=google-gemini&logoColor=white)](https://ai.google.dev/)

**Calorie Counter** is a decoupled intelligent system for 3D volumetric and nutritional food estimation from a single smartphone photograph taken in unconstrained real-world environments.

The project addresses the arithmetic hallucinations of end-to-end multimodal models and the hardware limitations of RGB-D/LiDAR systems through a **four-stage decoupled pipeline**:
1. **Visual perception (instance-first segmentation and classification).**
2. **Metric monocular depth and 3D volumetric estimation.**
3. **Deterministic gravimetric and nutritional mapping (USDA FoodData Central).**
4. **Grounded metabolic reasoning via LLM (Google Gemini Flash Lite).**

---

## 🏗️ System Architecture

```
[ Smartphone Photograph ]
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. VISUAL PERCEPTION (Instance-First)                                  │
│    • Pipeline B (Production / Decoupled):                              │
│        Mask2Former Swin-Tiny (Agnostic) ──> Crops ──> Inception-V4     │
│    • Pipeline A (Lightweight / Joint Alternative):                     │
│        YOLO26-seg (Single-pass Segmentation + Classification)          │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ 2D Masks + Classes
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. METRIC DEPTH & 3D VOLUME                                            │
│    • Metric Depth: Depth Anything V2 (Metric Indoor Small / Large)     │
│    • Scale Calibration: Plate detection (Circular Hough + f_px)        │
│    • 3D Geometry: Table support plane fitting with RANSAC              │
│    • Integration: Height h above plane x differential area (cm³)       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Apparent Volume V (cm³)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. GRAVIMETRIC & NUTRITIONAL MAPPING (Deterministic)                   │
│    • Apparent density ρ (g/cm³) calibrated across 323 classes          │
│    • Computed mass: m = V · ρ (grams)                                  │
│    • USDA FoodData Central catalog (323 classes x 219 nutrients)       │
│    • Macros: kcal = (m / 100) · kcal_100g, protein, carbs, fat         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Structured JSON
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. METABOLIC REASONING (Google Gemini Flash Lite)                      │
│    • Receives aggregated numerical data only (no numeric recalculation)│
│    • Concise guidance (≤3 sentences): glycemic impact, satiety, macros │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Experimental Results & Validation

Comprehensive evaluation on the harmonized **323-class** *Food Recognition 2022* taxonomy (stratified hold-out test set, $N = 7,301$ annotations):

### Instance Segmentation (Test Set)

| Model / Configuration | Evaluation Mode | AP50 | AP (0.5:0.95) | AR100 | Parameters | GPU Latency |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **A4 · Mask2Former Swin-T** (640px) | Agnostic | **0.752** | **0.548** | **0.726** | 47.4 M | 111.3 ms |
| **A1 · YOLO26m-seg** (640px) | Agnostic | 0.682 | 0.475 | 0.551 | 26.9 M | 20.8 ms |
| **A2 · YOLO26n-seg** (224px) | Agnostic | 0.651 | 0.445 | 0.535 | 3.1 M | 16.0 ms |
| **B4 · Mask2Former Swin-T** (224px) | 323 Classes (Agnostic) | 0.352 (0.657) | 0.265 (0.454) | 0.605 (0.709) | 47.5 M | 74.2 ms |
| **B1 · YOLO26m-seg** (640px) | 323 Classes (Agnostic) | 0.325 (0.670) | 0.232 (0.433) | 0.326 (0.567) | 27.5 M | 19.9 ms |
| **B2 · YOLO26n-seg** (224px) | 323 Classes (Agnostic) | 0.207 (0.601) | 0.148 (0.387) | 0.236 (0.553) | 3.3 M | 15.8 ms |

### Crop Classifiers (Ground-Truth Crops, $N = 7,301$)

| Model | Top-1 Accuracy (95% CI) | Top-5 Accuracy | Macro-F1 | Parameters | Latency per Crop |
|---|:---:|:---:|:---:|:---:|:---:|
| **C2 · MobileNetV3-Large** | **0.579** (0.567 – 0.590) | **0.840** | 0.423 | **4.62 M** | **10.7 ms** |
| **C3 · Inception-V4** | 0.578 (0.566 – 0.590) | 0.835 | **0.427** | 41.64 M | 30.6 ms |
| **C1 · Custom CNN Baseline** | 0.506 (0.493 – 0.517) | 0.776 | 0.308 | 11.44 M | 6.9 ms |

### Real-World Volumetric & Gravimetric Validation

Evaluated on a real multi-ingredient plate weighed on a digital scale ($302.0\text{ g}$ total):

| Food Item | Apparent Volume | Density $\rho$ | Estimated Weight | Ground-Truth Weight | Gravimetric Error |
|---|:---:|:---:|:---:|:---:|:---:|
| Banana (*Plátano*) | $97.9\text{ cm}^3$ | $0.793\text{ g/cm}^3$ | $77.6\text{ g}$ | $34.0\text{ g}$ | Overestimated (edge spill) |
| Grilled Pork (*Cerdo*) | $234.7\text{ cm}^3$ | $0.812\text{ g/cm}^3$ | $190.6\text{ g}$ | $163.0\text{ g}$ | **+17.0%** |
| Baked Potato (*Patata*) | $85.1\text{ cm}^3$ | $1.060\text{ g/cm}^3$ | $90.2\text{ g}$ | $105.0\text{ g}$ | **-14.1%** |
| **Plate Total** | **$417.6\text{ cm}^3$** | — | **$358.4\text{ g}$** | **$302.0\text{ g}$** | **+18.7%** |

---

## 📁 Repository Structure

```
CaloriesCounter/
├── backend/                  # Django 6.1 REST API (Orchestration, R2, Auth, Gemini)
│   ├── config/               # Core Django settings, URLs, WSGI
│   ├── core/                 # Domain app (models, serializers, views, nutrition, tests)
│   │   ├── data/             # nutrition_catalog.csv (fast backend lookup catalog)
│   │   └── services.py       # Google Gemini Flash Lite integration
│   └── requirements.txt      # Backend Python dependencies
│
├── frontend/                 # Angular 20 Progressive Web Application
│   ├── src/app/
│   │   ├── core/             # Session, gyroscope (TiltService), and API services
│   │   └── features/         # Zenith-guided capture, SVG overlay results, history
│   └── package.json          # Frontend dependencies
│
├── ml/                       # Inference pipeline & serverless GPU deployment
│   ├── pipeline/             # Decoupled pipeline modules:
│   │   ├── segmentation.py   # YOLO26-seg or Mask2Former inference
│   │   ├── classification.py # Crop classification with Inception-V4 / MobileNet
│   │   ├── depth.py          # Depth Anything V2 (Metric Small and Large)
│   │   ├── plate.py          # Circular Hough plate detection & scale calibration
│   │   ├── volume.py         # RANSAC table plane fitting & volumetric integration (cm³)
│   │   └── nutrition.py      # Deterministic conversion to grams, kcal, and macros
│   ├── data/                 # nutrition_wide_densidad.csv & food_names_es.csv
│   ├── run_local.py          # CLI script to run the pipeline 100% locally
│   ├── modal_app.py          # Modal serverless GPU container definition
│   └── tests/test_core.py    # Unit tests for volume, geometry, and nutrition
│
├── research/                 # Experimental research & training notebooks
│   ├── notebooks/            # Reproducible notebooks (00 to 99 + D1)
│   ├── comparison/           # Aggregated metric tables and EN/ES figures
│   ├── nutrition_mapping/    # USDA nutritional table construction & audit
│   └── visual_resources/     # Publication figure generators & web gallery
│
├── docs/                     # Technical documentation & paper drafts
│   ├── frontend/             # Frontend lifecycle audit & motion plan
│   └── paper/                # Paper drafts (Section V, calibration & Nutrition5k)
│
├── .github/                  # CI workflow, PR/Issue templates
├── .gitignore                # Strict exclusions (weights, temp files, runs)
├── docker-compose.yml        # Local PostgreSQL development service
├── pyproject.toml            # Ruff & pytest configuration
└── ROADMAP.md                # Completed milestones & future work
```

> [!NOTE]
> **Weights & Privacy Management:** Model weights (`*.pt`, `*.pth`) and local run directories (`/runs/`) are excluded from Git via `.gitignore` to keep the repository lightweight. In production, weights are stored in a private *Modal Volume* (`caloriescounter-models`).

---

## 🚀 Local Setup & Testing

### 1. Local ML Pipeline Inference

You can run the full pipeline locally (on CPU or CUDA GPU) without depending on Modal:

```powershell
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install PyTorch and dependencies
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install transformers timm pillow opencv-python-headless numpy pytest

# Run on a sample image (Pipeline B: Mask2Former + Inception, default Depth Small)
python run_local.py samples/pizza.jpg --pipeline B

# Evaluate with calibrated Depth Anything V2 Large variant
python run_local.py samples/pizza.jpg --pipeline B --depth-size large
```

### 2. Geometry & Nutrition Unit Tests

```powershell
cd ml
pytest tests/test_core.py -v
```

### 3. Backend (Django)

```powershell
# Optional: start local PostgreSQL
docker compose up -d

cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Configure environment variables (copy backend/.env.example -> backend/.env)
python manage.py migrate
python manage.py test
python manage.py runserver
```

### 4. Frontend (Angular)

```powershell
cd frontend
npm install
npm start
```

The web app will be available at `http://localhost:4200` with interactive camera capture, zenithal leveling reticle, and macro visualization.

---

## 🌐 Cloud Deployment

The production stack runs decoupled with zero fixed idle compute cost:
* **Frontend:** Deployed on **Vercel** (Edge CDN).
* **Orchestration API:** Deployed on **Render** (Django REST + Python 3.12).
* **Database & Storage:** **Neon PostgreSQL** (30-day log retention) and **Cloudflare R2** (meal photos via presigned URLs with 72h lifecycle).
* **GPU Inference:** Serverless container on **Modal** with NVIDIA A10G GPU (scales to zero after 5 minutes of inactivity).
* **Reasoning Layer:** **Google Gemini Flash Lite** via Google Generative AI API (`< 2 s` response times).

---

## 📖 References & Datasets

1. **Food Recognition Benchmark 2022:** MyFoodRepo / AIcrowd (323 classes in harmonized v2.1 taxonomy).
2. **Nutrition5k:** *Q. Thames, A. Karpur, W. Norris, F. Xia, L. Panait, A. Reiter, H. Zhou*. "Nutrition5k: Towards Automatic Nutritional Understanding of Generic Food", CVPR 2021.
3. **USDA FoodData Central:** Standard Reference Legacy, FNDDS, and Foundation tables for gravimetry and macronutrient profiles.
4. **Depth Anything V2:** *L. Yang et al.* "Depth Anything V2: Metric Indoor Depth Estimation", 2024.
