"""Plate detection: the scene's scale reference.

The monocular depth model is metric "in theory", but in close-ups
(a plate photo at 30-50 cm) it overestimates distance several-fold and volume
blows up: 300 g of food can come out as 57 liters.

The plate is the only object of known size in the scene. If its rim is detected,
the true distance comes from pinhole geometry:

    z_cm = f_px * D_plate_cm / D_plate_px

and this rescales the entire depth map.
"""
import math
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

# The plate must occupy a large portion of the frame for its rim to be reliable
# (and because that is the use case: "photo of your plate").
MIN_DIAMETER_FRAC = 0.30
MAX_DIAMETER_FRAC = 0.95
# Minimum fraction of food pixels that must fall inside the detected circle.
MIN_FOOD_INSIDE = 0.98
# Allowed clipping margin: the bottom rim of the plate often sits a few pixels
# outside the frame and Hough still fits the full circle accurately.
MAX_CLIPPED_FRAC = 0.05
# Hough thresholds tried in order: strictest first.
_HOUGH_PARAM2 = (70, 60, 50)


@dataclass
class PlateDetection:
    cx: float
    cy: float
    radius_px: float
    food_inside: float


def detect_plate(image: Image.Image, food_union: np.ndarray | None = None) -> PlateDetection | None:
    """Plate rim circle, or None if no reliable candidate is found.

    `food_union` (HxW bool) validates the candidate: all food must be inside
    the plate, which filters out table rings, shadows, and reflections.
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
            # Full plate inside the frame (with a margin): a circle clipped by the edge
            # cannot measure diameter. Hough still fits it if it only peeks out slightly,
            # and the bottom rim often touches the frame edge.
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
            # Multiple valid candidates: the plate is the largest (smaller ones are
            # pattern rings or the bottom of a cup).
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
    """Distance to the plate based on its apparent diameter."""
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
    """Factor to multiply depth by and its source.

    "plate"  -> corrected using the plate diameter (the good case).
    "prior"  -> no plate and the model says the table is very far: clamped to a
                typical plate-photo distance.
    "raw"    -> left as-is (within a reasonable range).
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

