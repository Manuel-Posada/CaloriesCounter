"""Prueba local del pipeline completo, sin Modal.

Uso (desde ml/, con el venv activado):

    python run_local.py plato.jpg --pipeline B
    python run_local.py plato.jpg --pipeline B --depth-model \\
        depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf

`--pipeline B` usa mask2former_agnostic.pt + inception_v4_food323.pt.
`--pipeline A` usa yolo26_seg_food323.pt.

Los pesos se buscan en la raíz del repo (o donde diga MODELS_DIR).
En CPU puede tardar; en GPU es cuestión de segundos.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def main() -> int:
    ap = argparse.ArgumentParser(description="Pipeline de inferencia en local")
    ap.add_argument("image", type=Path, help="ruta de la foto del plato")
    ap.add_argument("--pipeline", default="B", choices=["A", "B"], help="A=YOLO26-seg, B=Mask2Former+Inception")
    ap.add_argument("--device", default="cpu", help="cpu | cuda | mps")
    ap.add_argument("--fov-deg", type=float, default=None, help="FOV horizontal de la cámara en grados")
    ap.add_argument("--depth-model", default=None, help="repo HF de profundidad (por defecto el de config.py)")
    ap.add_argument("--threshold", type=float, default=None, help="umbral de Mask2Former")
    ap.add_argument("--out", type=Path, default=None, help="guarda el JSON de salida en esta ruta")
    args = ap.parse_args()

    if not args.image.exists():
        ap.error(f"no existe la imagen: {args.image}")

    # Rutas locales por defecto; los valores del entorno tienen prioridad.
    os.environ.setdefault("MODELS_DIR", str(ROOT))
    os.environ.setdefault("NUTRITION_CSV", str(HERE / "data" / "nutrition_wide_densidad.csv"))
    if args.depth_model:
        os.environ["DEPTH_MODEL_ID"] = args.depth_model

    from pipeline import config
    from pipeline.classification import InceptionV4Classifier
    from pipeline.depth import DepthEstimator
    from pipeline.imaging import load_image
    from pipeline.nutrition import NutritionTable
    from pipeline.runner import FoodPipeline, build_strategy_a, build_strategy_b
    from pipeline.segmentation import Mask2FormerSegmenter, YoloSegmenter

    threshold = args.threshold if args.threshold is not None else config.MASK2FORMER_THRESHOLD
    t0 = time.perf_counter()

    if args.pipeline == "B":
        weights = [config.MASK2FORMER_WEIGHTS, config.INCEPTION_WEIGHTS]
    else:
        weights = [config.YOLO_WEIGHTS]
    for w in weights:
        if not Path(w).exists():
            print(f"AVISO: no existe el checkpoint {w}", file=sys.stderr)

    print(f"→ dispositivo: {args.device} | pipeline: {args.pipeline}", file=sys.stderr)
    nutrition = NutritionTable.load(config.NUTRITION_CSV)
    print(f"→ tabla nutricional: {len(nutrition)} clases", file=sys.stderr)

    depth = DepthEstimator(config.DEPTH_MODEL_ID, args.device)
    print(f"→ profundidad: {config.DEPTH_MODEL_ID}", file=sys.stderr)

    strategies = {}
    if args.pipeline == "A":
        yolo = YoloSegmenter(config.YOLO_WEIGHTS, args.device, config.YOLO_CONF, config.YOLO_IMGSZ)
        strategies["A"] = build_strategy_a(yolo)
    else:
        m2f = Mask2FormerSegmenter(config.MASK2FORMER_ID, args.device, threshold, config.MASK2FORMER_WEIGHTS)
        print(f"→ Mask2Former: {m2f.source} (umbral {threshold})", file=sys.stderr)
        inception = InceptionV4Classifier(config.INCEPTION_WEIGHTS, config.NUM_CLASSES, args.device)
        print(f"→ Inception-V4: {Path(config.INCEPTION_WEIGHTS).name}", file=sys.stderr)
        strategies["B"] = build_strategy_b(m2f, inception)

    pipeline = FoodPipeline(strategies=strategies, depth=depth, nutrition=nutrition)
    image, f35 = load_image(args.image.read_bytes())
    print(f"→ imagen: {image.width}x{image.height}px | f35={f35} | carga {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    result = pipeline.run(image, args.pipeline, fov_deg=args.fov_deg, f35_mm=f35)
    payload = json.dumps(result, ensure_ascii=False, indent=2)

    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"→ JSON guardado en {args.out}", file=sys.stderr)
    print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
