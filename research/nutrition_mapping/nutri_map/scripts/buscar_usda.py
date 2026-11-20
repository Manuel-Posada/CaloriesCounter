import os, sys, json, requests
from pathlib import Path

env = next(p / ".env" for p in Path(__file__).resolve().parents if (p / ".env").exists())
for ln in env.read_text(encoding="utf-8").splitlines():
    if "=" in ln and not ln.lstrip().startswith("#"):
        k, v = ln.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
key = os.environ["USDA_API_KEY"]

queries = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for q in queries:
    body = {"query": q, "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)"], "pageSize": 8}
    r = requests.post("https://api.nal.usda.gov/fdc/v1/foods/search", params={"api_key": key}, json=body, timeout=60)
    print(f"## {q}  [remaining {r.headers.get('X-RateLimit-Remaining')}]")
    for f in r.json().get("foods", []):
        print(f"   {f['fdcId']} | {f['description']} | {f['dataType']}")
