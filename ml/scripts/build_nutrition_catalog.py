"""Genera backend/core/data/nutrition_catalog.csv desde el CSV del pipeline.

Solo las columnas que usa Django: recálculo de totales (kcal, macros, densidad) y el detalle
nutricional extendido que se muestra en la ficha de cada alimento.

    python ml/scripts/build_nutrition_catalog.py
"""
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "ml" / "data" / "nutrition_wide_densidad.csv"
DST = ROOT / "backend" / "core" / "data" / "nutrition_catalog.csv"

# código interno -> prefijo de la columna en el CSV de origen (el nombre exacto lleva µ y
# paréntesis; se busca por prefijo para no depender de la codificación).
DETAIL = {
    "agua_g": "Water (g)",
    "fibra_g": "Fiber, total dietary (g)",
    "azucares_g": "Total Sugars (g)",
    "sodio_mg": "Sodium, Na (mg)",
    "grasas_saturadas_g": "Fatty acids, total saturated (g)",
    "grasas_mono_g": "Fatty acids, total monounsaturated (g)",
    "grasas_poli_g": "Fatty acids, total polyunsaturated (g)",
    "grasas_trans_g": "Fatty acids, total trans (g)",
    "colesterol_mg": "Cholesterol (mg)",
    "calcio_mg": "Calcium, Ca (mg)",
    "hierro_mg": "Iron, Fe (mg)",
    "magnesio_mg": "Magnesium, Mg (mg)",
    "fosforo_mg": "Phosphorus, P (mg)",
    "potasio_mg": "Potassium, K (mg)",
    "zinc_mg": "Zinc, Zn (mg)",
    "cobre_mg": "Copper, Cu (mg)",
    "manganeso_mg": "Manganese, Mn (mg)",
    "selenio_ug": "Selenium, Se",
    "vitamina_c_mg": "Vitamin C, total ascorbic acid (mg)",
    "tiamina_mg": "Thiamin (mg)",
    "riboflavina_mg": "Riboflavin (mg)",
    "niacina_mg": "Niacin (mg)",
    "vitamina_b6_mg": "Vitamin B-6 (mg)",
    "folato_ug": "Folate, total",
    "colina_mg": "Choline, total (mg)",
    "vitamina_b12_ug": "Vitamin B-12 (µg)",
    "vitamina_a_ug": "Vitamin A, RAE",
    "vitamina_d_ug": "Vitamin D (D2 + D3) (µg)",
    "vitamina_e_mg": "Vitamin E (alpha-tocopherol) (mg)",
    "vitamina_k_ug": "Vitamin K (phylloquinone)",
}
BASE = ["idx", "clase", "nombre_es", "kcal_100g", "proteinas_g", "carbohidratos_g", "grasas_g",
        "densidad_g_cm3"]


def num(value: str) -> float | None:
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def column_for(header: str, prefix: str) -> str | None:
    for name in header:
        if name == prefix or name.startswith(prefix):
            return name
    return None


def main() -> None:
    with SRC.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames or []
        rows = list(reader)

    resolved = {}
    for code, prefix in DETAIL.items():
        col = column_for(header, prefix)
        if col is None:
            raise SystemExit(f"No se encontró la columna para {code} ({prefix})")
        resolved[code] = col

    DST.parent.mkdir(parents=True, exist_ok=True)
    with DST.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(BASE + list(DETAIL))
        for row in rows:
            values = [
                row["idx"], row["clase"], row["nombre_es"],
                num(row["kcal_100g"]), num(row["Protein (g)"]),
                num(row["Carbohydrate, by difference (g)"]), num(row["Total lipid (fat) (g)"]),
                num(row["densidad_g_cm3"]),
            ]
            values += ["" if (v := num(row[resolved[code]])) is None else v for code in DETAIL]
            writer.writerow(values)

    print(f"{len(rows)} clases -> {DST} ({DST.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
