"""Estimación de volumen aparente (cm³) a partir de profundidad métrica + máscara.

Método (heightfield sobre el plano de apoyo):
  1. Se retroproyecta el mapa de profundidad (metros) a 3D con un modelo pinhole.
  2. Se ajusta con RANSAC el plano de apoyo (mesa/plato) usando el anillo de píxeles
     que rodea la máscara y que no pertenece a ningún alimento.
  3. Para cada píxel de la máscara, altura h = distancia del punto 3D al plano.
  4. Volumen = Σ h · A_píxel, con A_píxel = z² / (f² · |n·d|) (huella del píxel proyectada
     sobre el plano; z = profundidad del punto, n = normal del plano, d = rayo (x,y,1)).

Solo mide lo visible desde la cámara (volumen "aparente").
Todo en cm internamente; la profundidad de entrada viene en metros.
"""
import math
from dataclasses import dataclass

import cv2
import numpy as np

from .config import DEFAULT_HFOV_DEG, MAX_FOOD_HEIGHT_CM

MIN_PLANE_POINTS = 300
MIN_INLIER_RATIO = 0.25
MIN_NORMAL_Z = 0.2  # |n_z| mínimo: la mesa debe "mirar" a la cámara
MIN_RAY_COS = 0.2
RANSAC_ITERS = 150
RANSAC_TOL_CM = 1.0
RANSAC_MAX_POINTS = 3000
_DIAG_35MM_MM = 43.27


@dataclass
class VolumeResult:
    volume_cm3: float
    plane_source: str  # "ring" | "background" | "fallback"
    inlier_ratio: float | None
    mean_height_cm: float
    max_height_cm: float
    saturated_frac: float = 0.0  # fracción de píxeles que tocan el techo de altura
    # Normal del plano de apoyo en coordenadas de cámara (z = eje óptico). Sólo se rellena
    # cuando el plano final es fiable (`plane_source == "ring"`); si no, queda en None.
    plane_normal: tuple[float, float, float] | None = None


def camera_tilt_deg(normal) -> float:
    """Ángulo entre la normal del plano de apoyo y el eje óptico, en grados.

    0° significa que la mesa es perpendicular a la cámara: foto cenital.
    El signo de la normal es irrelevante, de ahí el valor absoluto.
    """
    n = np.asarray(normal, dtype=np.float64)
    norm = np.linalg.norm(n)
    if norm < 1e-9:
        return 0.0
    return float(np.degrees(np.arccos(np.clip(abs(n[2] / norm), 0.0, 1.0))))


# Si más de esta fracción de la máscara satura `MAX_FOOD_HEIGHT_CM`, el plano de
# apoyo es poco fiable (típico: RANSAC elige una pared del fondo en vez de la mesa).
MAX_SATURATED_FRAC = 0.5


def resolve_focal_px(width: int, height: int, fov_deg: float | None = None, f35_mm: float | None = None) -> float:
    """Focal en píxeles. Prioridad: fov horizontal explícito > EXIF (35 mm eq.) > por defecto."""
    if fov_deg is not None:
        if not 10.0 <= fov_deg <= 170.0:
            raise ValueError("fov_deg debe estar entre 10 y 170")
        return (width / 2.0) / math.tan(math.radians(fov_deg) / 2.0)
    if f35_mm and f35_mm > 0:
        # La focal equivalente en 35 mm se define sobre la diagonal.
        return f35_mm * math.hypot(width, height) / _DIAG_35MM_MM
    return (width / 2.0) / math.tan(math.radians(DEFAULT_HFOV_DEG) / 2.0)


def _dilate(mask: np.ndarray, k: int) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    return cv2.dilate(mask.astype(np.uint8), kernel).astype(bool)


def _fit_plane_ransac(P: np.ndarray, rng: np.random.Generator):
    """Devuelve (n, d, inlier_ratio) con n·P = d, o None si no hay plano fiable."""
    if len(P) > RANSAC_MAX_POINTS:
        P = P[rng.choice(len(P), RANSAC_MAX_POINTS, replace=False)]
    best_inliers = None
    for _ in range(RANSAC_ITERS):
        p0, p1, p2 = P[rng.choice(len(P), 3, replace=False)]
        n = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(n)
        if norm < 1e-9:
            continue
        n /= norm
        inliers = np.abs(P @ n - n @ p0) < RANSAC_TOL_CM
        if best_inliers is None or inliers.sum() > best_inliers.sum():
            best_inliers = inliers
    if best_inliers is None or best_inliers.sum() < 3:
        return None
    ratio = float(best_inliers.mean())
    Q = P[best_inliers]
    c = Q.mean(axis=0)
    n = np.linalg.svd(Q - c, full_matrices=False)[2][-1]  # mínimo autovector
    if abs(n[2]) < MIN_NORMAL_Z or ratio < MIN_INLIER_RATIO:
        return None
    return n, float(n @ c), ratio


