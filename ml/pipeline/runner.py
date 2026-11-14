"""Orchestrator: segmentation (A or B) -> depth -> volume -> mass -> nutrition."""
import logging
import math
import time
from collections.abc import Callable

import numpy as np
from PIL import Image

from .config import (
    MAX_MEAN_HEIGHT_CM,
    MAX_TOTAL_WEIGHT_G,
    MIN_MASK_AREA_FRAC,
    PLATE_DIAMETER_CM,
    PLATE_FALLBACK_DISTANCE_CM,
    PLATE_FALLBACK_TRIGGER_CM,
    PLATE_SCALE_MAX,
    PLATE_SCALE_MIN,
    TILT_WARN_DEG,
)
from .nutrition import NutritionTable
from .overlay import mask_centroid, mask_to_polygon
from .plate import detect_plate, resolve_depth_scale
from .types import Segment
from .volume import camera_tilt_deg, estimate_volume_cm3, resolve_focal_px

log = logging.getLogger(__name__)

# A "strategy" takes an image and returns ALREADY classified segments.
Strategy = Callable[[Image.Image], list[Segment]]


def build_strategy_a(segmenter) -> Strategy:
    """Option A: YOLO26-seg segments and classifies in one step."""
    return segmenter.segment


def build_strategy_b(segmenter, classifier) -> Strategy:
    """Option B: Mask2Former (class-agnostic) + Inception-V4 on crops."""

    def run(image: Image.Image) -> list[Segment]:
        segments = segmenter.segment(image)
        if segments:
            classifier.classify(image, segments)
        return segments

    return run


def _scale_food(food: dict, factor: float) -> None:
    """Rescale volume, weight, and nutrients of a food item (macros scale linearly)."""
    food["volumen_cm3"] = round(food["volumen_cm3"] * factor, 2)
    food["peso_g"] = round(food["peso_g"] * factor, 2)
    for key in ("calorias_kcal", "proteinas_g", "carbohidratos_g", "grasas_g"):
        food["nutricion"][key] = round(food["nutricion"][key] * factor, 2)
    dbg = food["debug_volumen"]
    dbg["altura_media_cm"] = round(dbg["altura_media_cm"] * factor, 2)
    dbg["altura_max_cm"] = round(dbg["altura_max_cm"] * factor, 2)


