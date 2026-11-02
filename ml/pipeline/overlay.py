"""Contornos de las máscaras para pintarlas sobre la foto en el cliente.

Las coordenadas salen normalizadas a [0, 1] (x / ancho, y / alto) para que el frontend
las dibuje con un `viewBox="0 0 1 1"` sin conocer el tamaño real de la imagen.
"""
import cv2
import numpy as np

# Suficiente para que el contorno parezca suave sin inflar el JSON (≈40 puntos × 2 floats).
MAX_POINTS = 40
# Tolerancia de simplificación: 0,5 % del perímetro (más fiel que 1 % sin inflar el JSON).
EPSILON_FRAC = 0.005


def mask_to_polygon(mask: np.ndarray, max_points: int = MAX_POINTS) -> list[list[float]]:
    """Contorno exterior principal de la máscara, simplificado y normalizado.

    Devuelve `[]` si la máscara está vacía o no tiene área: el cliente simplemente no
    dibuja nada para ese alimento.
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

    # +0.5 para usar el centro del píxel, no su esquina.
    return [[round(float(x + 0.5) / w, 4), round(float(y + 0.5) / h, 4)] for x, y in approx]


def mask_centroid(mask: np.ndarray) -> tuple[float, float] | None:
    """Centroide de la máscara, normalizado. `None` si está vacía.

    Se calcula sobre la máscara y no sobre el polígono: en formas cóncavas el centroide
    del contorno puede caer fuera de la figura.
    """
    h, w = mask.shape
    if h == 0 or w == 0:
        return None
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return round(float(xs.mean() + 0.5) / w, 4), round(float(ys.mean() + 0.5) / h, 4)
