# Research artifacts · CaloriesCounter

This folder contains the small, reproducible artifacts of the Calorie Counter project: the data-preparation and training notebooks, the comparison notebook, the comparison tables and figures, the visual resources, the nutritional mapping, and the core tests.

The trained weights, the original Food Recognition 2022 images, the full `presentación/` tree, and the user photos are **not** included. See [Excluded artifacts](#excluded-artifacts).

## Structure

```text
research/
├── notebooks/
│   ├── 00_datos_food_recognition_v4_sam2.ipynb
│   ├── A1_yolo26_agnostico_v2_m.ipynb
│   ├── A2_yolo26n_agnostico_corregido.ipynb
│   ├── A4_mask2former_agnostico_opt.ipynb
│   ├── B1_yolo26_clases_v4_final_m.ipynb
│   ├── B2_yolo26n_clases_corregido.ipynb
│   ├── B4_mask2former_clases_FIX.ipynb
│   ├── C1_cnn_propia_b_c.ipynb
│   ├── C2_mobilenetv3_224.ipynb
│   ├── C3_inception_v_unificado.ipynb
│   └── 99_comparacion_resultados.ipynb
├── comparison/
│   ├── resumen.csv / resumen.json / resumen.xlsx
│   ├── segmentadores_agnostico.csv
│   ├── segmentadores_clases.csv
│   ├── clasificadores.csv
│   ├── clasificadores_pareado.csv
│   ├── perfiles_piezas.csv / perfiles_resumen.csv / perfiles_delta.csv
│   ├── auditoria_runs.csv
│   └── *.png
├── visual_resources/
│   ├── index.html
│   ├── 01_...png ... 09_...png
│   ├── README.md
│   ├── resultado_pipeline_B.json
│   ├── segmentos.csv
│   └── generar_*.py
├── nutrition_mapping/
│   ├── README_mapeo nutricional.md
│   ├── nutrition_wide_densidad.csv
│   └── food_names_es.csv
├── docs/
│   └── Seccion_V_Implementacion_Propuesta.md
└── tests/
    └── test_core.py
```

## What is included

- **Data preparation (00):** original dataset counts, v2.0 → v2.1 class mapping, train/validation/test splits, crop database for classifiers, and the SAM2/polygon decision (the final crop set uses polygon masks, not SAM2).
- **Nine canonical experiments:** A1, A2, A4, B1, B2, B4, C1, C2 and C3. The earlier `B1_yolo26_clases v4.ipynb` duplicate is intentionally excluded; the canonical B1 is `B1_yolo26_clases_v4_final_m.ipynb`.
- **Comparison notebook (99):** inventory, audit, segmentation and classification comparisons, light/robust profiles, and summary export.
- **Comparison tables and figures:** the CSV/XLSX/JSON outputs and the PNG figures used in the analysis.
- **Visual resources:** nine figures explaining the pipeline, depth map, 3D volume, plate result, weight comparison, class correction and the nutritional mapping. The HTML gallery is `visual_resources/index.html`.
- **Nutritional mapping:** the 323-class table with nutrients, density and provenance, plus its documentation and Spanish names.
- **Core tests:** volume and nutrition tests in `tests/test_core.py`.
- **Section V draft:** the implementation/progress section, with V.A in English and V.B–V.L in Spanish.

## Reproduction order

1. Open `notebooks/00_datos_food_recognition_v4_sam2.ipynb` and prepare the dataset. The original dataset is **not** included; download Food Recognition 2022 (MyFoodRepo) from Kaggle and set the paths in the notebook.
2. Run the A/B/C notebooks. They expect the weights in `MODELS_DIR` or the paths configured in each notebook. The weights are **not** included.
3. Run `notebooks/99_comparacion_resultados.ipynb`. It only reads `resultados/*.json`, so it does not need a GPU or the dataset images.
4. Optionally, regenerate the visual resources with `visual_resources/generar_recursos.py`. The script needs the model weights and the test image; the original test photo is not included.

The notebooks keep their outputs where useful; if you re-run them, the results should match the tables in `comparison/`.

## Key results

- Segmentation: A4 reaches **AP50 0.752 / AR100 0.726**; A2 reaches **0.651 / 0.535** with 3.08 M parameters; B4 reaches **0.352** with classes and **0.657** in agnostic mode.
- Classification: C2 reaches **top-1 0.579 / macro-F1 0.423** with 4.62 M parameters; C3 reaches **0.578 / 0.427** with 41.64 M.
- Profiles: light (A2+C2 vs B2) and robust (A4+C3 vs B4). The robust profile improves AP50 of A by **+0.102** and AR100 by **+0.192** over the light profile, but adds **+81.3 M** parameters and **+115.2 ms** to A+C.
- Depth/volume test: raw depth median 1.58 m → corrected ≈0.30 m with a 26 cm plate; detected total 351.3 g versus 302 g real; the pork segment is 190.6 g versus 163 g real (+17%).
- Nutritional mapping: **323/323** classes with density, **316/323** with energy coherence, **18/20** in the manual verification, 43 geometric densities and 48 rows still pending technical review.

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
