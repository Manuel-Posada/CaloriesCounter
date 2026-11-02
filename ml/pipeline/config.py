"""Constantes del pipeline. Se pueden sobreescribir con variables de entorno."""
import os

NUM_CLASSES = 323

# Pesos propios (se suben a un modal.Volume, ver ml/README.md).
# En local basta con apuntar MODELS_DIR a la raíz del repo:
#   $env:MODELS_DIR = "C:\...\CaloriesCounter"
MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
YOLO_WEIGHTS = os.environ.get("YOLO_WEIGHTS", f"{MODELS_DIR}/yolo26_seg_food323.pt")
INCEPTION_WEIGHTS = os.environ.get("INCEPTION_WEIGHTS", f"{MODELS_DIR}/inception_v4_food323.pt")

# Checkpoint propio de Mask2Former (segmentación agnóstica de comida).
# Si el fichero no existe se usa el modelo de Hugging Face tal cual.
MASK2FORMER_WEIGHTS = os.environ.get("MASK2FORMER_WEIGHTS", f"{MODELS_DIR}/mask2former_agnostic.pt")

# Repos de Hugging Face. Sólo aportan la *arquitectura*/preprocesado cuando hay
# pesos locales; si no hay, también los pesos.
MASK2FORMER_ID = os.environ.get("MASK2FORMER_ID", "facebook/mask2former-swin-tiny-coco-instance")
# Variante *métrica* de Depth Anything V2: devuelve metros (necesario para cm³).
# Small: la validada de extremo a extremo y la que se usa en producción. La Large sobreestima
# la distancia en primeros planos (mesa a ~0,4 m -> 1,8 m) y el volumen se dispara.
# Se puede cambiar sin tocar código con la variable DEPTH_MODEL_ID.
DEPTH_MODEL_ID = os.environ.get(
    "DEPTH_MODEL_ID", "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
)

NUTRITION_CSV = os.environ.get("NUTRITION_CSV", "/data/nutrition_wide_densidad.csv")

# Imagen
MAX_IMAGE_SIDE = 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Segmentación
YOLO_CONF = 0.25
YOLO_IMGSZ = 640
MASK2FORMER_THRESHOLD = 0.5
MIN_MASK_AREA_FRAC = 0.001  # descarta máscaras < 0.1 % de la imagen

# Cámara / volumen
DEFAULT_HFOV_DEG = 65.0  # si no hay EXIF ni fov_deg del cliente
MAX_FOOD_HEIGHT_CM = 20.0

# Escala. La profundidad monocular sobreestima la distancia en primeros planos (una foto de
# plato a 30-40 cm la sitúa a 1,5 m), así que el volumen se dispara. El plato es la
# referencia de tamaño: con su borde detectado se recalcula la distancia real.
PLATE_DIAMETER_CM = float(os.environ.get("PLATE_DIAMETER_CM", "26.0"))
# Corrección admisible. Fuera de este rango se considera que el plato detectado no es el
# plato (un aro del mantel, un reflejo) y no se corrige.
PLATE_SCALE_MIN = 0.05
PLATE_SCALE_MAX = 1.6
# Sin plato: si el modelo sitúa la mesa más allá de esto, es el sesgo típico de primer plano
# y se acota a una distancia de foto de plato (con aviso al usuario).
PLATE_FALLBACK_TRIGGER_CM = 80.0
PLATE_FALLBACK_DISTANCE_CM = 35.0

# Inclinación de cámara (respecto a la vertical) a partir de la cual se avisa de que la foto
# no es cenital. A ≤8° apunta el modo guiado; a partir de 15° el volumen empieza a desviarse.
TILT_WARN_DEG = float(os.environ.get("TILT_WARN_DEG", 15.0))
