"""Pipeline constants. Can be overridden via environment variables."""
import os

NUM_CLASSES = 323

# Custom weights (uploaded to a modal.Volume, see ml/README.md).
# Locally, point MODELS_DIR to the repo root:
#   $env:MODELS_DIR = "C:\...\CaloriesCounter"
MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
YOLO_WEIGHTS = os.environ.get("YOLO_WEIGHTS", f"{MODELS_DIR}/yolo26_seg_food323.pt")
INCEPTION_WEIGHTS = os.environ.get("INCEPTION_WEIGHTS", f"{MODELS_DIR}/inception_v4_food323.pt")

# Custom Mask2Former checkpoint (class-agnostic food segmentation).
# If the file does not exist, the Hugging Face model is used as-is.
MASK2FORMER_WEIGHTS = os.environ.get("MASK2FORMER_WEIGHTS", f"{MODELS_DIR}/mask2former_agnostic.pt")

# Hugging Face repos. Only provide the *architecture*/preprocessing when local
# weights are present; otherwise they also provide the weights.
MASK2FORMER_ID = os.environ.get("MASK2FORMER_ID", "facebook/mask2former-swin-tiny-coco-instance")

# *Metric* variants of Depth Anything V2: return meters (needed for cm³).
DEPTH_MODEL_SMALL_ID = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
DEPTH_MODEL_LARGE_ID = "depth-anything/Depth-Anything-V2-Metric-Indoor-Large-hf"

# Small: validated end-to-end and the production default.
# Large: higher texture and relief resolution, calibrated via the plate.
DEPTH_MODEL_ID = os.environ.get("DEPTH_MODEL_ID", DEPTH_MODEL_SMALL_ID)

NUTRITION_CSV = os.environ.get("NUTRITION_CSV", "/data/nutrition_wide_densidad.csv")

# Image
MAX_IMAGE_SIDE = 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Segmentation
YOLO_CONF = 0.25
YOLO_IMGSZ = 640
MASK2FORMER_THRESHOLD = 0.5
MIN_MASK_AREA_FRAC = 0.001  # discard masks < 0.1% of the image

# Camera / volume
DEFAULT_HFOV_DEG = 65.0  # fallback when neither EXIF nor client fov_deg is available
MAX_FOOD_HEIGHT_CM = 20.0

# Scale. Monocular depth overestimates distance in close-ups (a plate photo at
# 30-40 cm is placed at 1.5 m), causing volume to blow up. The plate is the size
# reference: its detected rim is used to recompute the true distance.
PLATE_DIAMETER_CM = float(os.environ.get("PLATE_DIAMETER_CM", "26.0"))
# Admissible correction range. Outside this range, the detected circle is assumed not to
# be the plate (e.g. a placemat ring or reflection) and no correction is applied.
PLATE_SCALE_MIN = 0.05
PLATE_SCALE_MAX = 1.6
# Without a plate: if the model places the table beyond this distance, it is the typical
# close-up bias and is clamped to a typical plate-photo distance (with a user warning).
PLATE_FALLBACK_TRIGGER_CM = 80.0
PLATE_FALLBACK_DISTANCE_CM = 35.0

# Sanity caps. If geometry blows up (badly fitted plane, food covering half the frame),
# clamp to what is physically plausible and warn instead of returning 4 kg of pizza.
MAX_MEAN_HEIGHT_CM = 6.0
MAX_TOTAL_WEIGHT_G = 2000.0

# Camera tilt (relative to vertical) above which a non-top-down photo warning is emitted.
# Guided mode targets ≤8°; above 15° volume estimates start to drift.
TILT_WARN_DEG = float(os.environ.get("TILT_WARN_DEG", 15.0))
