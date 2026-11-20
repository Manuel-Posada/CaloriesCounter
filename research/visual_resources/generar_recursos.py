"""Generates the visual resources for the depth pipeline.

Usage, from the repository root:

    python research/visual_resources/generar_recursos.py

Runs in separate processes so inference models and matplotlib do not share
memory at the same time:

  1. `generar_datos.py`   -> models + depth + masks + volumes.
  2. `generar_figuras.py` -> figures from `datos_visuales.npz`.
  3. `generar_mapeo.py`   -> nutritional mapping figures (07-09).
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    for script in ("generar_datos.py", "generar_figuras.py", "generar_mapeo.py"):
        print(f"\n=== {script} ===")
        subprocess.run([sys.executable, str(HERE / script)], check=True, cwd=HERE.parent.parent.parent)
    print("\nResources generated in:", HERE)


if __name__ == "__main__":
    main()
