import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "nutri_map"
L = pd.read_csv(OUT / "nutrition_long.csv", dtype={"number": str, "fdc_id": str})
L["number"] = L["number"].astype(str)
M = pd.read_csv(OUT / "mapping_draft.csv", dtype=str)  # only to get the full set of classes
DEC = pd.read_csv(OUT / "decisiones_resumen.csv", dtype=str).fillna("")
rows = []
clases = L.groupby("idx")["clase"].first().to_dict()
for idx in sorted({int(x) for x in DEC["idx"]}):
    g = L[L["idx"] == idx]
    def val(num):
        s = g[g["number"] == num]
        return float(s["amount"].iloc[0]) if len(s) else None
    kcal = val("208") or val("957") or val("958")
    p, f, c, fib = val("203"), val("204"), val("205"), val("291")
    fid = g["fdc_id"].iloc[0] if len(g) else ""
    dec = DEC[DEC["idx"] == str(idx)]["decision"].iloc[0]
    conf = DEC[DEC["idx"] == str(idx)]["confianza"].iloc[0]
    status = ""
    dif = None
    if None in (kcal, p, f, c):
        status = "sin macro/kcal"
    else:
        est = 4 * p + 4 * (c - (fib or 0)) + 2 * (fib or 0) + 9 * f
        dif = 100 * (kcal - est) / kcal if kcal else None
        if dif is not None and abs(kcal - est) > 15 and abs(dif) > 15:
            status = "incoherente kcal vs macros"
    rows.append(dict(idx=idx, clase=clases.get(idx, ""), decision=dec, fdc_id=fid, confianza=conf,
                     kcal=kcal, prot=p, grasa=f, carb=c, fibra=fib, dif_pct=None if dif is None else round(dif, 1), problema=status))
V = pd.DataFrame(rows)
V.to_csv(OUT / "validacion_coherencia.csv", index=False, encoding="utf-8-sig")
print("total:", len(V))
print("issue:", V["problema"].value_counts().to_dict())
print(V[V["problema"] != ""][["idx", "clase", "decision", "fdc_id", "kcal", "prot", "grasa", "carb", "fibra", "dif_pct", "problema"]].to_string(index=False))
