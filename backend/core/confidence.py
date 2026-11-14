"""Explainable analysis confidence score, centralized in one place.

Combines known measurement signals (where scale came from, whether the photo was
top-down, whether volume had to be clamped) with classifier confidence. Recomputed
when editing the plate: food items already reviewed by the user are not penalized.
"""
from __future__ import annotations

ALTA = 75
MEDIA = 45
# Below this classifier confidence (softmax over 323 classes), the predicted label is uncertain.
CLASES_DUDOSAS = 0.15
CLASES_MUY_DUDOSAS = 0.10


def evaluate(log) -> dict:
    score = 100
    motivos: list[str] = []

    if log.escala_origen == "prior":
        score -= 35
        motivos.append("escala_supuesta")
    elif log.escala_origen == "raw":
        # Without a plate there is no size reference: model distance is unverified.
        score -= 30
        motivos.append("escala_sin_referencia")

    tilt = log.angulo_camara_deg
    if tilt is not None:
        if tilt > 15:
            score -= 20
            motivos.append("camara_inclinada")
        elif tilt > 8:
            score -= 10
            motivos.append("camara_algo_inclinada")

    # Only count items the user has not reviewed and whose confidence is known:
    # items reconstructed from legacy analyses lack confidence and should not penalize.
    dudosos = [
        float(item["confianza"])
        for item in log.items or []
        if not item.get("clase_editada") and item.get("confianza") is not None
    ]
    if dudosos:
        media = sum(dudosos) / len(dudosos)
        if media < CLASES_MUY_DUDOSAS:
            score -= 30
            motivos.append("clasificacion_muy_baja")
        elif media < CLASES_DUDOSAS:
            score -= 15
            motivos.append("clasificacion_baja")

    # Analysis reconstructed from a legacy record: classifier confidence was not saved.
    if any(item.get("confianza") is None for item in log.items or []):
        score -= 30
        motivos.append("clasificacion_desconocida")

    if any(item.get("densidad_asumida") for item in log.items or []):
        score -= 10
        motivos.append("densidad_asumida")

    if any(
        isinstance(aviso, dict) and aviso.get("code") == "volume_clamped"
        for aviso in getattr(log, "advertencias", None) or []
    ):
        score -= 25
        motivos.append("volumen_recortado")

    score = max(0, min(100, score))
    nivel = "alta" if score >= ALTA else "media" if score >= MEDIA else "baja"
    return {"score": score, "nivel": nivel, "motivos": motivos}
