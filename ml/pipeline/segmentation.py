"""Segmenters. Both expose `segment(image) -> list[Segment]`.

- YoloSegmenter (Option A): segments AND classifies (class_idx is already resolved).
- Mask2FormerSegmenter (Option B): class-agnostic segmentation (class_idx = None);
  classification is performed afterward by `InceptionV4Classifier`.

Mask2FormerSegmenter accepts a custom checkpoint (e.g. `mask2former_agnostic.pt`).
In that case, only the *architecture* (`config.json`) is downloaded from Hugging Face,
automatically chosen from the checkpoint's Swin encoder size.
"""
import logging
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, Mask2FormerConfig, Mask2FormerForUniversalSegmentation

from .types import Segment

log = logging.getLogger(__name__)

# Patch embedding embed_dim -> HF repo with the same architecture.
_SWIN_BY_EMBED_DIM = {
    96: "facebook/mask2former-swin-tiny-coco-instance",
    128: "facebook/mask2former-swin-small-coco-instance",
    192: "facebook/mask2former-swin-base-coco-instance",
    256: "facebook/mask2former-swin-large-coco-instance",
}
_EMBED_DIM_KEY = "model.pixel_level_module.encoder.swin.embeddings.patch_embeddings.projection.weight"


class YoloSegmenter:
    def __init__(self, weights: str, device: str, conf: float, imgsz: int):
        from ultralytics import YOLO

        self.model = YOLO(weights)
        self.device, self.conf, self.imgsz = device, conf, imgsz

    def segment(self, image: Image.Image) -> list[Segment]:
        # Pass PIL (RGB) directly; with an ndarray ultralytics assumes BGR.
        res = self.model.predict(
            image, conf=self.conf, imgsz=self.imgsz, retina_masks=True, device=self.device, verbose=False
        )[0]
        if res.masks is None:
            return []
        masks = res.masks.data.cpu().numpy() > 0.5
        classes = res.boxes.cls.cpu().numpy().astype(int)
        scores = res.boxes.conf.cpu().numpy()
        size = (image.width, image.height)

        out = []
        for m, c, s in zip(masks, classes, scores, strict=True):
            if m.shape != (image.height, image.width):
                m = cv2.resize(m.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST).astype(bool)
            out.append(Segment(mask=m, score=float(s), class_idx=int(c), class_score=float(s)))
        return out


def _extract_state_dict(ckpt) -> dict:
    """Accept {state_dict: ...}, Lightning, or flat state_dict checkpoints."""
    for key in ("state_dict", "model_state_dict", "model"):
        if isinstance(ckpt, dict) and key in ckpt and isinstance(ckpt[key], dict):
            ckpt = ckpt[key]
            break
    return {k.removeprefix("module."): v for k, v in ckpt.items()}


def load_mask2former_weights(weights: str, model_id: str) -> Mask2FormerForUniversalSegmentation:
    """Build Mask2Former from a custom checkpoint.

    `model_id` is only used as a fallback hint if the architecture cannot be inferred.
    """
    state = _extract_state_dict(torch.load(weights, map_location="cpu", weights_only=True))

    base_id = model_id
    embed = state.get(_EMBED_DIM_KEY)
    if embed is not None:
        base_id = _SWIN_BY_EMBED_DIM.get(int(embed.shape[0]), base_id)

    config = Mask2FormerConfig.from_pretrained(base_id)
    if "class_predictor.weight" in state:
        # HF appends a "no-object" class at the end.
        config.num_labels = int(state["class_predictor.weight"].shape[0]) - 1

    model = Mask2FormerForUniversalSegmentation(config)
    missing, unexpected = model.load_state_dict(state, strict=False)
    # Criterion buffers (`empty_weight`) are training-only and do not affect inference.
    blocking = [k for k in unexpected if not k.startswith("criterion.")]
    if missing or blocking:
        raise RuntimeError(
            f"Checkpoint {Path(weights).name} does not match {base_id}: "
            f"missing {missing[:5]} and unexpected {blocking[:5]}"
        )
    log.info("Loaded Mask2Former from %s (architecture %s, num_labels=%d)", weights, base_id, config.num_labels)
    return model


class Mask2FormerSegmenter:
    def __init__(self, model_id: str, device: str, threshold: float, weights: str | None = None):
        self.device, self.threshold = device, threshold
        self.processor = AutoImageProcessor.from_pretrained(model_id)

        if weights and Path(weights).exists():
            self.model = load_mask2former_weights(weights, model_id)
            self.source = str(Path(weights).name)
        else:
            if weights:
                log.warning("Checkpoint %s not found; using %s from Hugging Face", weights, model_id)
            self.model = Mask2FormerForUniversalSegmentation.from_pretrained(model_id)
            self.source = model_id
        self.model.to(device).eval()

    @torch.inference_mode()
    def segment(self, image: Image.Image) -> list[Segment]:
        inputs = self.processor(images=image, return_tensors="pt").to(self.device)
        outputs = self.model(**inputs)
        result = self.processor.post_process_instance_segmentation(
            outputs,
            threshold=self.threshold,
            target_sizes=[(image.height, image.width)],
            return_binary_maps=True,
        )[0]

        seg = result["segmentation"].cpu().numpy()
        infos = result["segments_info"]
        # With return_binary_maps=True: (N, H, W). Also handle ID map (H, W).
        if seg.ndim == 3:
            pairs = zip(seg > 0, infos, strict=True)
        else:
            pairs = ((seg == info["id"], info) for info in infos)
        # label_id is intentionally ignored: segmentation is class-agnostic.
        return [Segment(mask=m.astype(bool), score=float(info["score"])) for m, info in pairs if m.any()]
