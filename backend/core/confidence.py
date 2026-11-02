"""Nivel de confianza de un análisis, explicable y en un solo sitio.

Combina lo que sí sabemos con certeza sobre la medición (de dónde salió la escala, si la foto
era cenital, si el volumen hubo que recortarlo) con la confianza del clasificador. Se recalcula
al corregir el plato: los alimentos que el usuario ya ha revisado no penalizan.
"""
from __future__ import annotations

ALTA = 75
MEDIA = 45
# Por debajo de esta confianza del clasificador (softmax sobre 323 clases) el nombre es dudoso.
CLASES_DUDOSAS = 0.15
CLASES_MUY_DUDOSAS = 0.10


def evaluate(log) -> dict:
    score = 100
    motivos: list[str] = []

    if log.escala_origen == "prior":
        score -= 35
        motivos.append("escala_supuesta")
    elif log.escala_origen == "raw":
        # Sin plato no hay referencia de tamaño: la distancia del modelo no está verificada.
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

    # Solo cuentan los alimentos que el usuario no ha revisado: si cambió la clase, el nombre
    # ya no lo pone el clasificador y no tiene sentido penalizarlo.
    dudosos = [
        float(item.get("confianza") or 0)
        for item in log.items or []
        if not item.get("clase_editada")
    ]
    if dudosos:
        media = sum(dudosos) / len(dudosos)
        if media < CLASES_MUY_DUDOSAS:
            score -= 30
            motivos.append("clasificacion_muy_baja")
        elif media < CLASES_DUDOSAS:
            score -= 15
            motivos.append("clasificacion_baja")

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
