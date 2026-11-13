"""Genera los recursos visuales del mapeo nutricional.

Lee `ml/data/nutrition_wide_densidad.csv` (323 clases) y dibuja:
  07_mapeo_flujo.png      -> cómo se construyó el mapeo
  08_mapeo_cobertura.png  -> cobertura, fuentes y calidad
  09_mapeo_ejemplo.png    -> tres clases reales y el paso volumen -> gramos

No necesita modelos ni GPU.
"""
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Circle, FancyBboxPatch

HERE = Path(__file__).resolve().parent
CSV = HERE.parents[2] / "ml" / "data" / "nutrition_wide_densidad.csv"

COL = dict(ink="#0f172a", muted="#64748b", grid="#cbd5e1", blue="#2563eb",
           cyan="#0891b2", green="#16a34a", amber="#d97706", red="#dc2626",
           purple="#7c3aed", teal="#0f766e")

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white",
    "font.family": "DejaVu Sans", "font.size": 10,
    "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.labelsize": 10, "savefig.facecolor": "white",
})


def _save(fig, name, tight=True):
    path = HERE / name
    fig.savefig(path, dpi=160, bbox_inches="tight" if tight else None)
    plt.close(fig)
    print("  ·", path.name)


def _box(ax, x, y, w, h, color, alpha=0.10, lw=1.2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.12",
                                linewidth=lw, edgecolor=color, facecolor=color + f"{int(alpha*100):02x}"))


def _step(ax, i, y, title, body, color):
    h = 0.88
    _box(ax, 0.25, y - h, 9.35, h, color)
    ax.add_patch(Circle((0.72, y - h / 2), 0.24, color=color, zorder=3))
    ax.text(0.72, y - h / 2, str(i), color="white", ha="center", va="center", fontsize=10, weight="bold", zorder=4)
    ax.text(1.12, y - 0.24, title, fontsize=11, weight="bold", color=COL["ink"], va="top")
    ax.text(1.12, y - 0.55, body, fontsize=8.8, color=COL["muted"], va="top")


def _stat_card(ax, x, y, w, h, number, label, color):
    _box(ax, x, y, w, h, color, alpha=0.08)
    ax.text(x + 0.04, y + h * 0.56, number, fontsize=22, weight="bold", color=color, va="center")
    ax.text(x + 0.04, y + h * 0.20, label, fontsize=8.2, color=COL["muted"], va="center")