def estimate_volume_cm3(
    depth_m: np.ndarray,
    mask: np.ndarray,
    food_union: np.ndarray,
    focal_px: float,
    *,
    max_height_cm: float = MAX_FOOD_HEIGHT_CM,
    seed: int = 0,
) -> VolumeResult:
    """
    depth_m:    HxW profundidad métrica en metros.
    mask:       HxW bool, el alimento a medir.
    food_union: HxW bool, unión de TODAS las máscaras de alimentos (se excluye del ajuste del plano).
    """
    H, W = mask.shape
    area_px = int(mask.sum())
    if area_px == 0:
        return VolumeResult(0.0, "fallback", None, 0.0, 0.0)

    cx, cy = (W - 1) / 2.0, (H - 1) / 2.0
    rng = np.random.default_rng(seed)

    def to_3d(ys, xs):
        z = depth_m[ys, xs].astype(np.float64) * 100.0
        nx, ny = (xs - cx) / focal_px, (ys - cy) / focal_px
        rays = np.stack([nx, ny, np.ones_like(nx)], axis=1)
        return rays * z[:, None], rays, z

    # --- 1-2. plano de apoyo ---
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
        P, _, _ = to_3d(ys, xs)
        plane = _fit_plane_ransac(P, rng)
        if plane is not None:
            source = name
            break

    ys, xs = np.nonzero(mask)
    P, rays, z = to_3d(ys, xs)

    ring = candidates[0][1]

    def frontoparallel_plane():
        """Plano paralelo al sensor a la profundidad del entorno (mesa)."""
        if ring.sum() >= 30:
            ry, rx = np.nonzero(ring)
            z_ref = float(np.median(depth_m[ry, rx])) * 100.0
        else:
            z_ref = float(np.percentile(z, 90))
        return np.array([0.0, 0.0, 1.0]), z_ref

    if plane is None:
        # Plano fronto-paralelo a la profundidad del fondo: percentil alto dentro de la máscara
        # (o mediana del anillo, si existe).
        n, d = frontoparallel_plane()
        ratio = None
    else:
        n, d, ratio = plane

    # Orientar para que la cámara (origen) quede del lado positivo: altura = n·P - d > 0.
    if -d < 0:
        n, d = -n, -d

    def heights(normal, offset):
        return np.clip(P @ normal - offset, 0.0, max_height_cm)

    h = heights(n, d)
    saturated = float((h >= max_height_cm * 0.98).mean())

    # Salvaguarda: si casi toda la máscara satura, el plano está mal (p. ej. se ajustó a una
    # pared del fondo). Se prueba el plano fronto-paralelo del entorno y se queda el mejor.
    if saturated > MAX_SATURATED_FRAC and source != "fallback":
        n_fb, d_fb = frontoparallel_plane()
        h_fb = heights(n_fb, d_fb)
        saturated_fb = float((h_fb >= max_height_cm * 0.98).mean())
        if saturated_fb < saturated:
            n, d, h, saturated, source = n_fb, d_fb, h_fb, saturated_fb, "fallback"

    # --- 3-4. alturas y volumen ---
    cos_ray = np.clip(np.abs(rays @ n), MIN_RAY_COS, None)
    pixel_area = z**2 / (focal_px**2 * cos_ray)
    volume = float(np.sum(h * pixel_area))

    return VolumeResult(
        volume_cm3=volume,
        plane_source=source,
        inlier_ratio=ratio,
        mean_height_cm=float(h.mean()),
        max_height_cm=float(h.max()),
        saturated_frac=saturated,
        # Sólo el plano del anillo es la mesa de verdad. El del fondo y el fronto-paralelo
        # de la salvaguarda no sirven para medir inclinación (darían un 0° falso).
        plane_normal=tuple(float(c) for c in n) if source == "ring" else None,
    )

