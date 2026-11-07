"""Genera los recursos visuales del pipeline de profundidad.

Uso, desde la raíz del repositorio:

    python presentación/tests/Recursos_visuales/generar_recursos.py

Se ejecuta en dos procesos para no juntar los modelos de inferencia con
matplotlib en la misma memoria:

  1. `generar_datos.py`  -> modelos + profundidad + máscaras + volúmenes.
  2. `generar_figuras.py` -> figuras a partir de `datos_visuales.npz`.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    for script in ("generar_datos.py", "generar_figuras.py", "generar_mapeo.py"):
        print(f"\n=== {script} ===")
        subprocess.run([sys.executable, str(HERE / script)], check=True, cwd=HERE.parent.parent.parent)
    print("\nRecursos generados en:", HERE)


if __name__ == "__main__":
    main()
