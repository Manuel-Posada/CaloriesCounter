"""Extrae los datos reales del pipeline para los recursos visuales.

Guarda `datos_visuales.npz`, `resultado_pipeline_B.json` y `segmentos.csv`.
Se ejecuta desde `generar_recursos.py`; no dibuja nada (así los modelos se
liberan antes de que matplotlib necesite RAM).
"""
import csv
import gc
import json
import math
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
ML = ROOT / "ml"
sys.path.insert(0, str(ML))
os.environ.setdefault("MODELS_DIR", str(ROOT))
os.environ.setdefault("NUTRITION_CSV", str(ML / "data" / "nutrition_wide_densidad.csv"))

from pipeline import config  # noqa: E402
from pipeline.classification import InceptionV4Classifier  # noqa: E402
from pipeline.depth import DepthEstimator  # noqa: E402
from pipeline.imaging import load_image  # noqa: E402
from pipeline.nutrition import NutritionTable  # noqa: E402
from pipeline.plate import detect_plate, resolve_depth_scale  # noqa: E402
from pipeline.runner import FoodPipeline  # noqa: E402
from pipeline.segmentation import Mask2FormerSegmenter  # noqa: E402
from pipeline.volume import (  # noqa: E402
    MAX_SATURATED_FRAC,
    MIN_PLANE_POINTS,
    _dilate,
    _fit_plane_ransac,
    estimate_volume_cm3,
    resolve_focal_px,
)
from pipeline.config import MAX_FOOD_HEIGHT_CM  # noqa: E402

HERE = Path(__file__).resolve().parent
IMG = ROOT / "34g_platano_163cerdo_105papa.jpg"


def _to_3d(depth_m, ys, xs, focal_px, cx, cy):
    z = depth_m[ys, xs].astype(np.float64) * 100.0
    nx = (xs - cx) / focal_px
    ny = (ys - cy) / focal_px
    rays = np.stack([nx, ny, np.ones_like(nx)], axis=1)
    return rays * z[:, None], rays, z


