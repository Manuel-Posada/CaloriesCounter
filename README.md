# Calorie Counter: A Decoupled Modular Pipeline for Monocular 3D Food Portion Estimation and Grounded LLM Nutritional Guidance

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Angular](https://img.shields.io/badge/Angular-20-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![Django](https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.x-EE4C2C?logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Modal](https://img.shields.io/badge/Deployment-Modal_GPU_A10G-00FF66)](https://modal.com/)
[![Gemini](https://img.shields.io/badge/LLM-Gemini_Flash_Lite-8E75B2?logo=google-gemini&logoColor=white)](https://ai.google.dev/)

**Calorie Counter** es un sistema inteligente desacoplado para la estimación nutricional y volumétrica de alimentos en 3D a partir de una única fotografía tomada con un smartphone en entornos reales no controlados.

El proyecto aborda las alucinaciones aritméticas de los modelos multimodales extremo a extremo (*end-to-end*) y las limitaciones de hardware de los sistemas RGB-D/LiDAR mediante un **pipeline desacoplado en cuatro etapas**:
1. **Percepción visual (segmentación y clasificación por instancia).**
2. **Profundidad monocular métrica y estimación volumétrica 3D.**
3. **Mapeo gravimétrico y nutricional estandarizado (USDA FoodData Central).**
4. **Razonamiento metabólico guiado por LLM (Google Gemini Flash Lite).**

---

## 🏗️ Arquitectura del Sistema

```
[ Fotografía de Smartphone ]
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. PERCEPCIÓN VISUAL (Instancia primero)                               │
│    • Pipeline B (Producción / Desacoplado):                            │
│        Mask2Former Swin-Tiny (Agnóstico) ──> Recortes ──> Inception-V4 │
│    • Pipeline A (Alternativa Ligera / Conjunto):                       │
│        YOLO26-seg (Segmentación + Clasificación en una pasada)         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Máscaras 2D + Clases
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. PROFUNDIDAD MÉTRICA Y VOLUMEN 3D                                    │
│    • Profundidad métrica: Depth Anything V2 (Metric Indoor Small / L)  │
│    • Calibración de escala: Detección de plato (Hough circular + f_px) │
│    • Geometría 3D: Ajuste de plano de mesa con RANSAC                  │
│    • Integración: Altura h sobre el plano x diferencial de área (cm³)  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Volumen aparente V (cm³)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. MAPEO GRAVIMÉTRICO Y NUTRICIONAL (Determinista)                     │
│    • Densidad aparente ρ (g/cm³) calibrada para 323 clases             │
│    • Masa calculada: m = V · ρ (gramos)                                │
│    • Catálogo USDA FoodData Central (323 clases x 219 nutrientes)      │
│    • Macros: kcal = (m / 100) · kcal_100g, proteínas, carbos, grasas   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ JSON estructurado
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. RAZONAMIENTO METABÓLICO (Google Gemini Flash Lite)                  │
│    • Recepción exclusiva de datos agregados (sin recálculo numérico)   │
│    • Consejo conciso (≤3 frases): impacto glucémico, saciedad y macros │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Resultados Experimentales y Validación

Evaluación exhaustiva sobre la taxonomía armonizada de **323 clases** de *Food Recognition 2022* (hold-out test set estratificado, $N = 7.301$ anotaciones):

### Segmentación de Instancia (Test Set)

| Modelo / Configuración | Modo de Evaluación | AP50 | AP (0.5:0.95) | AR100 | Parámetros | Latencia GPU |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **A4 · Mask2Former Swin-T** (640px) | Agnóstico | **0.752** | **0.548** | **0.726** | 47.4 M | 111.3 ms |
| **A1 · YOLO26m-seg** (640px) | Agnóstico | 0.682 | 0.475 | 0.551 | 26.9 M | 20.8 ms |
| **A2 · YOLO26n-seg** (224px) | Agnóstico | 0.651 | 0.445 | 0.535 | 3.1 M | 16.0 ms |
| **B4 · Mask2Former Swin-T** (224px) | 323 Clases (Agnóstico) | 0.352 (0.657) | 0.265 (0.454) | 0.605 (0.709) | 47.5 M | 74.2 ms |
| **B1 · YOLO26m-seg** (640px) | 323 Clases (Agnóstico) | 0.325 (0.670) | 0.232 (0.433) | 0.326 (0.567) | 27.5 M | 19.9 ms |
| **B2 · YOLO26n-seg** (224px) | 323 Clases (Agnóstico) | 0.207 (0.601) | 0.148 (0.387) | 0.236 (0.553) | 3.3 M | 15.8 ms |

### Clasificadores de Recortes (Ground-Truth Crops, $N = 7.301$)

| Modelo | Top-1 Accuracy (95% CI) | Top-5 Accuracy | Macro-F1 | Parámetros | Latencia por recorte |
|---|:---:|:---:|:---:|:---:|:---:|
| **C2 · MobileNetV3-Large** | **0.579** (0.567 – 0.590) | **0.840** | 0.423 | **4.62 M** | **10.7 ms** |
| **C3 · Inception-V4** | 0.578 (0.566 – 0.590) | 0.835 | **0.427** | 41.64 M | 30.6 ms |
| **C1 · Custom CNN Baseline** | 0.506 (0.493 – 0.517) | 0.776 | 0.308 | 11.44 M | 6.9 ms |

### Validación Volumétrica y Gravimétrica en Escena Real

Evaluado sobre un plato real de tres ingredientes no homogéneos pesados en báscula digital ($302.0\text{ g}$ totales):

| Alimento | Volumen Aparente | Densidad $\rho$ | Peso Estimado | Peso Real (Báscula) | Error Gravimétrico |
|---|:---:|:---:|:---:|:---:|:---:|
| Plátano (*Banana*) | $97.9\text{ cm}^3$ | $0.793\text{ g/cm}^3$ | $77.6\text{ g}$ | $34.0\text{ g}$ | Sobreestimado (derrame en borde) |
| Cerdo a la plancha (*Pork*) | $234.7\text{ cm}^3$ | $0.812\text{ g/cm}^3$ | $190.6\text{ g}$ | $163.0\text{ g}$ | **+17.0%** |
| Patata cocida (*Baked Potato*) | $85.1\text{ cm}^3$ | $1.060\text{ g/cm}^3$ | $90.2\text{ g}$ | $105.0\text{ g}$ | **-14.1%** |
| **Total Plato** | **$417.6\text{ cm}^3$** | — | **$358.4\text{ g}$** | **$302.0\text{ g}$** | **+18.7%** |

---

## 📁 Estructura del Repositorio

```
CaloriesCounter/
├── backend/                  # API REST en Django 6.1 (Orquestación, R2, Auth, Gemini)
│   ├── config/               # Configuración central (settings, urls, wsgi)
│   ├── core/                 # Aplicación de dominio (modelos, serializers, vistas, nutrition)
│   │   ├── data/             # nutrition_catalog.csv (catálogo de consulta rápida para backend)
│   │   └── services.py       # Integración con Google Gemini Flash Lite
│   └── requirements.txt      # Dependencias del backend
│
├── frontend/                 # Aplicación Web Progresiva en Angular 20
│   ├── src/app/
│   │   ├── core/             # Servicios de sesión, giroscopio (TiltService), API
│   │   └── features/         # Vistas: captura con nivel cenital, resultado con SVG, historial
│   └── package.json          # Dependencias de frontend
│
├── ml/                       # Módulos de inferencia y despliegue del pipeline
│   ├── pipeline/             # Módulos modulares desacoplados:
│   │   ├── segmentation.py   # Inferencia con YOLO26-seg o Mask2Former
│   │   ├── classification.py # Clasificación de recortes con Inception-V4 / MobileNet
│   │   ├── depth.py          # Depth Anything V2 (Small y Large métricos)
│   │   ├── plate.py          # Detección de plato por Hough circular y escala
│   │   ├── volume.py         # Ajuste RANSAC de mesa e integración volumétrica en cm³
│   │   └── nutrition.py      # Conversión determinista a gramos, calorías y macros
│   ├── data/                 # nutrition_wide_densidad.csv y food_names_es.csv
│   ├── run_local.py          # Script CLI para ejecutar el pipeline 100% en local
│   ├── modal_app.py          # Definición del contenedor serverless GPU en Modal
│   └── tests/test_core.py    # Pruebas unitarias de volumen, geometría y nutrición
│
├── research/                 # Investigación experimental y cuadernillos de entrenamiento
│   ├── notebooks/            # Cuadernillos reproducibles (00 a 99)
│   │   ├── 00_datos_food_recognition_v4_sam2.ipynb
│   │   ├── A1..A4 (Segmentadores agnósticos YOLO / Mask2Former)
│   │   ├── B1..B4 (Segmentadores multiclase)
│   │   ├── C1..C3 (Clasificadores de recortes CNN, MobileNetV3, Inception-V4)
│   │   ├── D1_calibracion_profundidad_volumen_nutrition5k.ipynb (Profundidad y Nutrition5k)
│   │   └── 99_comparacion_resultados.ipynb (Comparación global de métricas)
│   ├── nutrition_mapping/    # Construcción y auditoría de la tabla nutricional USDA
│   └── visual_resources/    # Scripts generadores de figuras y visualizaciones 3D
│
├── docs/                     # Auditorías técnicas, motion plans e investigación
│   ├── audit_report.md       # Auditoría exhaustiva de ciclo de vida, DOM y giroscopio
│   └── motion_plan.md        # Especificación de animaciones morfológicas
│
├── .gitignore                # Reglas estrictas de exclusión (pesos, temporales, runs)
└── ROADMAP.md                # Registro de hitos completados y trabajo futuro
```

> [!NOTE]
> **Gestión de pesos y privacidad:** Los archivos de pesos (`*.pt`, `*.pth`) y las carpetas de ejecuciones locales (`/runs/`) están excluidos de Git mediante `.gitignore` para no sobrecargar el repositorio ni violar políticas de tamaño. En producción, los pesos se alojan en un *Modal Volume* privado (`caloriescounter-models`).

---

## 🚀 Ejecución y Pruebas en Local

### 1. Inferencia Local del Pipeline de Machine Learning

Puedes probar el pipeline completo localmente (en CPU o GPU CUDA) sin depender de la nube de Modal:

```powershell
cd ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Instalar PyTorch y dependencias
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install transformers timm pillow opencv-python-headless numpy pytest

# Ejecutar sobre una imagen de prueba (usando Pipeline B: Mask2Former + Inception)
python run_local.py samples/pizza.jpg --pipeline B

# Evaluar variante Depth Anything V2 Large con calibración
python run_local.py samples/pizza.jpg --pipeline B --depth-model depth-anything/Depth-Anything-V2-Metric-Indoor-Large-hf
```

### 2. Pruebas Unitarias de Geometría y Nutrición

```powershell
cd ml
pytest tests/test_core.py -v
```

### 3. Ejecutar el Backend (Django)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Configurar variables de entorno (.env)
python manage.py migrate
python manage.py runserver
```

### 4. Ejecutar el Frontend (Angular)

```powershell
cd frontend
npm install
npm start
```

La aplicación web estará disponible en `http://localhost:4200` con captura interactiva, retícula de nivelación cenital y visualización de macros.

---

## 🌐 Despliegue en la Nube

El stack productivo opera de manera desacoplada y sin costes fijos de computación en reposo:
* **Frontend:** Desplegado en **Vercel** (Edge CDN).
* **API de Orquestación:** Desplegado en **Render** (Django REST + Python 3.12).
* **Base de Datos & Almacenamiento:** **Neon PostgreSQL** (almacenamiento de logs y usuarios con retención de 30 días) y **Cloudflare R2** (fotos de platos con presigned URLs y ciclo de vida de 72 h).
* **Inferencia GPU:** Contenedor serverless en **Modal** con GPU NVIDIA A10G (auto-escalado a cero tras 5 minutos de inactividad).
* **Capa de Razonamiento:** **Google Gemini Flash Lite** vía API de Google Generative AI con tiempos de respuesta `< 2 s`.

---

## 📖 Referencias y Dataset

1. **Food Recognition Benchmark 2022:** MyFoodRepo / AIcrowd (323 clases en taxonomía v2.1 armonizada).
2. **Nutrition5k:** *Q. Thames, A. Karpur, W. Norris, F. Xia, L. Panait, A. Reiter, H. Zhou*. "Nutrition5k: Towards Automatic Nutritional Understanding of Generic Food", CVPR 2021.
3. **USDA FoodData Central:** Tablas de referencia estándar SR Legacy, FNDDS y Foundation para gravimetría y perfiles de macronutrientes.
4. **Depth Anything V2:** *L. Yang et al.* "Depth Anything V2: Metric Indoor Depth Estimation", 2024.
