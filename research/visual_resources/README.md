# Visual Resources · Depth Map and Weight Estimation

These resources illustrate, using a **real test photo** and the **production app pipeline (Option B)**, how a single photo is converted into weight in grams:

```
photo → Mask2Former (masks) → Inception-V4 (classes)
      → Metric Depth Anything V2 → plate scale calibration (26 cm)
      → 3D back-projection + RANSAC plane → volume → weight & nutrition
```

Photo: `34g_platano_163cerdo_105papa.jpg` (1024×768 after app preprocessing).
Ground-truth weights encoded in the filename: **34 g plantain/banana + 163 g pork + 105 g roasted potato = 302 g**.

## Files

| File | Description |
|---|---|
| `es/01_flujo_pipeline.png` | Infographic of the 7 pipeline stages, with thumbnails of the photo, masks, and depth map (Spanish). |
| `es/02_mapa_profundidad.png` | Photo with masks and plate circle, monocular depth in meters, plate-calibrated depth, and height above the table in cm (Spanish). |
| `es/03_volumen_3d.png` | 3D surface of each food item (height above the table) with estimated volume and weight (Spanish). |
| `es/04_resultado_plato.png` | Final result overlaid on the photo + summary card with weight, volume, density, and calories (Spanish). |
| `es/05_pesos_vs_reales.png` | Weight comparison: pipeline with detected class, after class correction, and ground-truth weight (Spanish). |
| `es/06_deteccion_vs_correccion.png` | Side-by-side: what the pipeline detects vs. the result after correcting the class in the app (Spanish). |
| `es/07_mapeo_flujo.png` | How the nutritional mapping was built: 323 classes → USDA → manual review → density → validation (Spanish). |
| `es/08_mapeo_cobertura.png` | Coverage and quality: match type, USDA source, density sources, confidence, and limitations (Spanish). |
| `es/09_mapeo_ejemplo.png` | Three real classes (banana/plantain, pork, potato) and the volume × density → grams step (Spanish). |
| `es/10_sesgo_primer_plano_small_vs_large.png` | Close-up scale bias (38.5 cm vs. 110–175 cm) in Depth Anything V2 Small vs. Large (Spanish). |
| `es/11_calibracion_escala_plato_hough.png` | Fiducial plate detection via circular Hough transform and metric depth normalization (Spanish). |
| `es/12_perfiles_relieve_3d_small_vs_large.png` | Cross-section profile and surface microtopography resolution: Small vs. Large (Spanish). |
| `es/13_paridad_gravimetrica_nutrition5k.png` | Gravimetric parity scatter plot on the Nutrition5k benchmark with ±15% clinical band (Spanish). |
| `es/14_panel_comparativo_multimodal_plato.png` | Full multimodal comparison panel: original RGB, segmentation masks, 3D map, and nutritional breakdown (Spanish). |
| `es/` | Complete collection of all 14 figures (01–14) with Spanish labels and legends. |
| `en/` | Complete collection of figures 10–14 with English text, labels, and legends for publication. |
| `profundidad_volumen_metricas.csv` | Detailed quantitative metrics for distance, MAE, and predicted masses on Nutrition5k. |
| `resultado_pipeline_B.json` | Full JSON output from the pipeline (the same structure returned by the app). |
| `segmentos.csv` | Per-segment table: class, confidence, volume, density, weight, height, plane, class correction, and ground-truth weight. |
| `datos_visuales.npz` | Arrays used to generate the figures (photo, depth maps, masks, height maps). |
| `index.html` | Browsable gallery with all figures, results table, and pipeline summary. |
| `generar_recursos.py` | Regenerates all resources in separate processes (models and figures isolated). |
| `generar_datos.py` | Runs the pipeline and saves the intermediate data. |
| `generar_figuras.py` | Renders the pipeline figures (01–06) from the saved data. |
| `generar_mapeo.py` | Reads `nutrition_wide_densidad.csv` and renders the nutritional mapping figures (07–09). |

## How Volume Is Computed

1. **Monocular depth.** Metric Depth Anything V2 outputs `z_model(x, y)` in meters. At close range, the model overestimates distance: in this photo the median is **1.58 m**, while the plate is roughly **30 cm** away.
2. **Plate-based scaling.** The plate rim is detected (Hough circle, 26 cm reference diameter). Using pinhole geometry:

   ```text
   z_plate = f_px · D_plate / (2 · r_plate)
   k       = z_plate / z_model
   z_real  = k · z_model
   ```

   In this photo: `k = 0.188`; the calibrated median distance drops to **~0.30 m**.