def fig_flujo(df):
    n = len(df)
    match = df["match"].value_counts()
    fdc = df["fdc_data_type"].value_counts()
    dens = df["densidad_estado"].value_counts()

    fig = plt.figure(figsize=(14.5, 9.2))
    ax = fig.add_axes([0.02, 0.03, 0.58, 0.90])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")

    steps = [
        ("323 clases", "Nombres originales de `classes.json` (Food Recognition 2022).", COL["blue"]),
        ("Candidatos USDA", "Búsqueda en FoodData Central + propuesta de DeepSeek V4 Pro; todo cacheado.", COL["cyan"]),
        ("Revisión manual", f"323/323 filas revisadas en 7 lotes; 88 cambios respecto al borrador.", COL["green"]),
        ("Decisión", "`ok` / `cambiar` / `receta` + id USDA, confianza y motivo por clase.", COL["amber"]),
        ("Nutrientes / 100 g", f"{df.shape[1]} columnas: energía, macros y micronutrientes de USDA.", COL["red"]),
        ("Densidad g/cm³", "7 fuentes; 323/323 con valor; 43 geométricas marcadas como cálculo.", COL["purple"]),
        ("Validación y tabla final", "Coherencia energética, recetas y 20 filas a mano → CSV para la app.", COL["teal"]),
    ]
    top, h, gap = 9.45, 0.88, 0.32
    for i, (title, body, color) in enumerate(steps, 1):
        y = top - (i - 1) * (h + gap)
        _step(ax, i, y, title, body, color)
        if i < len(steps):
            # La punta se dibuja en `xy`, así que debe ser el punto inferior:
            # el flujo va del recuadro de arriba al de abajo.
            ax.annotate("", xy=(5.0, y - h - 0.29), xytext=(5.0, y - h - 0.03),
                        arrowprops=dict(arrowstyle="-|>", color="#94a3b8", lw=1.3))

    fig.suptitle("Cómo se construyó el mapeo nutricional de las 323 clases", fontsize=17, weight="bold", y=0.985)
    fig.text(0.02, 0.005, "USDA FoodData Central · FAO/INFOODS · Engineering Properties of Foods · USDA AMS · DeepSeek V4 Pro",
             fontsize=8.5, color=COL["muted"])

    # Panel derecho: cobertura
    axr = fig.add_axes([0.60, 0.06, 0.34, 0.86]); axr.set_xlim(0, 1.04); axr.set_ylim(0, 1); axr.axis("off")
    axr.text(0, 0.98, "COBERTURA", fontsize=10, color=COL["muted"], weight="bold")
    _stat_card(axr, 0.00, 0.80, 0.44, 0.13, f"{n}", "clases en el dataset", COL["blue"])
    _stat_card(axr, 0.50, 0.80, 0.44, 0.13, f"{int(df['reviewed'].sum())}", "filas revisadas", COL["green"])
    _stat_card(axr, 0.00, 0.63, 0.44, 0.13, f"{df['densidad_g_cm3'].notna().sum()}", "con densidad", COL["purple"])
    _stat_card(axr, 0.50, 0.63, 0.44, 0.13, "316/323", "coherencia energética", COL["teal"])

    axr.text(0, 0.57, "TIPO DE MATCH", fontsize=9, color=COL["muted"], weight="bold")
    axr.text(0, 0.52, textwrap.fill("  ·  ".join(f"{k} {v}" for k, v in match.items()), 58),
             fontsize=8.2, color=COL["ink"], va="top", linespacing=1.5)
    axr.text(0, 0.37, "CONTROL DE CALIDAD", fontsize=9, color=COL["muted"], weight="bold")
    axr.text(0, 0.32, "323/323 revisadas · 88 cambios vs borrador\n"
             "18/20 verificadas a mano · 48 pendientes de revisión\n"
             "43 densidades geométricas (±15–20 %)",
             fontsize=8.2, color=COL["ink"], va="top", linespacing=1.5)
    axr.text(0, 0.17, "SALIDA", fontsize=9, color=COL["muted"], weight="bold")
    axr.text(0, 0.12, "nutrition_wide_densidad.csv\n323 filas × 219 columnas",
             fontsize=8.2, color=COL["ink"], va="top", linespacing=1.5)
    axr.text(0, 0.02, "La app usa: gramos = volumen × densidad\ny kcal = gramos/100 × kcal_100g.",
             fontsize=8.2, color=COL["teal"], va="bottom", weight="bold")
    _save(fig, "07_mapeo_flujo.png", tight=False)


