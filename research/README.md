# Research artifacts · CaloriesCounter

This folder contains the small, reproducible artifacts of the Calorie Counter project: the data-preparation and training notebooks, the comparison notebook, the comparison tables and figures, the visual resources, the nutritional mapping, and the core tests.

The trained weights, the original Food Recognition 2022 images, the full `presentación/` tree, and the user photos are **not** included. See [Excluded artifacts](#excluded-artifacts).

## Structure

```text
research/
├── notebooks/
│   ├── 00_data_preparation.ipynb
│   ├── A1_yolo26m_agnostic.ipynb
│   ├── A2_yolo26n_agnostic.ipynb
│   ├── A4_mask2former_agnostic.ipynb
│   ├── B1_yolo26m_classes.ipynb
│   ├── B2_yolo26n_classes.ipynb
│   ├── B4_mask2former_classes.ipynb
│   ├── C1_custom_cnn.ipynb
│   ├── C2_mobilenetv3.ipynb
│   ├── C3_inception_v4.ipynb
│   ├── D1_depth_calibration_nutrition5k.ipynb
│   └── 99_results_comparison.ipynb
├── comparison/
│   ├── resumen.csv / resumen.json / resumen.xlsx
│   ├── segmentadores_agnostico.csv / segmentadores_clases.csv
│   ├── clasificadores.csv / clasificadores_pareado.csv
│   ├── perfiles_piezas.csv / perfiles_resumen.csv / perfiles_delta.csv
│   ├── profundidad_volumen_metricas.csv / profundidad_paridad_nutrition5k.png
│   ├── auditoria_runs.csv
│   ├── *.png (Spanish figures)
│   └── en/ (English figures 10 to 14)
├── visual_resources/
│   ├── index.html (browsable web gallery)
│   ├── 01_...png to 09_...png (pipeline and mapping figures)
│   ├── 10_...png to 14_...png (depth calibration and Nutrition5k)
│   ├── en/ (English versions of figures 10 to 14)
│   ├── README.md
│   ├── resultado_pipeline_B.json / segmentos.csv / profundidad_volumen_metricas.csv
│   └── generar_*.py
└── nutrition_mapping/
    ├── README.md
    ├── 01_mapeo_nutricional.ipynb
    ├── nutrition_wide_densidad.csv / food_names_es.csv
    ├── classes.json / recetas.csv / requirements.txt
    └── nutri_map/ (decisiones/, scripts/, verificacion_20.csv, validacion_coherencia.csv, REVISION.md, ...)
```

> Core pipeline unit tests live in [`../ml/tests/test_core.py`](../ml/tests/test_core.py).

## What is included

- **Data preparation (00):** original dataset counts, v2.0 → v2.1 class mapping, train/validation/test splits, crop database for classifiers, and the SAM2/polygon decision (the final crop set uses polygon masks, not SAM2).
- **Canonical experiments:** A1 (`A1_yolo26m_agnostic.ipynb`), A2 (`A2_yolo26n_agnostic.ipynb`), A4 (`A4_mask2former_agnostic.ipynb`), B1 (`B1_yolo26m_classes.ipynb`), B2 (`B2_yolo26n_classes.ipynb`), B4 (`B4_mask2former_classes.ipynb`), C1 (`C1_custom_cnn.ipynb`), C2 (`C2_mobilenetv3.ipynb`) and C3 (`C3_inception_v4.ipynb`).
- **Depth and volume calibration (D1):** quantitative close-up scale calibration of Depth Anything V2 (Small vs. Large), fiducial plate normalisation (Hough), and gravimetric parity evaluation on Google Research's Nutrition5k benchmark (`D1_depth_calibration_nutrition5k.ipynb`).
- **Comparison notebook (99):** inventory, audit, segmentation and classification comparisons, light/robust profiles, and summary export (`99_results_comparison.ipynb`).
- **Comparison tables and figures:** the CSV/XLSX/JSON outputs and the PNG figures used in the analysis (with bilingual EN/ES figures for publication).
- **Visual resources:** fourteen publication-grade figures explaining the pipeline, depth map, 3D volume, plate result, weight comparison, class correction, nutritional mapping, scale bias, and Nutrition5k parity. The HTML gallery is `visual_resources/index.html`.
- **Nutritional mapping:** the 323-class table with nutrients, density and provenance, plus its documentation and Spanish names.
- **Core tests:** volume, geometry, and nutrition tests in `tests/test_core.py`.
- **Paper documentation:** comprehensive Section V draft and the modular publication addendum (`CONTENIDO_PAPER_CALIBRACION_Y_NUTRITION5K.md`).

## Reproduction order

1. Open `notebooks/00_data_preparation.ipynb` and prepare the dataset. The original dataset is **not** included; download Food Recognition 2022 (MyFoodRepo) from Kaggle and set the paths in the notebook.
2. Run the A/B/C notebooks. They expect the weights in `MODELS_DIR` or the paths configured in each notebook. The weights are **not** included.
3. Run `notebooks/99_results_comparison.ipynb`. It only reads `resultados/*.json`, so it does not need a GPU or the dataset images.
4. Optionally, regenerate the visual resources with `visual_resources/generar_recursos.py`. The script needs the model weights and the test image; the original test photo is not included.

The notebooks keep their outputs where useful; if you re-run them, the results should match the tables in `comparison/`.

## Key results

- Segmentation: A4 reaches **AP50 0.752 / AR100 0.726**; A2 reaches **0.651 / 0.535** with 3.08 M parameters; B4 reaches **0.352** with classes and **0.657** in agnostic mode.
- Classification: C2 reaches **top-1 0.579 / macro-F1 0.423** with 4.62 M parameters; C3 reaches **0.578 / 0.427** with 41.64 M.
- Profiles: light (A2+C2 vs B2) and robust (A4+C3 vs B4). The robust profile improves AP50 of A by **+0.102** and AR100 by **+0.192** over the light profile, but adds **+81.3 M** parameters and **+115.2 ms** to A+C.
- Depth/volume test: raw depth median 1.58 m → corrected ≈0.30 m with a 26 cm plate; detected total 351.3 g versus 302 g real; the pork segment is 190.6 g versus 163 g real (+17%).
- Nutritional mapping: **323/323** classes with density, **316/323** with energy coherence, **18/20** in the manual verification (`nutrition_mapping/nutri_map/verificacion_20.csv`), 43 geometric densities and 48 rows still pending technical review.

## Excluded artifacts

- **Weights:** `*.pt`, `*.pth`, `*.onnx`, `*.safetensors`. They are large and belong in the Modal Volume or an external Drive.
- **Original dataset:** Food Recognition 2022 images and annotations. Download them from the original source and follow its license.
- **Full `presentación/` tree:** it is 5.8 GB with weights and runs.
- **User photos:** the original test photo is not included. The visual figures derived from it are included for academic documentation; replace the photo or obtain consent before reusing them outside this context.
- **Large predictions:** `predicciones/`, `predicciones_pilot/`, `runs/` and the big prediction JSON files.
- **Secrets:** `.env`, Modal/R2/Gemini/USDA keys.

## Attribution and licensing

- **USDA FoodData Central:** public-domain source; cite the source and consultation date.
- **FAO/INFOODS Density Database v2** and **Engineering Properties of Foods, table 4.2:** cited in the nutritional mapping README.
- **Food Recognition 2022 (MyFoodRepo):** the dataset retains its original license; this repository does not redistribute its images or annotations.
- **Code and documentation:** shared for academic review. Add an explicit `LICENSE` before external reuse.

## Notes

- The comparison notebook is the single source of truth for the tables; the CSVs in `comparison/` are generated from it.
- The visual resources are generated from the real pipeline and the real nutritional table, not from synthetic data.
- The nutritional mapping is complete for the 323 classes, but it is not a clinical database: 43 densities are geometric calculations, 48 rows are pending technical review, and some Foundation entries have incomplete micronutrients.
