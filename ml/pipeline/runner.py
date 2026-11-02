"""Orquestador: segmentación (A o B) -> profundidad -> volumen -> masa -> nutrición."""
import logging
import time
from typing import Callable

import numpy as np
from PIL import Image

from .config import MIN_MASK_AREA_FRAC, TILT_WARN_DEG
from .nutrition import NutritionTable
from .overlay import mask_centroid, mask_to_polygon
from .types import Segment
from .volume import camera_tilt_deg, estimate_volume_cm3, resolve_focal_px

log = logging.getLogger(__name__)

# Una "estrategia" recibe la imagen y devuelve segmentos YA clasificados.
Strategy = Callable[[Image.Image], list[Segment]]


def build_strategy_a(segmenter) -> Strategy:
    """Opción A: YOLO26-seg segmenta y clasifica a la vez."""
    return segmenter.segment


def build_strategy_b(segmenter, classifier) -> Strategy:
    """Opción B: Mask2Former (agnóstico) + Inception-V4 sobre los recortes."""

    def run(image: Image.Image) -> list[Segment]:
        segments = segmenter.segment(image)
        if segments:
            classifier.classify(image, segments)
        return segments

    return run


class FoodPipeline:
    def __init__(self, strategies: dict[str, Strategy], depth, nutrition: NutritionTable):
        self.strategies = strategies
        self.depth = depth
        self.nutrition = nutrition

    def run(
        self, image: Image.Image, mode: str, fov_deg: float | None = None, f35_mm: float | None = None
    ) -> dict:
        if mode not in self.strategies:
            raise ValueError(f"pipeline desconocido: {mode!r} (opciones: {sorted(self.strategies)})")

        t0 = time.perf_counter()
        segments = self.strategies[mode](image)
        t_seg = time.perf_counter()

        min_area = MIN_MASK_AREA_FRAC * image.width * image.height
        segments = [s for s in segments if s.mask.sum() >= min_area and s.class_idx is not None]

        foods, warnings = [], []
        angles: list[float] = []
        t_depth = t_seg
        if segments:
            depth_m = self.depth.predict(image)
            t_depth = time.perf_counter()
            focal_px = resolve_focal_px(image.width, image.height, fov_deg, f35_mm)
            food_union = np.logical_or.reduce([s.mask for s in segments])

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
                        "confianza": round(s.class_score if s.class_score is not None else s.score, 4),
                        "volumen_cm3": round(vol.volume_cm3, 2),
                        "peso_g": round(n["peso_g"], 2),
                        "densidad_g_cm3": n["densidad_g_cm3"],
                        "densidad_asumida": n["densidad_asumida"],
                        # Contorno normalizado para pintar la zona sobre la foto.
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
                            "altura_media_cm": round(vol.mean_height_cm, 2),
                            "altura_max_cm": round(vol.max_height_cm, 2),
                            "saturado_frac": round(vol.saturated_frac, 3),
                        },
                    }
                )
                if n["densidad_asumida"]:
                    warnings.append({"code": "density_assumed", "params": {"idx": s.class_idx}})

        totals = {
            "volumen_cm3": sum(f["volumen_cm3"] for f in foods),
            "peso_g": sum(f["peso_g"] for f in foods),
            **{k: sum(f["nutricion"][k] for f in foods) for k in
               ("calorias_kcal", "proteinas_g", "carbohidratos_g", "grasas_g")},
        }
        totals = {k: round(v, 2) for k, v in totals.items()}
        totals["clases_detectadas"] = [f["idx"] for f in foods]

        # Un solo ángulo por imagen: la mediana de los planos fiables de cada alimento.
        # None cuando ningún segmento dio un plano del anillo (no se inventa un 0°).
        angulo = round(float(np.median(angles)), 1) if angles else None
        if angulo is not None and angulo > TILT_WARN_DEG:
            warnings.append({"code": "tilt", "params": {"deg": angulo}})

        t_end = time.perf_counter()
        return {
            "pipeline": mode,
            "imagen": {"ancho": image.width, "alto": image.height},
            "alimentos": foods,
            "totales": totals,
            "angulo_camara_deg": angulo,
            "advertencias": warnings,
            "tiempos_ms": {
                "segmentacion": round((t_seg - t0) * 1000),
                "profundidad": round((t_depth - t_seg) * 1000),
                "total": round((t_end - t0) * 1000),
            },
        }

