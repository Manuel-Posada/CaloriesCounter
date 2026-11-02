"""Detección del plato: la referencia de escala de la escena.

El modelo de profundidad monocular es métrico "en teoría", pero en primeros planos
(la foto de un plato a 30-50 cm) sobreestima la distancia varias veces y el volumen
se dispara: 300 g de comida pueden salir como 57 litros.

El plato es el único objeto de tamaño conocido de la escena. Si se detecta su borde,
la distancia real sale de la geometría pinhole:

    z_cm = f_px · D_plato_cm / D_plato_px

y con ella se corrige la escala de todo el mapa de profundidad.
"""
import math
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

# El plato tiene que ocupar una parte grande del encuadre para que su borde sea fiable
# (y porque es el caso de uso: "foto de tu plato").
MIN_DIAMETER_FRAC = 0.30
MAX_DIAMETER_FRAC = 0.95
# Fracción mínima de píxeles de comida que deben caer dentro del círculo detectado.
MIN_FOOD_INSIDE = 0.98
# Margen de recorte admitido: es habitual que el borde inferior del plato quede a pocos
# píxeles del encuadre y Hough sigue ajustando bien el círculo completo.
MAX_CLIPPED_FRAC = 0.05
# Umbrales de Hough probados en orden: el más estricto primero.
_HOUGH_PARAM2 = (70, 60, 50)


@dataclass
class PlateDetection:
    cx: float
    cy: float
    radius_px: float
    food_inside: float


def detect_plate(image: Image.Image, food_union: np.ndarray | None = None) -> PlateDetection | None:
    """Círculo del borde del plato, o None si no hay uno fiable.

    `food_union` (HxW bool) valida el candidato: toda la comida tiene que estar dentro
    del plato, lo que descarta aros de la mesa, sombras y reflejos.
    """
    gray = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2GRAY)
    gray = cv2.medianBlur(gray, 5)
    h, w = gray.shape[:2]
    min_side = min(h, w)
    has_food = food_union is not None and bool(food_union.any())

    best: PlateDetection | None = None
    for param2 in _HOUGH_PARAM2:
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=min_side / 2,
            param1=120,
            param2=param2,
            minRadius=int(min_side * 0.22),
            maxRadius=int(min_side * 0.55),
        )
        if circles is None:
            continue
        for cx, cy, r in circles[0]:
            if not MIN_DIAMETER_FRAC <= 2 * r / w <= MAX_DIAMETER_FRAC:
                continue
            # El plato completo dentro del encuadre (con un margen): un círculo cortado por
            # el borde no permite medir su diámetro. Hough lo ajusta igual si sólo asoma un
            # poco, y es habitual que el borde inferior quede pegado al encuadre.
            margin = MAX_CLIPPED_FRAC * min_side
            if cx - r < -margin or cy - r < -margin or cx + r > w + margin or cy + r > h + margin:
                continue
            if has_food:
                inside = _food_inside(food_union, cx, cy, r)
                if inside < MIN_FOOD_INSIDE:
                    continue
            else:
                inside = 1.0
            cand = PlateDetection(float(cx), float(cy), float(r), inside)
            # Varios candidatos válidos: el plato es el mayor (los pequeños son dibujos
            # del patrón o el fondo de una taza).
            if best is None or cand.radius_px > best.radius_px:
                best = cand
        if best is not None:
            break
    return best


def _food_inside(mask: np.ndarray, cx: float, cy: float, r: float) -> float:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 1.0
    return float(np.mean((xs - cx) ** 2 + (ys - cy) ** 2 <= r * r))


def plate_distance_cm(plate: PlateDetection, focal_px: float, diameter_cm: float) -> float:
    """Distancia a la que está el plato según su diámetro aparente."""
    return focal_px * diameter_cm / (2.0 * plate.radius_px)


def is_plausible_scale(k: float, k_min: float, k_max: float) -> bool:
    return math.isfinite(k) and k_min <= k <= k_max


def resolve_depth_scale(
    depth_m: np.ndarray,
    plate: PlateDetection | None,
    focal_px: float,
    *,
    diameter_cm: float,
    k_min: float,
    k_max: float,
    fallback_trigger_cm: float,
    fallback_distance_cm: float,
) -> tuple[float, str]:
    """Factor por el que hay que multiplicar la profundidad y de dónde sale.

    "plate"  -> corregido con el diámetro del plato (el caso bueno).
    "prior"  -> sin plato y el modelo dice que la mesa está lejísimos: se acota a una
                distancia típica de foto de plato.
    "raw"    -> se deja como está (dentro de un rango razonable).
    """
    z_model_cm = float(np.median(depth_m)) * 100.0

    if plate is not None:
        k = plate_distance_cm(plate, focal_px, diameter_cm) / z_model_cm
        if is_plausible_scale(k, k_min, k_max):
            return k, "plate"

    if z_model_cm > fallback_trigger_cm:
        k = min(max(fallback_distance_cm / z_model_cm, k_min), 1.0)
        return k, "prior"
    return 1.0, "raw"

