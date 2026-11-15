"""Nutrition catalog for the 323 food classes, enabling edits without calling the model.

`data/nutrition_catalog.csv` is generated from `ml/data/nutrition_wide_densidad.csv` (only
the columns needed to recalculate), so Django can recompute kcal and macros for a food
item without depending on the inference service.
"""
import csv
import unicodedata
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).parent / "data" / "nutrition_catalog.csv"
MACRO_FIELDS = ("proteinas_g", "carbohidratos_g", "grasas_g")
# Extended breakdown shown in the detail sheet (columns from the generated CSV).
DETAIL_FIELDS = (
    "agua_g", "fibra_g", "azucares_g", "sodio_mg",
    "grasas_saturadas_g", "grasas_mono_g", "grasas_poli_g", "grasas_trans_g", "colesterol_mg",
    "calcio_mg", "hierro_mg", "magnesio_mg", "fosforo_mg", "potasio_mg", "zinc_mg",
    "cobre_mg", "manganeso_mg", "selenio_ug",
    "vitamina_c_mg", "tiamina_mg", "riboflavina_mg", "niacina_mg", "vitamina_b6_mg",
    "folato_ug", "colina_mg", "vitamina_b12_ug", "vitamina_a_ug", "vitamina_d_ug",
    "vitamina_e_mg", "vitamina_k_ug",
)

# Common Colombian names that differ from the neutral Spanish FDA table.
SYNONYMS = {
    "papa": "patata",
    "papas": "patata",
    "platano": "platano",
    "palta": "aguacate",
    "frijol": "alubias",
    "frijoles": "alubias",
    "yuca": "mandioca",
    "mazorca": "maiz",
    "choclo": "maiz",
    "arepa": "tortilla de maiz",
    "queso campesino": "queso fresco",
}


def _norm(text: str) -> str:
    """Lowercase and strip accents so 'platano' matches 'plátano'."""
    text = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in text if not unicodedata.combining(c))



@lru_cache(maxsize=1)
def _catalog() -> dict[int, dict]:
    out: dict[int, dict] = {}
    with CATALOG_PATH.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                idx = int(row["idx"])
            except (TypeError, ValueError):
                continue
            out[idx] = {
                "idx": idx,
                "nombre": row["clase"],
                "nombre_es": row["nombre_es"],
                "por_100g": {
                    "calorias_kcal": float(row["kcal_100g"] or 0),
                    **{k: float(row[k] or 0) for k in MACRO_FIELDS},
                },
                "densidad_g_cm3": float(row["densidad_g_cm3"] or 1.0),
                "detalles": {
                    code: round(float(row[code]), 3)
                    for code in DETAIL_FIELDS
                    if row.get(code) not in (None, "")
                },
            }
    return out


def get(idx: int) -> dict | None:
    return _catalog().get(int(idx))


@lru_cache(maxsize=1)
def _by_name() -> dict[str, dict]:
    return {_norm(row["nombre"]): row for row in _catalog().values()}


def by_name(name: str) -> dict | None:
    """Catalog entry by English class name (as stored in contours)."""
    return _by_name().get(_norm(name))


def details(idx: int) -> dict:
    """Extended breakdown per 100 g (minerals, vitamins, fats); empty if unavailable."""
    entry = _catalog().get(int(idx))
    return dict(entry.get("detalles") or {}) if entry else {}


def search(query: str, limit: int = 20) -> list[dict]:
    """Search by Spanish or English name, accent-insensitive and with local synonyms."""
    q = _norm(query.strip())
    rows = list(_catalog().values())
    if not q:
        return sorted(rows, key=lambda r: r["nombre_es"])[:limit]

    terms = {q}
    if q in SYNONYMS:
        terms.add(SYNONYMS[q])

    def matches(r: dict) -> bool:
        names = {_norm(r["nombre_es"]), _norm(r["nombre"])}
        return any(t in name for t in terms for name in names)

    def score(r: dict) -> tuple:
        es, en = _norm(r["nombre_es"]), _norm(r["nombre"])
        starts = any(name.startswith(t) for t in terms for name in (es, en))
        return (0 if starts else 1, r["nombre_es"])

    found = [r for r in rows if matches(r)]
    return sorted(found, key=score)[:limit]


def totals_for(weight_g: float, por_100g: dict) -> dict:
    """Portion kcal and macros computed from per-100 g values."""
    factor = weight_g / 100.0
    return {
        "calorias_kcal": round(por_100g["calorias_kcal"] * factor, 2),
        **{k: round(por_100g[k] * factor, 2) for k in MACRO_FIELDS},
    }
