"""Depth Anything V2 (variante métrica): devuelve profundidad en metros."""
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation


class DepthEstimator:
    def __init__(self, model_id: str, device: str):
        self.device = device
        self.dtype = torch.float16 if device == "cuda" else torch.float32
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.model = (
            AutoModelForDepthEstimation.from_pretrained(model_id, torch_dtype=self.dtype).to(device).eval()
        )

    @torch.inference_mode()
    def predict(self, image: Image.Image) -> np.ndarray:
        """HxW float32 en metros, al tamaño de `image`."""
        inputs = self.processor(images=image, return_tensors="pt")
        pixel_values = inputs["pixel_values"].to(device=self.device, dtype=self.dtype)
        pred = self.model(pixel_values=pixel_values).predicted_depth  # (1, h, w)
        pred = F.interpolate(
            pred.unsqueeze(1).float(),
            size=(image.height, image.width),
            mode="bicubic",
            align_corners=False,
        )[0, 0]
        return pred.clamp(min=0.05).cpu().numpy().astype(np.float32)