def fig_cobertura(df):
    match = df["match"].value_counts()
    dens = df["densidad_estado"].value_counts()

    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    ax = axes[0, 0]; ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_title("1 · Cobertura", loc="left")
    cards = [
        (0.00, 0.52, f"{len(df)}", "clases en el dataset", COL["blue"]),
        (0.51, 0.52, "323/323", "filas revisadas", COL["green"]),
        (0.00, 0.02, "323/323", "con densidad", COL["purple"]),
        (0.51, 0.02, "316/323", "coherencia energética", COL["teal"]),
    ]
    for x, y, num, lab, color in cards:
        _stat_card(ax, x, y, 0.47, 0.42, num, lab, color)

    ax = axes[0, 1]
    order = ["exact", "manual", "close", "receta", "proxy", "composite"]
    vals = [int(match.get(k, 0)) for k in order]
    colors = [COL["green"], COL["blue"], COL["cyan"], COL["amber"], COL["red"], COL["purple"]]
    y = np.arange(len(order))
    ax.barh(y, vals, color=colors, alpha=0.9)
    ax.set_yticks(y); ax.set_yticklabels(order); ax.invert_yaxis()
    ax.set_xlabel("clases"); ax.set_title("2 · Cómo se emparejó cada clase", loc="left")
    ax.grid(axis="x", alpha=0.25)
    for i, v in enumerate(vals):
        ax.text(v + 3, i, str(v), va="center", fontsize=9, color=COL["ink"])
    ax.set_xlim(0, max(vals) * 1.18)

    ax = axes[1, 0]
    order = ["medida USDA", "tabla publicada", "calculada (geometría)", "calculada (receta)", "referencia de categoría"]
    vals = [int(dens.get(k, 0)) for k in order]
    colors = [COL["green"], COL["cyan"], COL["amber"], COL["purple"], COL["blue"]]
    y = np.arange(len(order))
    ax.barh(y, vals, color=colors, alpha=0.9)
    ax.set_yticks(y); ax.set_yticklabels(order); ax.invert_yaxis()
    ax.set_xlabel("clases"); ax.set_title("3 · De dónde sale la densidad", loc="left")
    ax.grid(axis="x", alpha=0.25)
    for i, v in enumerate(vals):
        ax.text(v + 4, i, str(v), va="center", fontsize=9, color=COL["ink"])
    ax.set_xlim(0, max(vals) * 1.15)

    ax = axes[1, 1]; ax.axis("off"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_title("4 · Calidad y límites", loc="left")
    ax.text(0, 0.94, "Confianza de la densidad", fontsize=9, color=COL["muted"], weight="bold")
    total = 323.0
    ax.barh([0.80], [173 / total], color=COL["green"], height=0.10)
    ax.barh([0.80], [92 / total], left=[173 / total], color=COL["amber"], height=0.10)
    ax.barh([0.80], [58 / total], left=[(173 + 92) / total], color=COL["red"], height=0.10)
    ax.text(0, 0.68, "173 alta   ·   92 media   ·   58 baja", fontsize=8.5, color=COL["ink"])
    lines = [
        ("43 densidades geométricas", "calculadas, no medidas; ±15–20 %", COL["amber"]),
        ("15 recetas", "nutrientes por ingredientes; porción estimada", COL["purple"]),
        ("48 filas", "pendientes de revisión técnica", COL["red"]),
        ("7 excepciones energéticas", "alcohol/agua, explicadas", COL["cyan"]),
        ("18/20", "verificación manual; 2 errores corregidos", COL["green"]),
    ]
    y = 0.52
    for title, body, color in lines:
        ax.add_patch(Circle((0.02, y + 0.02), 0.012, color=color, transform=ax.transAxes))
        ax.text(0.05, y + 0.05, title, fontsize=8.8, weight="bold", color=COL["ink"])
        ax.text(0.05, y, body, fontsize=8, color=COL["muted"])
        y -= 0.095

    fig.suptitle("Cobertura y calidad del mapeo nutricional", fontsize=16, weight="bold")
    fig.text(0.5, 0.005, "27 oct: mapeo inicial  →  28 oct: revisión 323/323 y 88 cambios  →  "
             "densidades v2/v3/v4  →  verificación 18/20", ha="center", fontsize=8.5, color=COL["muted"])
    fig.tight_layout(rect=[0, 0.03, 1, 0.95])
    _save(fig, "08_mapeo_cobertura.png")


def fig_ejemplo(df):
    examples = [
        dict(idx=42, color=COL["green"], badge="exact · USDA",
             volume=97.87, real=34.0),
        dict(idx=316, color=COL["amber"], badge="manual · geometría",
             volume=234.67, real=163.0),
        dict(idx=206, color=COL["cyan"], badge="exact · tabla",
             volume=85.06, real=105.0),
    ]
    fig = plt.figure(figsize=(15, 7.6))
    for i, ex in enumerate(examples):
        row = df[df.idx == ex["idx"]].iloc[0]
        ax = fig.add_axes([0.02 + i * 0.33, 0.08, 0.30, 0.84]); ax.axis("off")
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.add_patch(FancyBboxPatch((0.01, 0.01), 0.98, 0.98,
                                    boxstyle="round,pad=0,rounding_size=0.04",
                                    facecolor=ex["color"] + "0d", edgecolor="none"))
        ax.add_patch(FancyBboxPatch((0.04, 0.86), 0.92, 0.10, boxstyle="round,pad=0.01,rounding_size=0.02",
                                    facecolor=ex["color"], edgecolor=ex["color"]))
        ax.text(0.07, 0.915, f"{row['nombre_es'].title()}", color="white", fontsize=14, weight="bold", va="center")
        ax.text(0.07, 0.80, f"{row['clase']}  ·  idx {int(row['idx'])}", fontsize=9, color=COL["muted"])
        badge = ex["badge"] + (f" · {row['flags']}" if pd.notna(row.get("flags")) else "")
        ax.text(0.07, 0.765, badge, fontsize=8.5, color=ex["color"], weight="bold")

        desc = textwrap.fill(str(row["fdc_description"]), 46)
        ax.text(0.07, 0.71, desc, fontsize=8.5, color=COL["ink"], va="top", linespacing=1.35)
        ax.text(0.07, 0.60, f"USDA · {row['fdc_data_type']} · fdc_id {int(row['fdc_id']) if pd.notna(row['fdc_id']) else '—'}",
                fontsize=7.8, color=COL["muted"])

        y = 0.52
        for label, key, unit in [
            ("Energía", "kcal_100g", "kcal"),
            ("Proteína", "Protein (g)", "g"),
            ("Carbohidratos", "Carbohydrate, by difference (g)", "g"),
            ("Grasa", "Total lipid (fat) (g)", "g"),
        ]:
            ax.text(0.07, y, label, fontsize=8.5, color=COL["muted"])
            val = row[key]
            ax.text(0.93, y, f"{val:.2f} {unit}" if isinstance(val, (int, float)) and pd.notna(val) else "—",
                    fontsize=8.8, color=COL["ink"], ha="right", weight="bold")
            y -= 0.045

        ax.plot([0.07, 0.93], [0.33, 0.33], color=COL["grid"], lw=1)
        ax.text(0.07, 0.28, "Densidad", fontsize=8.5, color=COL["muted"])
        ax.text(0.93, 0.28, f"{row['densidad_g_cm3']:.3f} g/cm³", fontsize=10, color=ex["color"], ha="right", weight="bold")
        ax.text(0.07, 0.235, str(row["densidad_estado"]), fontsize=8, color=COL["muted"])
        ax.text(0.07, 0.195, textwrap.fill(str(row["densidad_fuente"]), 48), fontsize=7.2, color=COL["muted"], va="top")

        g = ex["volume"] * float(row["densidad_g_cm3"])
        kcal = g / 100.0 * float(row["kcal_100g"])
        ax.plot([0.07, 0.93], [0.13, 0.13], color=COL["grid"], lw=1)
        ax.text(0.07, 0.085, f"{ex['volume']:.1f} cm³ × {row['densidad_g_cm3']:.3f} = {g:.1f} g", fontsize=9.5,
                color=COL["ink"], weight="bold")
        ax.text(0.07, 0.040, f"→ {kcal:.0f} kcal  ·  real: {ex['real']:.0f} g", fontsize=8.5, color=COL["muted"])

    fig.suptitle("Cómo se usa el mapeo: tres clases, tres fuentes de densidad", fontsize=16, weight="bold")
    fig.text(0.5, 0.015, "gramos = volumen × densidad    ·    kcal = gramos / 100 × kcal_100g    ·    "
             "el volumen viene del mapa de profundidad", ha="center", fontsize=9, color=COL["muted"])
    _save(fig, "09_mapeo_ejemplo.png")


def main():
    df = pd.read_csv(CSV)
    print(f"  mapeo: {len(df)} clases")
    fig_flujo(df)
    fig_cobertura(df)
    fig_ejemplo(df)
    print("Figuras del mapeo listas en:", HERE)


if __name__ == "__main__":
    main()
