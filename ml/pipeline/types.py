from dataclasses import dataclass

import numpy as np


@dataclass
class Segment:
    """A segmented instance. `class_idx` is None until classified (Option B)."""

    mask: np.ndarray  # bool, HxW (processed image dimensions)
    score: float
    class_idx: int | None = None
    class_score: float | None = None

    def bbox(self) -> tuple[int, int, int, int]:
        """(x0, y0, x1, y1) with exclusive x1/y1."""
        ys, xs = np.nonzero(self.mask)
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