def _heightmap(mask, food_union, depth_m, focal_px, seed=0):
    """Replica la geometría de volume.estimate_volume_cm3 y devuelve el mapa de altura."""
    h, w = mask.shape
    area_px = int(mask.sum())
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    rng = np.random.default_rng(seed)
    k = max(5, int(0.25 * math.sqrt(area_px)))
    k_in = max(2, k // 5)
    food_excl = _dilate(food_union | mask, k_in)
    candidates = (
        ("ring", _dilate(mask, k) & ~food_excl),
        ("background", ~food_excl),
    )
    plane, source = None, "fallback"
    for name, region in candidates:
        if region.sum() < MIN_PLANE_POINTS:
            continue
        ys, xs = np.nonzero(region)
        P, _, _ = _to_3d(depth_m, ys, xs, focal_px, cx, cy)
        plane = _fit_plane_ransac(P, rng)
        if plane is not None:
            source = name
            break

    ys, xs = np.nonzero(mask)
    P, _, z = _to_3d(depth_m, ys, xs, focal_px, cx, cy)
    ring = candidates[0][1]

    def frontoparallel():
        if ring.sum() >= 30:
            ry, rx = np.nonzero(ring)
            z_ref = float(np.median(depth_m[ry, rx])) * 100.0
        else:
            z_ref = float(np.percentile(z, 90))
        return np.array([0.0, 0.0, 1.0]), z_ref

    if plane is None:
        n, d = frontoparallel()
        ratio = None
    else:
        n, d, ratio = plane
    if -d < 0:
        n, d = -n, -d

    hvals = np.clip(P @ n - d, 0.0, MAX_FOOD_HEIGHT_CM)
    saturated = float((hvals >= MAX_FOOD_HEIGHT_CM * 0.98).mean())
    if saturated > MAX_SATURATED_FRAC and source != "fallback":
        n_fb, d_fb = frontoparallel()
        h_fb = np.clip(P @ n_fb - d_fb, 0.0, MAX_FOOD_HEIGHT_CM)
        sat_fb = float((h_fb >= MAX_FOOD_HEIGHT_CM * 0.98).mean())
        if sat_fb < saturated:
            n, d, hvals, saturated, source = n_fb, d_fb, h_fb, sat_fb, "fallback"

    hmap = np.zeros((h, w), np.float32)
    hmap[ys, xs] = hvals
    return hmap, n, d, source, ratio, saturated


def main():
    print("Cargando foto y modelos (CPU)...")
    image, f35 = load_image(IMG.read_bytes())
    depth = DepthEstimator(config.DEPTH_MODEL_ID, "cpu")
    depth_m = depth.predict(image)

    m2f = Mask2FormerSegmenter(config.MASK2FORMER_ID, "cpu", config.MASK2FORMER_THRESHOLD, config.MASK2FORMER_WEIGHTS)
    classifier = InceptionV4Classifier(config.INCEPTION_WEIGHTS, config.NUM_CLASSES, "cpu")
    segments = m2f.segment(image)
    classifier.classify(image, segments)
    segments = [s for s in segments if s.mask.sum() >= config.MIN_MASK_AREA_FRAC * image.width * image.height and s.class_idx is not None]
    print(f"  máscaras: {len(segments)}")

    focal_px = resolve_focal_px(image.width, image.height, None, f35)
    food_union = np.logical_or.reduce([s.mask for s in segments])
    plate = detect_plate(image, food_union)
    scale, scale_source = resolve_depth_scale(
        depth_m, plate, focal_px, diameter_cm=config.PLATE_DIAMETER_CM,
        k_min=config.PLATE_SCALE_MIN, k_max=config.PLATE_SCALE_MAX,
        fallback_trigger_cm=config.PLATE_FALLBACK_TRIGGER_CM,
        fallback_distance_cm=config.PLATE_FALLBACK_DISTANCE_CM,
    )
    depth_scaled = (depth_m * scale).astype(np.float32)
    print(f"  escala: x{scale:.4f} ({scale_source}) | plato: {plate.radius_px:.0f}px")

    nutrition = NutritionTable.load(config.NUTRITION_CSV)
    pipeline = FoodPipeline({"B": lambda _img: segments}, depth=depth, nutrition=nutrition)
    result = pipeline.run(image, "B", fov_deg=None, f35_mm=f35)
    (HERE / "resultado_pipeline_B.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    pairs = []
    for seg, food in zip(segments, result["alimentos"]):
        vol = estimate_volume_cm3(depth_scaled, seg.mask, food_union, focal_px)
        hmap, n, d, source, ratio, sat = _heightmap(seg.mask, food_union, depth_scaled, focal_px)
        ys, xs = np.nonzero(seg.mask)
        pairs.append(dict(
            mask=seg.mask, food=food, vol=vol, hmap=hmap, plane=(n, d), plane_source=source,
            ratio=ratio, saturated=sat, centroid=(float(xs.mean()), float(ys.mean())),
        ))
    pairs.sort(key=lambda p: p["centroid"][0])

    corrections = [
        dict(idx=42, nombre="plátano", real_g=34.0),
        dict(idx=316, nombre="cerdo", real_g=163.0),
        dict(idx=206, nombre="patata asada", real_g=105.0),
    ]
    for p, corr in zip(pairs, corrections):
        rec = nutrition.get(corr["idx"])
        p["correct_idx"] = corr["idx"]
        p["correct_name"] = corr["nombre"]
        p["real_g"] = corr["real_g"]
        p["correct_g"] = float(p["food"]["volumen_cm3"] * rec.density_g_cm3)
        p["correct_kcal"] = float(p["correct_g"] / 100.0 * rec.kcal_100g)
        p["correct_density"] = rec.density_g_cm3

    rows = []
    for i, p in enumerate(pairs, 1):
        f = p["food"]
        rows.append(dict(
            segmento=i, clase_detectada=f["nombre"], nombre_detectado=f["nombre_es"],
            confianza=f["confianza"], volumen_cm3=f["volumen_cm3"],
            densidad_g_cm3=f["densidad_g_cm3"], peso_g=f["peso_g"], kcal=f["nutricion"]["calorias_kcal"],
            altura_media_cm=f["debug_volumen"]["altura_media_cm"], altura_max_cm=f["debug_volumen"]["altura_max_cm"],
            plano=f["debug_volumen"]["plano"], area_frac=f["debug_volumen"]["area_frac"],
            clase_corregida=p["correct_name"], densidad_corregida=p["correct_density"],
            peso_corregido_g=round(p["correct_g"], 2), kcal_corregido=round(p["correct_kcal"], 2),
            peso_real_g=p["real_g"],
        ))
    with open(HERE / "segmentos.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    biggest = max(pairs, key=lambda p: p["mask"].sum())
    n_big, d_big = biggest["plane"]
    ys, xs = np.nonzero(food_union)
    P, _, _ = _to_3d(depth_scaled, ys, xs, focal_px, (image.width - 1) / 2.0, (image.height - 1) / 2.0)
    h_all = np.clip(P @ n_big - d_big, 0, MAX_FOOD_HEIGHT_CM)
    hmap_all = np.zeros_like(depth_scaled, dtype=np.float32)
    hmap_all[ys, xs] = h_all

    np.savez_compressed(
        HERE / "datos_visuales.npz",
        image=np.asarray(image),
        depth_raw=depth_m.astype(np.float32),
        depth_scaled=depth_scaled,
        masks=np.stack([p["mask"] for p in pairs]),
        hmaps=np.stack([p["hmap"] for p in pairs]),
        hmap_all=hmap_all,
        food_union=food_union,
        centroids=np.array([p["centroid"] for p in pairs], np.float32),
        plate=np.array([plate.cx, plate.cy, plate.radius_px], np.float32) if plate else np.zeros(0, np.float32),
        scale=np.float32(scale), scale_source=np.array(scale_source),
        labels=np.array([p["food"]["nombre"] for p in pairs]),
        labels_es=np.array([p["food"]["nombre_es"] for p in pairs]),
        weights=np.array([p["food"]["peso_g"] for p in pairs], np.float32),
        volumes=np.array([p["food"]["volumen_cm3"] for p in pairs], np.float32),
        kcal=np.array([p["food"]["nutricion"]["calorias_kcal"] for p in pairs], np.float32),
        densities=np.array([p["food"]["densidad_g_cm3"] for p in pairs], np.float32),
        confidences=np.array([p["food"]["confianza"] for p in pairs], np.float32),
        altura_media=np.array([p["food"]["debug_volumen"]["altura_media_cm"] for p in pairs], np.float32),
        altura_max=np.array([p["food"]["debug_volumen"]["altura_max_cm"] for p in pairs], np.float32),
        area_frac=np.array([p["food"]["debug_volumen"]["area_frac"] for p in pairs], np.float32),
        plane=np.array([p["food"]["debug_volumen"]["plano"] for p in pairs]),
        correct_names=np.array([p["correct_name"] for p in pairs]),
        correct_g=np.array([p["correct_g"] for p in pairs], np.float32),
        correct_kcal=np.array([p["correct_kcal"] for p in pairs], np.float32),
        correct_density=np.array([p["correct_density"] for p in pairs], np.float32),
        real_g=np.array([p["real_g"] for p in pairs], np.float32),
        focal_px=np.float32(focal_px),
    )
    print("  guardado datos_visuales.npz")
    print("Total detectado:", result["totales"]["peso_g"], "g | real: 302 g")
    for p in pairs:
        print(f"  {p['food']['nombre_es']}: {p['food']['peso_g']:.1f} g -> {p['correct_name']} {p['correct_g']:.1f} g (real {p['real_g']} g)")

    del pipeline, depth, m2f, classifier
    gc.collect()


if __name__ == "__main__":
    main()
