"""Generate the batch of 20 classes for manual user verification.

Criteria: 10 low-confidence rows (worst-case mappings) + 10 recipes
spread across the index (new part of the pipeline).
"""
import json
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1]
M = {int(m["idx"]): m for m in json.loads((OUT / "nutrition_map.json").read_text(encoding="utf-8"))}
DEC = pd.read_csv(OUT / "decisiones_resumen.csv", dtype=str).fillna("")
W = pd.read_csv(OUT / "nutrition_wide_densidad.csv")
D = pd.read_csv(OUT / "densidad_alimentos.csv")

recetas = DEC[DEC["decision"] == "receta"]["idx"].astype(int).tolist()
# 10 low-confidence classes that are NOT recipes (pure USDA mapping)
baja = [i for i in DEC[DEC["confianza"].eq("baja")]["idx"].astype(int) if i not in recetas]

sel_baja = baja[::2][:10]
if len(sel_baja) < 10:
    sel_baja += [i for i in baja if i not in sel_baja][: 10 - len(sel_baja)]
# 10 recipes, spread across the list
paso = max(1, len(recetas) // 10)
sel_rec = recetas[::paso][:10]
sel = sorted(set(sel_baja) | set(sel_rec))

rows = []
for i in sel:
    m, w = M[i], W[W["idx"] == i].iloc[0]
    d = D[D["idx"] == i].iloc[0]
    if m.get("fdc_data_type") == "receta":
        base = "receta: " + " + ".join(f"{x['nombre']} {x['g']:.0f} g" for x in m["ingredientes"])
    else:
        base = f"{m.get('fdc_description', '')} ({m.get('fdc_id')})"
    rows.append({
        "idx": i,
        "clase": m["clase"],
        "confianza": DEC.loc[DEC["idx"].astype(int) == i, "confianza"].iloc[0],
        "base_usada": base,
        "kcal_100g": w["kcal_100g"],
        "proteina_g": round(w.get("protein_g", float("nan")), 1) if "protein_g" in w else "",
        "grasa_g": round(w.get("fat_g", float("nan")), 1) if "fat_g" in w else "",
        "carbohidratos_g": round(w.get("carbohydrate_g", float("nan")), 1) if "carbohydrate_g" in w else "",
        "densidad_g_cm3": d["densidad"],
        "densidad_estimada": d["estimada"],
        "tu_veredicto_OK_o_ERROR": "",
        "comentario": "",
    })

V = pd.DataFrame(rows)
target = OUT / "verificacion_20.csv"
if target.exists():
    prev = pd.read_csv(target, dtype=str).fillna("")
    if "tu_veredicto_OK_o_ERROR" in prev and prev["tu_veredicto_OK_o_ERROR"].str.strip().ne("").any():
        print(f"{target.name} already has user verdicts: not overwriting. Delete the file if you want to regenerate it.")
        raise SystemExit(0)
V.to_csv(target, index=False, encoding="utf-8-sig")
print(len(V), "rows |", int((V["densidad_estimada"] == "SÍ").sum()), "with estimated density")
print(V[["idx", "clase", "confianza", "kcal_100g"]].to_string(index=False, max_colwidth=40))
