import pandas as pd
from pathlib import Path

OUT = Path(__file__).resolve().parents[1]
D = pd.read_csv(OUT / "decisiones_resumen.csv", dtype=str).fillna("")
V = pd.read_csv(OUT / "validacion_coherencia.csv", dtype=str).fillna("")
prob = dict(zip(V["idx"], V["problema"]))

motivos = []
for _, r in D.iterrows():
    m = []
    if r["confianza"] == "baja":
        m.append("confianza baja")
    if r["decision"] == "receta":
        m.append("receta: proporciones y datos de ingredientes")
    n = r["nota"].lower()
    if "proxy" in n or "aproxim" in n:
        m.append("proxy/aproximacion")
    if prob.get(r["idx"], "") and "incoherente" in prob.get(r["idx"], ""):
        m.append("kcal vs macros (" + prob[r["idx"]] + ")")
    if m:
        motivos.append(dict(idx=r["idx"], clase=r["clase"], decision=r["decision"], final_usda=r["final_usda"],
                            confianza=r["confianza"], motivo="; ".join(m), nota=r["nota"]))
R = pd.DataFrame(motivos)
R.to_csv(OUT / "revision_tecnica.csv", index=False, encoding="utf-8-sig")
print("rows for technical review:", len(R))
print(R["motivo"].str.split("; ").explode().value_counts().to_string())
for _, r in R.iterrows():
    print(f"{r['idx']}|{r['clase']}|{r['decision']}|{r['final_usda']}|{r['confianza']}|{r['motivo']}")
