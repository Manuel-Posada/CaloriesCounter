# Pipeline de inferencia (Modal)

```
ml/
├── modal_app.py            # App Modal: imagen, clase FoodInference, endpoint POST
├── run_local.py            # Prueba del pipeline en local (sin Modal)
├── data/                   # <- colocar aquí nutrition_wide_densidad.csv
├── samples/                # imágenes de prueba
├── pipeline/
│   ├── config.py           # rutas, IDs de modelos, umbrales
│   ├── segmentation.py     # YoloSegmenter (A) · Mask2FormerSegmenter (B)
│   ├── classification.py   # InceptionV4Classifier (B)
│   ├── depth.py            # Depth Anything V2 (métrico, metros)
│   ├── volume.py           # profundidad + máscara -> cm³ (numpy puro)
│   ├── nutrition.py        # CSV -> gramos -> kcal / macros (python puro)
│   └── runner.py           # orquestador A/B
└── tests/test_core.py      # volumen y nutrición (sin GPU)
```

## Despliegue en Modal

Requisitos: cuenta de Modal, `ml/data/nutrition_wide_densidad.csv` y los tres pesos en la raíz del
repo (`*.pt` **no** se versionan: van al Volume).

```bash
cd ml
pip install -r requirements.txt
modal setup                       # o `modal token new`

# 1. Volume con los pesos propios (las rutas son /models/<fichero>)
modal volume create caloriescounter-models
modal volume put caloriescounter-models ../yolo26_seg_food323.pt /yolo26_seg_food323.pt
modal volume put caloriescounter-models ../inception_v4_food323.pt /inception_v4_food323.pt
modal volume put caloriescounter-models ../mask2former_agnostic.pt /mask2former_agnostic.pt

# 2. Secreto compartido con Django (mismo valor en backend/.env)
modal secret create caloriescounter-modal MODAL_SHARED_SECRET=<cadena-larga-aleatoria>

# 3. Desplegar
modal deploy modal_app.py
```

`modal deploy` imprime la URL del endpoint:
`https://<workspace>--calories-counter-inference-foodinference-predict.modal.run`.
Se pega en `backend/.env` junto al mismo secreto:

```dotenv
MODAL_ENDPOINT_URL=https://<workspace>--calories-counter-inference-foodinference-predict.modal.run
MODAL_SHARED_SECRET=<la misma cadena>
```

Django manda el secreto en la cabecera `X-Modal-Secret`; Modal responde 401 si no coincide o si
falta, así que **el endpoint no es usable desde fuera**.

Notas:

- El primer `modal deploy` compila la imagen (torch + transformers): tarda varios minutos.
- `_download_hf_models()` hornea Depth Anything V2 y la configuración de Mask2Former en la imagen,
  así que los cold starts no descargan pesos.
- GPU `A10G`; la clase tiene `scaledown_window=300`, se apaga a los 5 minutos sin uso.
- Para desarrollo con recarga: `modal serve modal_app.py` (URL temporal).
- `CORS_ALLOWED_ORIGINS` solo afecta a llamadas directas desde el navegador; Django llama desde el
  servidor, así que no es necesario para la app.
- Al cambiar código del pipeline basta con volver a `modal deploy`; los pesos del Volume no se tocan.

## Prueba local (sin Modal)

```powershell
cd ml
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # sin GPU
pip install transformers timm pillow opencv-python-headless numpy pytest

# Pipeline B: mask2former_agnostic.pt + inception_v4_food323.pt
python run_local.py ..\mi_plato.jpg --pipeline B

# Pipeline A: yolo26_seg_food323.pt
pip install "ultralytics>=8.4.0"
python run_local.py ..\mi_plato.jpg --pipeline A
```

`run_local.py` toma los pesos de la raíz del repo; se pueden sobreescribir con
`MODELS_DIR`, `MASK2FORMER_WEIGHTS`, `INCEPTION_WEIGHTS`, `YOLO_WEIGHTS`, `DEPTH_MODEL_ID`
y `NUTRITION_CSV`.

> **Modelo de profundidad:** el valor por defecto es la variante *Small* (`DEPTH_MODEL_ID`), que es
> la validada de extremo a extremo. La *Large* sobreestima la distancia en primeros planos —en la
> foto de `samples/pizza.jpg` estima 1,8 m donde hay ~0,4 m— y el volumen se dispara (200 L en vez
> de 0,17 L). Se puede probar con `--depth-model ...-Large-hf`, pero sin calibrar no es apta para
> producción. Es más lenta y pesa ~1,3 GB más.

```powershell
python run_local.py ..\mi_plato.jpg --pipeline B `
  --depth-model depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf
```

## Uso

```bash
curl -X POST "https://<workspace>--calories-counter-inference-foodinference-predict.modal.run?pipeline=B" \
     -F "file=@plato.jpg"
```
Parámetros: `pipeline=A|B` (default `B`: Mask2Former + Inception; `A` es YOLO26-seg), `fov_deg` (FOV horizontal de la cámara; si no se envía se usa el EXIF `FocalLengthIn35mmFilm` y, si no existe, 65°) y `f35_mm` (focal equivalente en 35 mm leída del EXIF en el navegador, para cuando la subida viene recomprimida sin metadatos).

Respuesta (resumen):
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
`totales` mapea 1:1 con `FoodLog` de Django (`clases_detectadas`, `calorias_totales`, `volumen_estimado`, `macronutrientes`).
`poligono` es el contorno exterior de la máscara (máximo 40 puntos, coordenadas normalizadas 0..1 sobre la imagen)
y `centroide` su centro: el frontend los usa para pintar la zona y su etiqueta sobre la foto.
`nutricion.por_100g` son los valores de la tabla tal cual, para que el usuario pueda consultarlos.
`angulo_camara_deg` es la inclinación de la cámara respecto a la vertical, estimada con la normal del plano de
apoyo: `0` = cenital. Vale `null` cuando ningún segmento dio un plano fiable (nunca se inventa un `0`). Si supera
`TILT_WARN_DEG` (15° por defecto) se añade una advertencia, pero la inferencia no se bloquea.

## Tests
```bash
pip install numpy opencv-python-headless pytest
pytest
```

## Supuestos a validar
- **CSV**: columnas nutricionales con los nombres exactos del enunciado; la columna de densidad se detecta
  (`densidad`/`density`/cualquiera con "dens"); `idx` y nombre se detectan por alias (`idx`, `clase`, `nombre`…),
  y si no hay `idx` se usa el orden de fila. Debe tener exactamente 323 filas o el contenedor falla al arrancar.
- **Escala**: el volumen depende de la profundidad métrica y de la focal. Calibra con objetos de volumen conocido.
- **Preprocesado de Inception-V4**: el de `timm` por defecto; debe coincidir con tu entrenamiento.
- **Mask2Former**: `mask2former_agnostic.pt` se carga sobre la arquitectura deducida de su encoder Swin
  (la clase de `class_predictor` se ignora porque la segmentación es agnóstica). Sin checkpoint se usa
  `MASK2FORMER_ID` de Hugging Face.

