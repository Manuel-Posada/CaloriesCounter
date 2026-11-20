"""Une la tabla de nutrientes con la de densidades en un solo archivo por clase."""
from pathlib import Path
import pandas as pd

OUT = Path(__file__).resolve().parents[1]
W = pd.read_csv(OUT / "nutrition_wide.csv")
D = pd.read_csv(OUT / "densidad_alimentos.csv")[
    ["idx", "densidad", "cm3_por_100g", "tipo", "fuente", "estado", "estimada", "motivo"]
].rename(columns={
    "densidad": "densidad_g_cm3",
    "cm3_por_100g": "cm3_por_100g",
    "tipo": "densidad_tipo",
    "fuente": "densidad_fuente",
    "estado": "densidad_estado",
    "estimada": "densidad_estimada",
    "motivo": "densidad_motivo",
})

C = W.merge(D, on="idx", how="left", validate="one_to_one")
assert len(C) == len(W), "la unión cambió el número de filas"
assert C["densidad_g_cm3"].notna().all(), "hay clases sin densidad"

C.to_csv(OUT / "nutrition_wide_densidad.csv", index=False, encoding="utf-8-sig")
print("filas:", len(C), "| columnas:", len(C.columns))
print("sin densidad:", int(C["densidad_g_cm3"].isna().sum()))
print(C[["idx", "clase", "kcal_100g", "densidad_g_cm3", "cm3_por_100g", "densidad_estimada"]].head(8).to_string(index=False))
