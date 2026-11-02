"""Detalle por alimento de un análisis: creación, correcciones del usuario y recálculo.

Los totales del `FoodLog` (volumen, kcal, macros, contornos) son siempre una proyección de
`items`; ninguna edición del usuario escribe los totales a mano.
"""
from __future__ import annotations

from . import nutrition

MIN_WEIGHT_G = 1.0
MAX_WEIGHT_G = 5000.0
# Tope de cordura: un plato de comida no pesa más que esto. Por encima, algo se midió mal.
MAX_PLATE_WEIGHT_G = 2500.0
MIN_PLATE_DIAMETER_CM = 15.0
MAX_PLATE_DIAMETER_CM = 40.0


def items_from_inference(alimentos: list[dict]) -> list[dict]:
    """Normaliza la respuesta de Modal a la lista editable que se guarda."""
    items = []
    for a in alimentos:
        nut = a.get("nutricion") or {}
        por_100g = nut.get("por_100g") or {}
        item = {
            "idx": a["idx"],
            "nombre": a["nombre"],
            "nombre_es": a.get("nombre_es") or a["nombre"],
            "confianza": a.get("confianza"),
            "volumen_cm3": round(float(a.get("volumen_cm3") or 0), 2),
            "densidad_g_cm3": a.get("densidad_g_cm3"),
            "densidad_asumida": bool(a.get("densidad_asumida")),
            "por_100g": {
                "calorias_kcal": float(por_100g.get("calorias_kcal") or 0),
                "proteinas_g": float(por_100g.get("proteinas_g") or 0),
                "carbohidratos_g": float(por_100g.get("carbohidratos_g") or 0),
                "grasas_g": float(por_100g.get("grasas_g") or 0),
            },
            "peso_g": round(float(a.get("peso_g") or 0), 2),
            "peso_manual": False,
            "editado": False,
            "poligono": a.get("poligono") or [],
            "centroide": a.get("centroide"),
        }
        item["nutricion"] = nutrition.totals_for(item["peso_g"], item["por_100g"])
        items.append(item)
    return items


def apply_edits(log, edits: list[dict]) -> None:
    """Aplica [{index, idx?, peso_g?}] sobre los items y recalcula los totales."""
    items = list(log.items or [])
    if not items:
        raise ValueError("Este análisis no tiene detalle editable.")

    for edit in edits:
        index = int(edit["index"])
        if not 0 <= index < len(items):
            raise ValueError(f"Índice de alimento fuera de rango: {index}")
        item = items[index]

        if "idx" in edit and edit["idx"] is not None:
            new_idx = int(edit["idx"])
            if new_idx == item["idx"]:
                continue
            entry = nutrition.get(new_idx)
            if entry is None:
                raise ValueError(f"Alimento desconocido: {new_idx}")
            item.update(
                idx=new_idx,
                nombre=entry["nombre"],
                nombre_es=entry["nombre_es"],
                densidad_g_cm3=entry["densidad_g_cm3"],
                densidad_asumida=False,
                por_100g=entry["por_100g"],
                editado=True,
            )
            # El volumen es lo que se midió; el peso sale de la densidad del alimento nuevo.
            item["peso_g"] = round(item["volumen_cm3"] * entry["densidad_g_cm3"], 2)
            item["peso_manual"] = False

        if "peso_g" in edit and edit["peso_g"] is not None:
            weight = float(edit["peso_g"])
            if not MIN_WEIGHT_G <= weight <= MAX_WEIGHT_G:
                raise ValueError(f"Peso fuera de rango ({MIN_WEIGHT_G}-{MAX_WEIGHT_G} g).")
            item["peso_g"] = round(weight, 2)
            item["peso_manual"] = True
            item["editado"] = True
            density = item.get("densidad_g_cm3") or 1.0
            item["volumen_cm3"] = round(weight / density, 2)

    log.items = items
    recalc(log)


def apply_plate_diameter(log, diameter_cm: float) -> None:
    """Reescala el volumen según el diámetro real del plato (volumen ∝ diámetro³)."""
    if not MIN_PLATE_DIAMETER_CM <= diameter_cm <= MAX_PLATE_DIAMETER_CM:
        raise ValueError(
            f"Diámetro fuera de rango ({MIN_PLATE_DIAMETER_CM}-{MAX_PLATE_DIAMETER_CM} cm)."
        )
    current = float(log.plate_diameter_cm or 26.0)
    if abs(diameter_cm - current) < 1e-6:
        return

    factor = (diameter_cm / current) ** 3
    items = []
    for item in log.items or []:
        item = dict(item)
        if not item.get("peso_manual"):
            item["volumen_cm3"] = round(float(item.get("volumen_cm3") or 0) * factor, 2)
            item["peso_g"] = round(item["volumen_cm3"] * (item.get("densidad_g_cm3") or 1.0), 2)
        items.append(item)

    log.items = items
    log.plate_diameter_cm = round(diameter_cm, 1)
    recalc(log)


def recalc(log) -> None:
    """Recomputa todos los totales del registro a partir de `items`."""
    items = log.items or []
    kcal = 0.0
    proteinas = carbohidratos = grasas = 0.0
    volumen = peso = 0.0

    for item in items:
        weight = float(item.get("peso_g") or 0)
        nut = nutrition.totals_for(weight, item.get("por_100g") or {})
        item["nutricion"] = nut
        kcal += nut["calorias_kcal"]
        proteinas += nut["proteinas_g"]
        carbohidratos += nut["carbohidratos_g"]
        grasas += nut["grasas_g"]
        volumen += float(item.get("volumen_cm3") or 0)
        peso += weight

    log.calorias_totales = round(kcal, 2)
    log.volumen_estimado = round(volumen, 2)
    log.macronutrientes = {
        "proteinas_g": round(proteinas, 2),
        "carbohidratos_g": round(carbohidratos, 2),
        "grasas_g": round(grasas, 2),
    }
    log.clases_detectadas = [int(i["idx"]) for i in items]
    log.contornos = [
        {
            "nombre": i["nombre"],
            "kcal": (i.get("nutricion") or {}).get("calorias_kcal", 0),
            "poligono": i.get("poligono") or [],
            "centroide": i.get("centroide"),
        }
        for i in items
        if i.get("poligono")
    ]


def alimentos_from_items(items: list[dict]) -> list[dict]:
    """Vista tipo Modal (lo que consume la pantalla de resultado) a partir de `items`."""
    out = []
    for i in items:
        nut = dict(i.get("nutricion") or {})
        # La tabla por 100 g se guarda aparte; la pantalla la muestra en la hoja de detalle.
        nut["por_100g"] = i.get("por_100g") or {}
        out.append(
            {
                "idx": i["idx"],
                "nombre": i["nombre"],
                "nombre_es": i["nombre_es"],
                "confianza": i.get("confianza"),
                "volumen_cm3": i.get("volumen_cm3"),
                "peso_g": i.get("peso_g"),
                "densidad_g_cm3": i.get("densidad_g_cm3"),
                "densidad_asumida": i.get("densidad_asumida", False),
                "peso_manual": i.get("peso_manual", False),
                "poligono": i.get("poligono") or [],
                "centroide": i.get("centroide"),
                "nutricion": nut,
            }
        )
    return out