class FoodPipeline:
    def __init__(self, strategies: dict[str, Strategy], depth, nutrition: NutritionTable):
        self.strategies = strategies
        self.depth = depth
        self.nutrition = nutrition

    def run(
        self,
        image: Image.Image,
        mode: str,
        fov_deg: float | None = None,
        f35_mm: float | None = None,
        depth_model: str = "small",
    ) -> dict:
        if mode not in self.strategies:
            raise ValueError(f"unknown pipeline: {mode!r} (options: {sorted(self.strategies)})")

        t0 = time.perf_counter()
        segments = self.strategies[mode](image)
        t_seg = time.perf_counter()

        min_area = MIN_MASK_AREA_FRAC * image.width * image.height
        segments = [s for s in segments if s.mask.sum() >= min_area and s.class_idx is not None]

        foods, warnings = [], []
        angles: list[float] = []
        scale, scale_source = 1.0, "raw"
        t_depth = t_seg
        if segments:
            # Supports both a single DepthEstimator and a dict {"small": ..., "large": ...}
            if isinstance(self.depth, dict):
                estimator = self.depth.get(depth_model.lower(), self.depth.get("small", next(iter(self.depth.values()))))
            else:
                estimator = self.depth
            depth_m = estimator.predict(image)
            t_depth = time.perf_counter()
            focal_px = resolve_focal_px(image.width, image.height, fov_deg, f35_mm)
            food_union = np.logical_or.reduce([s.mask for s in segments])

            # Monocular depth underestimates/overestimates close-ups: rescale using the
            # plate diameter before measuring anything.
            plate = detect_plate(image, food_union)
            scale, scale_source = resolve_depth_scale(
                depth_m,
                plate,
                focal_px,
                diameter_cm=PLATE_DIAMETER_CM,
                k_min=PLATE_SCALE_MIN,
                k_max=PLATE_SCALE_MAX,
                fallback_trigger_cm=PLATE_FALLBACK_TRIGGER_CM,
                fallback_distance_cm=PLATE_FALLBACK_DISTANCE_CM,
            )
            if not math.isclose(scale, 1.0):
                depth_m = (depth_m * scale).astype(np.float32)
            log.info("depth scale x%.3f (%s)", scale, scale_source)
            if scale_source != "plate":
                warnings.append({"code": "no_plate_reference"})

            for s in segments:
                if s.class_idx not in self.nutrition:
                    warnings.append({"code": "class_missing", "params": {"idx": s.class_idx}})
                    continue
                vol = estimate_volume_cm3(depth_m, s.mask, food_union, focal_px)
                if vol.plane_normal is not None:
                    angles.append(camera_tilt_deg(vol.plane_normal))
                n = self.nutrition.compute(s.class_idx, vol.volume_cm3)
                if vol.saturated_frac > 0.5:
                    warnings.append({"code": "low_volume", "params": {"idx": s.class_idx}})
                foods.append(
                    {
                        "idx": s.class_idx,
                        "nombre": n["nombre"],
                        "nombre_es": n["nombre_es"],
                        "confianza": round(s.class_score if s.class_score is not None else s.score, 4),
                        "volumen_cm3": round(vol.volume_cm3, 2),
                        "peso_g": round(n["peso_g"], 2),
                        "densidad_g_cm3": n["densidad_g_cm3"],
                        "densidad_asumida": n["densidad_asumida"],
                        # Normalized contour for drawing the region over the photo.
                        "poligono": mask_to_polygon(s.mask),
                        "centroide": list(centroid) if (centroid := mask_centroid(s.mask)) else None,
                        "nutricion": {
                            "calorias_kcal": round(n["calorias_kcal"], 2),
                            "proteinas_g": round(n["proteinas_g"], 2),
                            "carbohidratos_g": round(n["carbohidratos_g"], 2),
                            "grasas_g": round(n["grasas_g"], 2),
                            "por_100g": n["por_100g"],
                        },
                        "debug_volumen": {
                            "plano": vol.plane_source,
                            "escala": round(scale, 3),
                            "escala_origen": scale_source,
                            "area_frac": round(float(s.mask.mean()), 4),
                            "altura_media_cm": round(vol.mean_height_cm, 2),
                            "altura_max_cm": round(vol.max_height_cm, 2),
                            "saturado_frac": round(vol.saturated_frac, 3),
                        },
                    }
                )
                if n["densidad_asumida"]:
                    warnings.append({"code": "density_assumed", "params": {"idx": s.class_idx}})

        # --- sanity caps ------------------------------------------------------
        # If geometry is physically impossible (badly fitted plane, food covering half the
        # frame), clamp to plausible limits and warn instead of returning kilograms of food.
        clamped = False
        for food in foods:
            dbg = food["debug_volumen"]
            if dbg["altura_media_cm"] > MAX_MEAN_HEIGHT_CM:
                _scale_food(food, MAX_MEAN_HEIGHT_CM / dbg["altura_media_cm"])
                dbg["recortado"] = True
                clamped = True
        total_g = sum(f["peso_g"] for f in foods)
        if total_g > MAX_TOTAL_WEIGHT_G:
            for food in foods:
                _scale_food(food, MAX_TOTAL_WEIGHT_G / total_g)
            clamped = True
        if clamped:
            warnings.append({"code": "volume_clamped"})

        totals = {
            "volumen_cm3": sum(f["volumen_cm3"] for f in foods),
            "peso_g": sum(f["peso_g"] for f in foods),
            **{k: sum(f["nutricion"][k] for f in foods) for k in
               ("calorias_kcal", "proteinas_g", "carbohidratos_g", "grasas_g")},
        }
        totals = {k: round(v, 2) for k, v in totals.items()}
        totals["clases_detectadas"] = [f["idx"] for f in foods]

        # Single angle per image: median across reliable food planes.
        # None when no segment yielded a ring plane (never fabricate 0°).
        angulo = round(float(np.median(angles)), 1) if angles else None
        if angulo is not None and angulo > TILT_WARN_DEG:
            warnings.append({"code": "tilt", "params": {"deg": angulo}})

        t_end = time.perf_counter()
        return {
            "pipeline": mode,
            "imagen": {"ancho": image.width, "alto": image.height},
            "alimentos": foods,
            "totales": totals,
            "escala": {
                "origen": scale_source,
                "factor": round(scale, 4),
                "plate_diameter_cm": PLATE_DIAMETER_CM,
            },
            "angulo_camara_deg": angulo,
            "advertencias": warnings,
            "tiempos_ms": {
                "segmentacion": round((t_seg - t0) * 1000),
                "profundidad": round((t_depth - t_seg) * 1000),
                "total": round((t_end - t0) * 1000),
            },
        }

