import io

from PIL import Image, ImageOps

from .config import MAX_IMAGE_SIDE

_EXIF_IFD = 0x8769
_TAG_FOCAL_35MM = 0xA405


def load_image(raw: bytes) -> tuple[Image.Image, float | None]:
    """Decodifica, corrige orientación, convierte a RGB y limita el lado mayor.

    Devuelve (imagen, focal equivalente 35 mm del EXIF o None).
    """
    img = Image.open(io.BytesIO(raw))
    f35 = None
    try:
        v = img.getexif().get_ifd(_EXIF_IFD).get(_TAG_FOCAL_35MM)
        f35 = float(v) if v else None
    except Exception:
        pass
    img = ImageOps.exif_transpose(img).convert("RGB")
    scale = MAX_IMAGE_SIDE / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    return img, f35