3. **3D back-projection.** Each pixel is projected into camera coordinates using the pinhole model:

   ```text
   P = z_real · ((x - cx)/f, (y - cy)/f, 1)
   ```

4. **Support plane.** A plane `n·P = d` is fitted with RANSAC using the ring of table/plate pixels around the food (excluding all food masks).
5. **Height and volume.** For each pixel inside the mask:

   ```text
   h    = clip(n·P - d, 0, 20 cm)
   A_px = z_real² / (f² · |n·d|)
   V    = Σ h · A_px
   ```

6. **Weight and nutrition.**

   ```text
   weight_g = V · density_g_cm3
   kcal     = weight_g / 100 · kcal_100g
   ```

This is an **apparent volume**: it only measures what is visible from the camera. The plate serves as the metric scale reference; without a reliable plate detection, the pipeline issues a warning and falls back to a bounded typical distance.

## Results on This Photo

The pipeline detected 3 segments, but misclassified two of them: banana/plantain was predicted as **chicken** and roasted potato as **caprese salad**. The app lets the user change the class without re-measuring: the volume stays the same, only the density changes.

| Segment | Detected class | Volume | Detected weight | Corrected class | Corrected weight | Ground-truth weight |
|---|---|---:|---:|---|---:|---:|
| left | chicken | 97.9 cm³ | 103.2 g | banana/plantain | 77.6 g | 34 g |
| center | pork | 234.7 cm³ | 190.6 g | pork | 190.6 g | 163 g |
| bottom | caprese salad | 85.1 cm³ | 57.5 g | roasted potato | 90.2 g | 105 g |
| **total** | | **417.6 cm³** | **351.3 g** | | **358.4 g** | **302 g** |

- **Pork** is the strong case: 190.6 g vs. 163 g actual (**+17%**).
- Banana/plantain and potato are misclassified; even so, manual class correction brings the total to **358 g** vs. 302 g actual.
- The banana/plantain volume is overestimated (97.9 cm³ for 34 g), likely because the mask captures part of the plate rim/glare. It is the hardest segment in this photo.

## Nutritional Mapping (Figures 07–09)

Full documentation is available in [`../nutrition_mapping/README.md`](../nutrition_mapping/README.md).

The mapping assigns each of the **323 classes** a USDA FoodData Central food item, its nutrients per 100 g, and a density (g/cm³). All 323 rows were manually reviewed across 7 batches (88 edits over the initial draft), followed by energy-coherence validation and a manual audit of 20 classes.

- **Match types:** exact 183, manual 73, close 41, recipe 15, proxy 10, composite 1.
- **USDA source:** SR Legacy 172, Survey (FNDDS) 111, Foundation 25, recipe 15.
- **Density:** USDA measured 203, published table 60, geometric calculation 43, recipe 15, category reference 2.
- **Quality:** 173 high-confidence densities, 92 medium, and 58 low; 316/323 rows pass energy coherence; 18/20 in LLM-assisted verification; 48 rows flagged for further technical review.

Figure 09 uses the volumes measured from the photo for the three food items: banana/plantain 97.9 cm³ × 0.793 = 77.6 g; pork 234.7 × 0.812 = 190.6 g; roasted potato 85.1 × 1.060 = 90.2 g.

## Regenerating

From the repository root, using the `ml` environment with `torch`, `transformers`, `timm`, `opencv-python-headless`, and the model weights in the repository root:

```powershell
python research/visual_resources/generar_recursos.py
```

The script runs `generar_datos.py` (models, depth, masks, volumes) and then `generar_figuras.py` and `generar_mapeo.py` in separate processes so matplotlib does not share memory with the inference models. On CPU it takes a few seconds and does not require a GPU.

## Notes

- The photo is intentionally challenging: three foods, one large and two small, with specular highlights and sauce. It is meant to demonstrate **how the geometry works**, not to serve as an accuracy benchmark.
- The app pipeline is **Option B** (`mask2former_agnostic.pt` + `inception_v4_food323.pt`) + Depth Anything V2 *Metric Indoor Small*.
- Depth and volume estimates depend on plate detection; if no plate is detected, the pipeline falls back to a typical camera distance and attaches a warning.
