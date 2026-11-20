import json, os, sys, time
from pathlib import Path

NB = Path(__file__).resolve().parents[2] / "01_mapeo_nutricional.ipynb"
os.chdir(NB.parent)
nb = json.loads(NB.read_text(encoding="utf-8"))
limit = os.environ.get("NUTRI_LIMIT")
g = {"__name__": "__main__"}
t0 = time.time()
for c in nb["cells"]:
    if c["cell_type"] != "code":
        continue
    src = "".join(c["source"])
    exec(compile(src, f"cell-{c['id']}", "exec"), g)
    if c["id"] == "e2886512" and limit:
        g["CFG"]["limit"] = int(limit)
        print(f"[runner] limit = {limit}")
print(f"[runner] finished in {time.time() - t0:.0f} s")
