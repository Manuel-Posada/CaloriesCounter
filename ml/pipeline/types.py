from dataclasses import dataclass

import numpy as np


@dataclass
class Segment:
    """Una instancia segmentada. `class_idx` es None hasta que se clasifica (Opción B)."""

    mask: np.ndarray  # bool, HxW (tamaño de la imagen procesada)
    score: float
    class_idx: int | None = None
    class_score: float | None = None

    def bbox(self) -> tuple[int, int, int, int]:
        """(x0, y0, x1, y1) exclusivo en x1/y1."""
        ys, xs = np.nonzero(self.mask)
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

