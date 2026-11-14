"""Mask contours for rendering overlays on the photo in the client.

Coordinates are normalized to [0, 1] (x / width, y / height) so the frontend
can draw them with `viewBox="0 0 1 1"` without knowing the actual image size.
"""
import cv2
import numpy as np

# Enough for the contour to look smooth without bloating JSON (~40 points x 2 floats).
MAX_POINTS = 40
# Simplification tolerance: 0.5% of the perimeter (more faithful than 1% without bloating JSON).
EPSILON_FRAC = 0.005


def mask_to_polygon(mask: np.ndarray, max_points: int = MAX_POINTS) -> list[list[float]]:
    """Main outer contour of the mask, simplified and normalized.

    Returns `[]` if the mask is empty or has zero area: the client simply draws
    nothing for that food item.
    """
    h, w = mask.shape
    if h == 0 or w == 0:
        return []

    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) <= 0:
        return []

    epsilon = EPSILON_FRAC * cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    if len(approx) < 3:
        return []

    if len(approx) > max_points:
        step = int(np.ceil(len(approx) / max_points))
        approx = approx[::step]

    # +0.5 to use the pixel center rather than its corner.
    return [[round(float(x + 0.5) / w, 4), round(float(y + 0.5) / h, 4)] for x, y in approx]


def mask_centroid(mask: np.ndarray) -> tuple[float, float] | None:
    """Normalized mask centroid. `None` if empty.

    Computed over the mask rather than the polygon: for concave shapes the contour
    centroid can fall outside the figure.
    """
    h, w = mask.shape
    if h == 0 or w == 0:
        return None
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return round(float(xs.mean() + 0.5) / w, 4), round(float(ys.mean() + 0.5) / h, 4)
