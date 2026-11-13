"""Segmentadores. Ambos exponen `segment(image) -> list[Segment]`.

- YoloSegmenter (Opción A): segmenta Y clasifica (class_idx ya viene resuelto).
- Mask2FormerSegmenter (Opción B): segmentación agnóstica a la clase (class_idx = None);
  la clasificación la hace después `InceptionV4Classifier`.

Mask2FormerSegmenter acepta un checkpoint propio (p. ej. `mask2former_agnostic.pt`).
En ese caso sólo se descarga de Hugging Face la *arquitectura* (`config.json`), que se
elige automáticamente a partir del tamaño del encoder Swin del checkpoint.
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

# embed_dim del patch embedding -> repo de HF con la misma arquitectura.
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
        # Se pasa el PIL (RGB) directamente; con un ndarray ultralytics asume BGR.
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
    """Acepta checkpoints {state_dict: ...}, de Lightning o un state_dict plano."""
    for key in ("state_dict", "model_state_dict", "model"):
        if isinstance(ckpt, dict) and key in ckpt and isinstance(ckpt[key], dict):
            ckpt = ckpt[key]
            break
    return {k.removeprefix("module."): v for k, v in ckpt.items()}


def load_mask2former_weights(weights: str, model_id: str) -> Mask2FormerForUniversalSegmentation:
    """Construye Mask2Former a partir de un checkpoint propio.

    `model_id` sólo se usa como pista si no se puede deducir la arquitectura del checkpoint.
    """
    state = _extract_state_dict(torch.load(weights, map_location="cpu", weights_only=True))

    base_id = model_id
    embed = state.get(_EMBED_DIM_KEY)
    if embed is not None:
        base_id = _SWIN_BY_EMBED_DIM.get(int(embed.shape[0]), base_id)

    config = Mask2FormerConfig.from_pretrained(base_id)
    if "class_predictor.weight" in state:
        # HF añade una clase "no-object" al final.
        config.num_labels = int(state["class_predictor.weight"].shape[0]) - 1

    model = Mask2FormerForUniversalSegmentation(config)
    missing, unexpected = model.load_state_dict(state, strict=False)
    # Los buffers del criterion (`empty_weight`) son de entrenamiento y no afectan a la inferencia.
    blocking = [k for k in unexpected if not k.startswith("criterion.")]
    if missing or blocking:
        raise RuntimeError(
            f"El checkpoint {Path(weights).name} no encaja con {base_id}: "
            f"faltan {missing[:5]} y sobran {blocking[:5]}"
        )
    log.info("Mask2Former cargado desde %s (arquitectura %s, num_labels=%d)", weights, base_id, config.num_labels)
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
                log.warning("No existe el checkpoint %s; se usa %s de Hugging Face", weights, model_id)
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
        # Con return_binary_maps=True: (N, H, W). Se contempla también el mapa de ids (H, W).
        if seg.ndim == 3:
            pairs = zip(seg > 0, infos, strict=True)
        else:
            pairs = ((seg == info["id"], info) for info in infos)
        # La etiqueta (label_id) se ignora a propósito: la segmentación es agnóstica.
        return [Segment(mask=m.astype(bool), score=float(info["score"])) for m, info in pairs if m.any()]
