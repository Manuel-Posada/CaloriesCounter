"""Crop classifier (Option B): Inception-V4 (timm) with 323 classes."""
import timm
import torch
from PIL import Image
from timm.data import create_transform, resolve_data_config

from .types import Segment

CROP_PADDING = 0.05
BACKBONE_NAME = "inception_v4"


class _BackboneWithHead(torch.nn.Module):
    """Matches the architecture used to train `inception_v4_food323.pt`:
    timm `inception_v4` without classifier under `backbone` + a separate `fc` layer.
    """

    def __init__(self, num_classes: int):
        super().__init__()
        self.backbone = timm.create_model(BACKBONE_NAME, pretrained=False, num_classes=0)
        self.fc = torch.nn.Linear(self.backbone.num_features, num_classes)

    def forward(self, x):
        return self.fc(self.backbone(x))


def _load_state_dict(path: str, device: str) -> dict:
    ckpt = torch.load(path, map_location=device, weights_only=True)
    for key in ("state_dict", "model_state_dict", "model"):
        if isinstance(ckpt, dict) and key in ckpt and isinstance(ckpt[key], dict):
            ckpt = ckpt[key]
            break
    return {k.removeprefix("module."): v for k, v in ckpt.items()}


def build_inception(weights: str, num_classes: int, device: str) -> torch.nn.Module:
    """Supports checkpoints with `backbone.`/`fc.` prefix as well as standard timm."""
    state = _load_state_dict(weights, device)
    wrapped = any(k.startswith("backbone.") for k in state)

    model = _BackboneWithHead(num_classes) if wrapped else timm.create_model(
        BACKBONE_NAME, pretrained=False, num_classes=num_classes
    )
    model.load_state_dict(state)  # strict: fail loudly on mismatch
    return model


class InceptionV4Classifier:
    def __init__(self, weights: str, num_classes: int, device: str):
        self.device = device
        self.model = build_inception(weights, num_classes, device)
        self.model.to(device).eval()
        # Default timm preprocessing for inception_v4 (299x299, mean/std 0.5).
        # Must match what was used during training.
        self.transform = create_transform(
            **resolve_data_config({}, model=getattr(self.model, "backbone", self.model)),
            is_training=False,
        )

    def _crop(self, image: Image.Image, seg: Segment) -> Image.Image:
        x0, y0, x1, y1 = seg.bbox()
        px, py = int((x1 - x0) * CROP_PADDING), int((y1 - y0) * CROP_PADDING)
        return image.crop((max(0, x0 - px), max(0, y0 - py), min(image.width, x1 + px), min(image.height, y1 + py)))

    @torch.inference_mode()
    def classify(self, image: Image.Image, segments: list[Segment], batch_size: int = 16) -> None:
        """Assign class_idx and class_score in-place to each segment."""
        for i in range(0, len(segments), batch_size):
            chunk = segments[i : i + batch_size]
            batch = torch.stack([self.transform(self._crop(image, s)) for s in chunk]).to(self.device)
            probs = self.model(batch).softmax(dim=1)
            conf, idx = probs.max(dim=1)
            for s, c, p in zip(chunk, idx.tolist(), conf.tolist(), strict=True):
                s.class_idx, s.class_score = int(c), float(p)
