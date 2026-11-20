"""Merge the nutrients table with the densities table into a single file per class."""
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
assert len(C) == len(W), "merge changed the number of rows"
assert C["densidad_g_cm3"].notna().all(), "some classes are missing density"

C.to_csv(OUT / "nutrition_wide_densidad.csv", index=False, encoding="utf-8-sig")
print("rows:", len(C), "| columns:", len(C.columns))
print("missing density:", int(C["densidad_g_cm3"].isna().sum()))
print(C[["idx", "clase", "kcal_100g", "densidad_g_cm3", "cm3_por_100g", "densidad_estimada"]].head(8).to_string(index=False))
