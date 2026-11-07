"""Dibuja los recursos visuales a partir de `datos_visuales.npz`.

No carga modelos: así matplotlib dispone de toda la RAM. Lo llama
`generar_recursos.py` después de `generar_datos.py`.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Circle, FancyBboxPatch

HERE = Path(__file__).resolve().parent
COL = dict(ink="#0f172a", muted="#64748b", grid="#cbd5e1", blue="#2563eb",
           cyan="#0891b2", green="#16a34a", amber="#d97706", red="#dc2626")
SEG_COLORS = ["#2563eb", "#16a34a", "#d97706"]

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white",
    "font.family": "DejaVu Sans", "font.size": 10,
    "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.labelsize": 10, "savefig.facecolor": "white",
})


def _save(fig, name):
    path = HERE / name
    fig.savefig(path, dpi=160, bbox_inches="tight")
    plt.close(fig)
    print("  ·", path.name)


def _short(label, maxlen=22):
    s = label.split(" con ")[0].title()
    return s if len(s) <= maxlen else s[: maxlen - 1].rstrip() + "…"


def _contour(ax, mask, color, lw=1.8):
    ax.contour(mask.astype(float), levels=[0.5], colors=[color], linewidths=lw)


def _overlay(ax, image, pairs):
    ax.imshow(image)
    for p, color in zip(pairs, SEG_COLORS):
        mask = p["mask"]
        rgba = np.zeros((*mask.shape, 4), np.float32)
        rgba[mask] = matplotlib.colors.to_rgba(color, 0.38)
        ax.imshow(rgba)
        _contour(ax, mask, color)
        cx, cy = p["centroid"]
        ax.text(cx, cy, f"{_short(p['label'])}\n{p['weight']:.0f} g",
                color="white", fontsize=9, weight="bold", ha="center", va="center",
                bbox=dict(boxstyle="round,pad=0.35", facecolor=color, edgecolor="white", alpha=0.92))
    ax.axis("off")


def _plate_circle(ax, plate, color="white"):
    if plate is None:
        return
    cx, cy, r = plate
    t = np.linspace(0, 2 * np.pi, 400)
    ax.plot(cx + r * np.cos(t), cy + r * np.sin(t), color=color, lw=1.8, ls="--", alpha=0.9)


def main():
    D = np.load(HERE / "datos_visuales.npz", allow_pickle=True)
    result = json.loads((HERE / "resultado_pipeline_B.json").read_text(encoding="utf-8"))
    image = D["image"]
    depth_raw, depth_scaled = D["depth_raw"], D["depth_scaled"]
    hmap_all, food_union = D["hmap_all"], D["food_union"]
    scale, scale_source = float(D["scale"]), str(D["scale_source"])
    focal_px = float(D["focal_px"])
    plate = tuple(float(v) for v in D["plate"]) if D["plate"].size == 3 else None
    diameter = float(result["escala"]["plate_diameter_cm"])

    pairs = []
    for i in range(len(D["masks"])):
        pairs.append(dict(
            mask=D["masks"][i], hmap=D["hmaps"][i],
            centroid=(float(D["centroids"][i][0]), float(D["centroids"][i][1])),
            label=str(D["labels_es"][i]), weight=float(D["weights"][i]),
            volume=float(D["volumes"][i]), kcal=float(D["kcal"][i]),
            density=float(D["densities"][i]), confidence=float(D["confidences"][i]),
            altura_media=float(D["altura_media"][i]), altura_max=float(D["altura_max"][i]),
            area_frac=float(D["area_frac"][i]), plane=str(D["plane"][i]),
            correct_name=str(D["correct_names"][i]), correct_g=float(D["correct_g"][i]),
            correct_kcal=float(D["correct_kcal"][i]), correct_density=float(D["correct_density"][i]),
            real_g=float(D["real_g"][i]),
        ))
    H, W = image.shape[:2]

    # 01 · Flujo del pipeline
    fig = plt.figure(figsize=(14.5, 9.2))
    ax = fig.add_axes([0.02, 0.03, 0.58, 0.90])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis("off")
    steps = [
        ("1", "Foto del plato", "Se corrige la orientación EXIF y se limita el lado mayor a 1024 px.", COL["blue"]),
        ("2", "Segmentación", f"Mask2Former agnóstico → {len(pairs)} máscaras de alimento.", COL["cyan"]),
        ("3", "Clasificación", "Inception-V4 sobre cada recorte → 1 de 323 clases.", COL["green"]),
        ("4", "Profundidad", "Depth Anything V2 métrico → z(x, y) en metros por píxel.", COL["amber"]),
        ("5", "Escala con el plato", f"Hough detecta el plato de {diameter:.0f} cm → factor ×{scale:.3f}.", COL["red"]),
        ("6", "Geometría 3D", "Modelo pinhole + plano RANSAC → altura sobre la mesa.", "#7c3aed"),
        ("7", "Volumen → peso", "V = Σ h·A_px; peso = V·densidad; kcal por 100 g.", "#0f766e"),
    ]
    top, h, gap = 9.45, 0.88, 0.32
    for i, (num, title, body, color) in enumerate(steps):
        y = top - i * (h + gap)
        ax.add_patch(FancyBboxPatch((0.25, y - h), 9.35, h, boxstyle="round,pad=0.02,rounding_size=0.12",
                                    linewidth=1.2, edgecolor=color, facecolor=color + "12"))
        ax.add_patch(Circle((0.72, y - h / 2), 0.24, color=color, zorder=3))
        ax.text(0.72, y - h / 2, num, color="white", ha="center", va="center", fontsize=10, weight="bold", zorder=4)
        ax.text(1.12, y - 0.24, title, fontsize=11, weight="bold", color=COL["ink"], va="top")
        ax.text(1.12, y - 0.55, body, fontsize=8.8, color=COL["muted"], va="top")
        if i < len(steps) - 1:
            ax.annotate("", xy=(5.0, y - h - 0.03), xytext=(5.0, y - h - 0.29),
                        arrowprops=dict(arrowstyle="-|>", color="#94a3b8", lw=1.3))
    fig.suptitle("Cómo estima el peso el pipeline (Opción B)", fontsize=17, weight="bold", y=0.985)
    fig.text(0.02, 0.965, "Foto real de prueba · 1024×768 · CPU", fontsize=9, color=COL["muted"])

    mini = [(image, "Foto original", None), (None, "Máscaras segmentadas", "masks"),
            (depth_scaled, "Profundidad corregida (m)", "depth")]
    for (data, title, kind), y0 in zip(mini, [0.66, 0.36, 0.06]):
        axm = fig.add_axes([0.64, y0, 0.33, 0.26])
        if kind is None:
            axm.imshow(data); axm.axis("off")
        elif kind == "masks":
            axm.imshow(image)
            for p, color in zip(pairs, SEG_COLORS):
                rgba = np.zeros((*p["mask"].shape, 4), np.float32)
                rgba[p["mask"]] = matplotlib.colors.to_rgba(color, 0.45)
                axm.imshow(rgba); _contour(axm, p["mask"], color, 1.2)
            axm.axis("off")
        else:
            im = axm.imshow(data, cmap="magma"); axm.axis("off")
            cb = fig.colorbar(im, ax=axm, fraction=0.046, pad=0.02)
            cb.ax.tick_params(labelsize=7); cb.set_label("m", fontsize=7)
        axm.set_title(title, fontsize=9.5, loc="left", color=COL["ink"])
    _save(fig, "01_flujo_pipeline.png")

    # 02 · Mapa de profundidad
    fig, axes = plt.subplots(2, 2, figsize=(13, 10), constrained_layout=True)
    ax = axes[0, 0]
    _overlay(ax, image, pairs); _plate_circle(ax, plate, "white")
    ax.set_title("1 · Foto, máscaras y plato detectado", loc="left")
    if plate is not None:
        z_plate = focal_px * diameter / (2.0 * plate[2])
        ax.text(0.02, 0.02, f"plato: r={plate[2]:.0f} px · z≈{z_plate:.0f} cm",
                transform=ax.transAxes, fontsize=8.5, color="white",
                bbox=dict(facecolor="#0f172a", alpha=0.75, boxstyle="round,pad=0.3"))
    ax = axes[0, 1]
    im = ax.imshow(depth_raw, cmap="magma"); _plate_circle(ax, plate, "cyan"); ax.axis("off")
    ax.set_title("2 · Profundidad monocular (m)", loc="left")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02); cb.set_label("metros")
    ax.text(0.02, 0.02, f"mediana = {np.median(depth_raw):.2f} m", transform=ax.transAxes,
            fontsize=8.5, color="white", bbox=dict(facecolor="#0f172a", alpha=0.75, boxstyle="round,pad=0.3"))
    ax = axes[1, 0]
    im = ax.imshow(depth_scaled, cmap="magma"); _plate_circle(ax, plate, "cyan")
    for p, color in zip(pairs, SEG_COLORS): _contour(ax, p["mask"], color, 1.2)
    ax.axis("off"); ax.set_title("3 · Profundidad corregida con el plato (m)", loc="left")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02); cb.set_label("metros")
    ax.text(0.02, 0.02, f"factor ×{scale:.3f} · origen: {scale_source}", transform=ax.transAxes,
            fontsize=8.5, color="white", bbox=dict(facecolor="#0f172a", alpha=0.75, boxstyle="round,pad=0.3"))
    ax = axes[1, 1]
    im = ax.imshow(np.ma.masked_where(~food_union, hmap_all), cmap="viridis", vmin=0, vmax=6)
    for p, color in zip(pairs, SEG_COLORS): _contour(ax, p["mask"], color, 1.2)
    ax.axis("off"); ax.set_title("4 · Altura sobre la mesa (cm)", loc="left")
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02); cb.set_label("cm")
    ax.text(0.02, 0.02, f"máx = {hmap_all.max():.1f} cm · medio = {hmap_all[food_union].mean():.1f} cm\nV = Σ h · A_px",
            transform=ax.transAxes, fontsize=8.5, color="white",
            bbox=dict(facecolor="#0f172a", alpha=0.75, boxstyle="round,pad=0.3"))
    fig.suptitle("Del mapa de profundidad al volumen aparente", fontsize=16, weight="bold")
    _save(fig, "02_mapa_profundidad.png")

    # 03 · Volumen 3D por alimento
    fig = plt.figure(figsize=(15, 5.2))
    for i, p in enumerate(pairs, 1):
        ax = fig.add_subplot(1, 3, i, projection="3d")
        ys, xs = np.nonzero(p["mask"])
        if len(xs) > 3500:
            idx = np.random.default_rng(0).choice(len(xs), 3500, replace=False)
            ys, xs = ys[idx], xs[idx]
        z = depth_scaled[ys, xs].astype(np.float64) * 100.0
        X = (xs - (W - 1) / 2.0) / focal_px * z
        Y = (ys - (H - 1) / 2.0) / focal_px * z
        Z = p["hmap"][ys, xs]
        X -= X.mean(); Y -= Y.mean()
        ax.plot_trisurf(X, Y, Z, cmap="viridis", linewidth=0.15, antialiased=True, vmin=0, vmax=6)
        gx = np.linspace(X.min(), X.max(), 8); gy = np.linspace(Y.min(), Y.max(), 8)
        GX, GY = np.meshgrid(gx, gy)
        ax.plot_surface(GX, GY, np.zeros_like(GX), color="#cbd5e1", alpha=0.35, linewidth=0)
        ax.set_title(f"{_short(p['label'])} (detectado)\n{p['volume']:.1f} cm³ · {p['weight']:.1f} g\n"
                     f"real: {p['correct_name']} {p['real_g']:.0f} g", fontsize=10.5, pad=0)
        ax.set_xlabel("x (cm)", labelpad=0); ax.set_ylabel("y (cm)", labelpad=0); ax.set_zlabel("altura (cm)", labelpad=0)
        ax.set_zlim(0, 6); ax.view_init(elev=32, azim=-62)
    fig.suptitle("Volumen aparente: altura sobre la mesa × área de cada píxel", fontsize=15, weight="bold", y=1.02)
    fig.tight_layout()
    _save(fig, "03_volumen_3d.png")

    # 04 · Resultado sobre el plato
    fig = plt.figure(figsize=(15, 8))
    ax = fig.add_axes([0.02, 0.04, 0.58, 0.90])
    _overlay(ax, image, pairs); _plate_circle(ax, plate, "white")
    ax.set_title("Resultado del pipeline B sobre la foto", loc="left")
    axc = fig.add_axes([0.63, 0.06, 0.35, 0.86]); axc.axis("off")
    axc.text(0.0, 0.98, "PESO ESTIMADO", fontsize=10, color=COL["muted"], weight="bold")
    y = 0.90
    for p, color in zip(pairs, SEG_COLORS):
        axc.add_patch(FancyBboxPatch((0.0, y - 0.10), 0.98, 0.10, boxstyle="round,pad=0.01,rounding_size=0.02",
                                     facecolor=color + "18", edgecolor=color, linewidth=1))
        axc.text(0.03, y - 0.05, _short(p["label"], 20), fontsize=10.5, weight="bold", color=COL["ink"], va="center")
        axc.text(0.97, y - 0.05, f"{p['weight']:.1f} g  ·  {p['kcal']:.0f} kcal",
                 fontsize=9.5, color=COL["muted"], ha="right", va="center")
        axc.text(0.03, y - 0.085, f"{p['volume']:.1f} cm³ · densidad {p['density']:.2f} g/cm³",
                 fontsize=7.8, color=COL["muted"])
        y -= 0.135
    axc.plot([0, 1], [0.43, 0.43], color=COL["grid"], lw=1)
    axc.text(0.0, 0.36, "TOTAL", fontsize=10, color=COL["muted"], weight="bold")
    axc.text(0.97, 0.36, f"{result['totales']['peso_g']:.1f} g  ·  {result['totales']['calorias_kcal']:.0f} kcal",
             fontsize=13, weight="bold", color=COL["ink"], ha="right")
    axc.text(0.0, 0.28, "Referencia de la foto", fontsize=9, color=COL["muted"])
    axc.text(0.97, 0.28, "302 g  (34 + 163 + 105)", fontsize=9.5, color=COL["ink"], ha="right")
    corrected_total = sum(p["correct_g"] for p in pairs)
    corrected_line = " · ".join(f"{p['correct_name'].title()} {p['correct_g']:.0f} g" for p in pairs)
    axc.text(0.0, 0.26, "La app permite corregir la clase sin repetir la medida:\n"
             "el volumen ya está calculado con la profundidad.",
             fontsize=8.5, color=COL["muted"], va="top")
    axc.text(0.0, 0.18, "Tras corregir la clase", fontsize=8.5, color=COL["muted"])
    axc.text(0.97, 0.18, f"{corrected_total:.0f} g", fontsize=10, weight="bold",
             color=COL["green"], ha="right")
    axc.text(0.0, 0.12, corrected_line, fontsize=8, color=COL["muted"])
    _save(fig, "04_resultado_plato.png")

    # 05 · Peso estimado vs real
    labels = ["Plátano\n(seg. izquierdo)", "Cerdo\n(seg. central)", "Patata asada\n(seg. inferior)"]
    raw = [p["weight"] for p in pairs]
    corrected = [p["correct_g"] for p in pairs]
    real = [p["real_g"] for p in pairs]
    x = np.arange(len(labels)); w = 0.26
    fig, ax = plt.subplots(figsize=(10.5, 5.2))
    b1 = ax.bar(x - w, raw, w, label="Pipeline (clase detectada)", color="#94a3b8")
    b2 = ax.bar(x, corrected, w, label="Tras corregir la clase", color=COL["green"])
    b3 = ax.bar(x + w, real, w, label="Peso real", color=COL["ink"])
    for bars in (b1, b2, b3):
        for b in bars:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 3, f"{b.get_height():.0f}",
                    ha="center", va="bottom", fontsize=8.5)
    ax.set_xticks(x); ax.set_xticklabels(labels)
    ax.set_ylabel("gramos"); ax.set_ylim(0, max(raw + corrected + real) * 1.18)
    ax.grid(axis="y", alpha=0.25); ax.legend(frameon=False, fontsize=8.5)
    ax.set_title("Peso estimado frente al peso real", loc="left", pad=24)
    ax.text(0, 1.012, "La clase solo cambia la densidad; el volumen sale del mapa de profundidad.",
            transform=ax.transAxes, fontsize=9, color=COL["muted"])
    fig.tight_layout()
    _save(fig, "05_pesos_vs_reales.png")

    # 06 · Detección vs corrección de clase
    fig, axes = plt.subplots(1, 2, figsize=(14, 6.2))
    for ax, corrected in zip(axes, [False, True]):
        ax.imshow(image)
        for p, color in zip(pairs, SEG_COLORS):
            rgba = np.zeros((*p["mask"].shape, 4), np.float32)
            rgba[p["mask"]] = matplotlib.colors.to_rgba(color, 0.38)
            ax.imshow(rgba); _contour(ax, p["mask"], color)
            cx, cy = p["centroid"]
            if corrected:
                txt = f"{p['correct_name'].title()}\n{p['correct_g']:.0f} g"
            else:
                txt = f"{_short(p['label'])}\n{p['weight']:.0f} g"
            ax.text(cx, cy, txt, color="white", fontsize=9.5, weight="bold", ha="center", va="center",
                    bbox=dict(boxstyle="round,pad=0.35", facecolor=color, edgecolor="white", alpha=0.92))
        _plate_circle(ax, plate, "white")
        ax.axis("off")
        ax.set_title("Pipeline: clase detectada" if not corrected else "App: clase corregida",
                     loc="left", fontsize=12)
    fig.suptitle("La clase se puede cambiar sin repetir la medición de volumen", fontsize=15, weight="bold")
    fig.text(0.5, 0.01, "Máscaras y volúmenes idénticos; cambia la densidad y, con ella, el peso. "
             "Peso real: 34 / 163 / 105 g.", ha="center", fontsize=9, color=COL["muted"])
    fig.tight_layout(rect=[0, 0.03, 1, 0.96])
    _save(fig, "06_deteccion_vs_correccion.png")

    print("Figuras listas en:", HERE)


if __name__ == "__main__":
    main()
