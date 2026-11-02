"""Catálogo nutricional de las 323 clases, para editar un análisis sin pasar por el modelo.

`data/nutrition_catalog.csv` se genera desde `ml/data/nutrition_wide_densidad.csv` (solo las
columnas que hacen falta para recalcular): así Django puede recomputar kcal y macros de un
alimento sin depender del servicio de inferencia.
"""
import csv
import unicodedata
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).parent / "data" / "nutrition_catalog.csv"
MACRO_FIELDS = ("proteinas_g", "carbohidratos_g", "grasas_g")
# Detalle extendido que se muestra en la ficha (claves del CSV generado).
DETAIL_FIELDS = (
    "agua_g", "fibra_g", "azucares_g", "sodio_mg",
    "grasas_saturadas_g", "grasas_mono_g", "grasas_poli_g", "grasas_trans_g", "colesterol_mg",
    "calcio_mg", "hierro_mg", "magnesio_mg", "fosforo_mg", "potasio_mg", "zinc_mg",
    "cobre_mg", "manganeso_mg", "selenio_ug",
    "vitamina_c_mg", "tiamina_mg", "riboflavina_mg", "niacina_mg", "vitamina_b6_mg",
    "folato_ug", "colina_mg", "vitamina_b12_ug", "vitamina_a_ug", "vitamina_d_ug",
    "vitamina_e_mg", "vitamina_k_ug",
)

# Nombres de uso corriente en Colombia que no coinciden con la tabla (FDA, en español neutro).
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
    """Minúsculas y sin tildes, para que 'platano' encuentre 'plátano'."""
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


def details(idx: int) -> dict:
    """Detalle extendido por 100 g (minerales, vitaminas, grasas), vacío si no hay datos."""
    entry = _catalog().get(int(idx))
    return dict(entry.get("detalles") or {}) if entry else {}


def search(query: str, limit: int = 20) -> list[dict]:
    """Búsqueda por nombre en español o inglés, sin tildes y con sinónimos locales."""
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
    """kcal y macros de una porción, a partir de los valores por 100 g."""
    factor = weight_g / 100.0
    return {
        "calorias_kcal": round(por_100g["calorias_kcal"] * factor, 2),
        **{k: round(por_100g[k] * factor, 2) for k in MACRO_FIELDS},
    }
