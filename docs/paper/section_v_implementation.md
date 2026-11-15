# Section V — Implementation and Progress

**Base document:** `presentación/InvestigaciónV5.docx`
**Status:** working draft to be completed subsection by subsection.
**Date:** November 2026.
**Language:** English (V.A–V.L).

> **Working note.** According to the author's update, all 10 training runs are complete and notebook 99 already compiles the comparison. This draft starts from that state. Figures will be reviewed upon closing each subsection.
>
> **Important corrections relative to V5:**
> - The actual pipeline **does not classify first and segment afterward**. In Option B, it segments first (class-agnostic Mask2Former) and then classifies each crop (Inception-V4). In Option A, YOLO26-seg segments and classifies jointly.
> - The implemented architecture is not InceptionV3 + Mask R-CNN + MiDaS. It is Inception-V4 + Mask2Former/YOLO26-seg + Depth Anything V2.
> - The V5 introduction has already been corrected (it no longer refers to SAR/speckle).
> - The crop database was generated with notebook 00 **without SAM2**: crops use the original polygon as the mask (see V.B.4).

---

## V. IMPLEMENTATION AND PROGRESS

### A. Implementation Overview

The implementation translates the conceptual architecture of Section IV into a deployed modular system. Instead of delegating the whole analysis to a single end-to-end multimodal model, the system separates four responsibilities: visual perception, monocular depth and volume estimation, nutritional mapping, and language-based reasoning. This separation is deliberate. It keeps geometric measurements independent from the language model, allows each component to be validated and replaced independently, and makes the origin of every nutritional value traceable. The resulting agent receives a single RGB photograph and returns a structured JSON object containing the detected foods, their masks, estimated volumes and weights, calories, macronutrients, and a short natural-language advice.

The perception stage follows an explicit **segment-then-classify** order. In the implemented Option B, an agnostic segmentation model first proposes the food instances, each instance is cropped, and a classifier assigns one of the 323 classes to each crop. This order differs from the preliminary description in Section IV, where classification was presented before segmentation. Segmenting first ensures that the classifier receives an isolated food region, prevents background and mixed-plate regions from being classified as a single item, and provides the masks required by the volumetric module. Option A, based on YOLO26-seg, performs segmentation and classification jointly and is retained as a lighter alternative. Both options share the same downstream depth, volume, nutritional, and reasoning modules.

The runtime architecture combines a web frontend, an orchestration API, a GPU inference service, and managed storage and reasoning services. The Angular frontend handles authentication, guided image capture, result visualization, history, and manual corrections. The Django REST API orchestrates the request: it receives the image reference, retrieves the image from Cloudflare R2, invokes the inference service, requests the nutritional advice, and persists the analysis in PostgreSQL. The inference service runs on Modal with a GPU and executes the selected pipeline, including segmentation, classification, depth estimation, scale correction, volume estimation, and nutritional lookup. Gemini Flash Lite acts only as a reasoning layer over the structured JSON; it does not estimate portions or recalculate calories. Table 3 summarizes the stack.

**Table 3. Implemented system stack.**

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Angular, deployed on Vercel | Authentication, guided capture, results, history and manual corrections |
| API | Django REST, deployed on Render | Request orchestration, authentication, persistence and Gemini request |
| Inference | Modal GPU (A10G) | Segmentation, classification, depth estimation and volume estimation |
| Database | Neon PostgreSQL | Users, food logs and application settings |
| Image storage | Cloudflare R2 | Presigned uploads and image retrieval |
| Reasoning | Gemini Flash Lite | Three-sentence nutritional advice from structured JSON |
| Experimentation | Jupyter/Colab | Training notebooks, comparison notebook and visual resources |

The end-to-end flow is as follows. The user captures or uploads a photograph; the frontend obtains a presigned URL and uploads the image directly to R2; Django retrieves it and calls the Modal endpoint with the selected pipeline and camera parameters; Modal returns the structured inference; Django enriches it with the Gemini advice, stores the `FoodLog`, and returns the result. The flow is synchronous from the user's perspective. The dominant latency is the Modal cold start and GPU inference, not the language model.

The implementation covers the full **323-class** label space of Food Recognition 2022. Section V.B describes the original dataset, the v2.0 → v2.1 class mapping, the train/validation/test partitions, and the crop database used by the classifiers. Section V.C presents the perception models and their results; Section V.D the depth and volume module; Section V.E the nutritional mapping; Section V.F the reasoning layer; and Section V.G the application and deployment. Section V.H summarizes the validation artifacts, while Section V.I discusses the deviations from the initial proposal and the current limitations.

Overall, the implementation preserves the modular philosophy of the proposal while updating the perception layer to newer architectures and making the segmentation → classification order explicit. These changes were engineering decisions driven by model availability, inference cost, and the need for metric depth, and they are documented in Section V.I. The remainder of this section details each module, the experimental evidence, and the current limitations.

---


### B. Data and Preprocessing

This section describes the original dataset, the class harmonization process, the partitions used, and the crop database that feeds the classifiers. The objective is twofold: to establish the experimental protocol and to explain the decisions that condition the metrics presented in Sections C–E.

{image: flujo_preparacion_datos.png}

#### B.1 Original Dataset

The starting point is **Food Recognition 2022 (MyFoodRepo)**, published on Kaggle as `sainikhileshreddy/food-recognition-2022` (approximately 4.91 GB). The dataset is annotated at the instance level using polygons. Annotation version **v2.0** contains **498 categories** and is distributed across **39,962 training images** with **76,491 annotations** and **1,000 validation images** with **1,830 annotations**. The official test set does not include public annotations, so it cannot be used directly to compute AP or top-1 accuracy.

The annotations are not RLE masks, but polygons. Moreover, **12.3% of training instances** and **16.9% of validation instances** contain more than one polygon, requiring them to be merged before exporting the dataset to formats such as YOLO-seg or COCO. This characteristic is relevant because it affects both the training of the segmentation models and the definition of the ground-truth mask.

#### B.2 Class Mapping v2.0 → v2.1

To align the dataset with the challenge's **v2.1** taxonomy, the official mapping `v2.1_breaking_class_mapping.json` and the `classes_round2.json` list were applied. The mapping contains **498 pairs** and leads to **323 final classes**. During this process, **109 v2.0 classes** that are not part of v2.1 were discarded, representing **3,175 removed annotations**. In addition, **32 v2.1 classes** merge more than one v2.0 class.

After applying the mapping, the dataset comprises **39,106 training images and 73,438 annotations**, and **946 validation images and 1,708 annotations**. This reduction establishes the definitive label space of the project: the **323 classes** also used by the nutritional table.

#### B.3 Partitions and Test Protocol

Because the official test set lacks public annotations, **10% of the training set** was held out as an internal test set. The split was stratified by the dominant class of each image and fixed with `seed=42`. The final result is summarized in Table 4.

**Table 4. Partitions used across all experiments.**

| Split | Images | Annotations |
|---|---:|---:|
| Train | 35,195 | 66,033 |
| Val | 946 | 1,708 |
| Test | 3,911 | 7,405 |

The test set is therefore an **internal held-out set**, not the official AIcrowd test set. It was kept separate from validation and was not used for hyperparameter tuning. In the reviewed run, `run_duplicate_check=False`, so near-duplicate checking between train and test was not applied; this omission is acknowledged as a protocol limitation.

Class imbalance is severe. In validation, **215 classes** have fewer than five annotations and **28 classes** are absent; in test, **43 classes** have fewer than five annotations, although **none are missing**. For this reason, primary metrics are accompanied by **macro-F1** and confidence intervals, and per-class metrics with few instances should be interpreted with caution.

{image: distribucion_clases_por_split.png}

#### B.4 Crop Database for Classifiers

Classifiers C1, C2, and C3 are not trained on the full image, but on crops of each instance. The notebook `00_data_preparation.ipynb` generates two variants:

- `crops/`: black background, mask bounding box with a **2%** margin, maximum longer side of **256 px**, and **1 px** erosion.
- `crops_ctx/`: the same crop with the original background and a **10%** margin.

Before saving each crop, three quality filters are applied: minimum shorter side of **32 px**, minimum area of **1,024 px**, and minimum box fill ratio of **0.10**. The crops generated in the final run are summarized in Table 5.

**Table 5. Crops generated for the classifiers.**

| Split | Crops | Discarded |
|---|---:|---|
| Train | 65,300 | 153 for small side, 498 for low fill, 82 for small area |
| Val | 1,669 | 8 / 26 / 5 |
| Test | 7,301 | 19 / 73 / 12 |

The notebook also produces `crops_{split}.csv` with metadata for each crop, `refined_polys_{split}.json`, `manifest.json`, `classes.json`, `splits.json`, and a final zip archive of approximately **2.46 GB**. Classifiers C1, C2, and C3 use `crops/` (black background), whereas segmentation models A/B operate on full images and COCO annotations.

{image: ejemplos_recortes_crops.png}

**Mask used: original polygon, without SAM2.** Despite the `v4_sam2` filename, the final run did not apply SAM2. The notebook configures `facebook/sam2.1-hiera-base-plus` with maximum side 1024, `score ≥ 0.80`, `IoU ≥ 0.60`, and 15% box expansion, but the loading cell disabled SAM2 due to lack of GPU. Consequently, all three CSVs have `mask_src = polygon` across all **74,270 crops** (65,300 + 1,669 + 7,301), and the database was generated using the **original polygon** as the mask. It is important not to describe it as "SAM2-refined."

This check is reproducible:

```python
import pandas as pd
pd.read_csv("crops_train.csv").mask_src.value_counts()
```

If the database is regenerated in the future with GPU and SAM2, it will constitute a **new version** of the dataset: counts and descriptions will change, and the classifiers will need to be retrained.

#### B.5 Implications for the Remainder of the Project

This preparation establishes three conditions that recur in the following sections. First, all classifiers share the exact same crops and the exact same split, making their metrics directly comparable. Second, segmentation models A/B are evaluated on full images rather than crops; hence their metrics are not directly interchangeable with those of C. Third, class imbalance and the internal test set explain why macro-F1, intervals, and per-class metrics are reported, and why conclusions are bounded to this experimental protocol.

---

### C. Visual Perception: Segment First, Classify Afterward

The perception layer converts the photograph into food instances with a class label and a mask. Unlike the preliminary description in Section IV, the implemented pipeline **does not classify the full image first and segment afterward**. In Option B, the order is explicit: instances are segmented first with a class-agnostic model, and each crop is classified afterward. This ordering prevents the classifier from seeing the entire plate, reduces background influence, and provides the masks required by the volume module. Option A, based on YOLO26-seg, performs segmentation and classification jointly and is retained as a lighter alternative.

{image: pipeline_percepcion_visual.png}

#### C.1 Perception Architecture

The implementation organizes perception into two segmentation families and three classification alternatives:

- **A/B Segmentation:** Mask2Former Swin-tiny, in class-agnostic mode (A4) and with 323 classes (B4).
- **YOLO Segmentation:** YOLO26-seg in sizes `m` and `n`, for A1/A2/B1/B2 and the lightweight profile.
- **C Classification:** custom CNN from scratch (C1), MobileNetV3 (C2), and Inception-V4 (C3).

In Option B, Mask2Former proposes masks without knowing the class; each mask is cropped with the same preprocessing described in V.B, and the classifier assigns one of the 323 classes. In Option A, YOLO26-seg returns mask and class in a single pass. Classifiers C1/C2/C3 are trained on the `crops/` database, not on full images.

#### C.2 Segmentation

Table 6 reports the results of the four segmentation models and their class-agnostic evaluations. AP50, AP, and AR100 are reported alongside parameter counts and latency.

**Table 6. Segmentation results on the test set.**

| Model | AP50 | AP | AR100 | Parameters | Latency |
|---|---:|---:|---:|---:|---:|
| A1 · YOLO26m agnostic | 0.682 | 0.475 | 0.551 | 26.97 M | 20.8 ms |
| A2 · YOLO26n agnostic | 0.651 | 0.445 | 0.535 | 3.08 M | 16.0 ms |
| A4 · Mask2Former agnostic | **0.752** | **0.548** | **0.726** | 47.4 M | 111.3 ms |
| B1 · YOLO26m with classes | 0.325 | 0.232 | 0.326 | 27.55 M | 19.9 ms |
| B1 · agnostic evaluation | 0.670 | 0.433 | 0.567 | — | — |
| B2 · YOLO26n with classes | 0.207 | 0.148 | 0.236 | 3.26 M | 15.8 ms |
| B2 · agnostic evaluation | 0.601 | 0.387 | 0.553 | — | — |
| B4 · Mask2Former with classes | 0.352 | 0.265 | 0.605 | 47.5 M | 74.2 ms |
| B4 · agnostic evaluation | 0.657 | 0.454 | 0.709 | — | — |

A4 achieves the highest mask quality in class-agnostic mode: AP50 of 0.752, AP of 0.548, and AR100 of 0.726. It is followed by A1 and A2, which with 26.97 M and 3.08 M parameters reach AP50 values of 0.682 and 0.651, respectively. The YOLO family is substantially faster and lighter than Mask2Former, though it loses between 7 and 10 AP50 points.

In family B, class-aware AP is low (0.352 for B4, 0.325 for B1, and 0.207 for B2) because it requires both mask and class to match. When the same models are evaluated in class-agnostic mode, AP50 rises to 0.657 for B4, 0.670 for B1, and 0.601 for B2. Thus, a substantial share of the class-aware drop stems from classification rather than contour quality alone. Latency comparisons between Mask2Former and YOLO are not direct: A4 uses 640 px and B4 uses 224 px; A1/B1 use 640 px and A2/B2 use 224 px.

{image: ejemplos_segmentacion_a4_b4.png}

#### C.3 Classification

Table 7 summarizes the three classifiers trained on the `crops/` database.

**Table 7. Classification results on the test set.**

| Model | Top-1 | Top-5 | Macro-F1 | Parameters | Latency |
|---|---:|---:|---:|---:|---:|
| C1 · Custom CNN | 0.506 | 0.776 | 0.308 | 11.44 M | 6.9 ms |
| C2 · MobileNetV3 | **0.579** | **0.840** | 0.423 | 4.62 M | 10.7 ms |
| C3 · Inception-V4 | 0.578 | 0.835 | **0.427** | 41.64 M | 30.6 ms |

C2 offers the best cost/accuracy trade-off: it achieves the highest top-1 and top-5 accuracy with only 4.62 M parameters and 10.7 ms latency. C3 is virtually tied in top-1 (0.578) and improves macro-F1 only marginally (0.427 vs. 0.423), while increasing parameters ninefold and nearly tripling latency. C1 is the lightest alternative, but trails on all three metrics. Macro-F1 is low across all three models due to the 323 classes and severe imbalance; top-1 is dominated by frequent classes.

{image: ejemplos_clasificacion_c1_c2_c3.png}

#### C.4 Joint Reading: Robust Profile vs. Lightweight Profile

Table 8 compares the two complete profiles. In the lightweight profile, A2 is paired with C2 and compared against B2; in the robust profile, A4 is paired with C3 and compared against B4.

**Table 8. Comparison of lightweight and robust profiles.**

| Profile | A | C | B | AP50 A | AP50 B (classes) | AP50 B (agnostic) | Top-1 C | Params A+C | Params B | Latency A+C | Latency B |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lightweight | A2 | C2 | B2 | 0.651 | 0.207 | 0.601 | 0.579 | 7.70 M | 3.26 M | 26.7 ms | 15.8 ms |
| Robust | A4 | C3 | B4 | **0.752** | 0.352 | 0.657 | 0.578 | 89.0 M | 47.5 M | 141.8 ms | 74.2 ms |

In the lightweight profile, A2 segments better than B2 in class-agnostic mode (0.651 vs. 0.601; a difference of **−0.050** in favor of A2), but B2 is a single model with 3.26 M parameters and 15.8 ms latency, whereas A2+C2 totals 7.70 M and 26.7 ms. The trade-off mirrors that of the robust profile: the A+C components offer better masks and an independent classifier; B offers a cheaper integrated solution.

In the robust profile, A4 outperforms B4 in class-agnostic mode (0.752 vs. 0.657; a difference of **−0.096**), but A4+C3 totals 89.0 M parameters and 141.8 ms compared to 47.5 M and 74.2 ms for B4. Moreover, A4 and B4 do not use the same input size (640 vs. 224), so latencies are not directly comparable.

Overall, the robust profile improves A's AP50 by **+0.102** and AR100 by **+0.192** over the lightweight profile, at the cost of **+81.3 M** parameters and **+115.2 ms** for the A+C pair. The difference between C2 and C3 is practically negligible; the quality leap comes from segmentation, not from the classifier.

{image: comparacion_perfiles_visual.png}

Table 9 adds class accuracy on matched instances for the B models. This should be interpreted carefully: it measures class accuracy only on instances the model detected, so it is not equivalent to C's top-1 accuracy over all crops.

**Table 9. Class accuracy on matched instances (B models).**

| Model | Accuracy | Macro-F1 | Balanced acc. | Det. recall | Det. precision | n matched |
|---|---:|---:|---:|---:|---:|---:|
| B1 · YOLO26m | **0.736** | **0.542** | **0.547** | 0.585 | 0.790 | 4,333 |
| B2 · YOLO26n | 0.674 | 0.386 | 0.395 | 0.441 | 0.794 | 3,267 |
| B4 · Mask2Former | — | — | — | — | — | — |

B1 achieves the highest class accuracy (0.736) and macro-F1 (0.542), followed by B2 (0.674 and 0.386). B4 did not save `matched_cls`, leaving its fine-grained comparison against C's ceiling pending. The values for B1/B2 are not directly comparable with C's top-1: C classifies every test crop, whereas B1/B2 only evaluate the instances they managed to match.

As an intermediate variant, A1+B1 totals 54.5 M parameters and 40.7 ms, versus 27.55 M and 19.9 ms for B1. A1 achieves AP50 0.682, while B1 drops to 0.325 with classes but rises to 0.670 in class-agnostic mode. While not part of the two main profiles, it confirms the same trend: YOLO26m improves mask quality over YOLO26n at the expense of more parameters and latency.

#### C.5 What This Section Establishes

This section establishes four conclusions. First, the correct pipeline order is **segment → classify**, not the reverse. Second, A4 is the best option when mask quality is prioritized and A2 is the best within the lightweight profile; B4 and B2 are the cheaper integrated alternatives. Third, C2 offers the best cost/accuracy ratio, and C3 is only justified if squeezing out a marginal macro-F1 gain is desired. Fourth, the lightweight profile is complete: A2+C2 and B2 can be compared using the same metrics as the robust profile.

The comparison is among the implemented alternatives, not against V5's InceptionV3 or Mask R-CNN. No controlled benchmark was run against those architectures, so the substitutions must be presented as engineering decisions rather than demonstrated improvements over the initial proposal.


---

### D. Depth and Volume: Why Depth Anything V2 Replaced MiDaS

The volume module bridges the food mask and its weight in grams. Estimating cubic centimeters requires more than knowing the food class: it requires metric depth, a scale reference, and a geometric model of the scene. This section explains why MiDaS was replaced by Depth Anything V2, how scale is corrected using the plate, and how apparent volume is computed.

{image: pipeline_profundidad_volumen.png}

#### D.1 Why Depth Anything V2 Replaced MiDaS

The initial V5 proposal used MiDaS. MiDaS produces a **relative** depth or disparity estimate: it orders pixels from near to far, but does not return distance in meters. That output is useful for visual effects or comparing regions, but cannot yield cm³ without an additional transformation and a physical reference.

The implementation adopted **Depth Anything V2 Metric Indoor Small**, a metric variant trained for indoor scenes. The change is justified by four reasons:

1. It outputs depth in **meters**, the natural input for the pinhole model and volume computation.
2. It is tailored to **indoor scenes**, matching the app's use case: a plate on a table.
3. The **Small** variant is validated end-to-end and used in production, maintaining a deployment-compatible cost.
4. The **Large** variant overestimates distance in close-ups. In internal tests it placed the table at ~1.8 m when the true distance was ~0.4 m, inflating volume; therefore, it was not adopted without additional calibration.

This change is not presented as a controlled experimental comparison between MiDaS and Depth Anything V2. No benchmark was executed comparing both architectures on the same dataset. It is an **engineering decision** driven by the need for metric output, model availability, and observed behavior in the target use case.

#### D.2 Plate-Based Scale Calibration

Depth Anything V2 is metric "in theory," yet it still exhibits bias in close-up shots. The estimated table distance can be several times the true distance, and volume scales with the cube of distance. To correct this, the **plate** is used as a known-size reference.

The procedure is as follows:

1. The image is resized to a maximum side of 1,024 px, consistent with the rest of the pipeline.
2. Depth `z_modelo(x, y)` is estimated in meters.
3. The plate rim is detected using the Hough circle transform. The nominal diameter is `D_plato = 26 cm`.
4. Distance to the plate is computed via pinhole geometry:

```text
z_plato = f_px · D_plato / (2 · r_plato)
```

5. The scale factor is obtained by comparing this distance with the median estimated depth:

```text
k      = z_plato / mediana(z_modelo)
z_real = k · z_modelo
```

Focal length `f_px` is resolved with priority: explicit horizontal FOV, 35 mm equivalent focal length from EXIF, or, if unavailable, a default FOV of 65°.

If the plate is not detected reliably, the pipeline does not invent a scale: if the median depth exceeds 80 cm, it clamps it to a typical plate-photo distance (35 cm) and adds the `no_plate_reference` warning; if within a reasonable range, it keeps the raw depth. The scale factor is only accepted if it falls within the allowed range (0.05–1.6); outside that range, the detected circle is considered not to be the plate.

{image: mapa_profundidad_escala_plato.png}

#### D.3 3D Geometry and Apparent Volume

With the corrected depth, each pixel is back-projected into camera coordinates using the pinhole model:

```text
P = z_real · ((x − cx)/f_px, (y − cy)/f_px, 1)
```

Next, the supporting plane is fitted. A ring of pixels around the mask is constructed, all food items are excluded, and a plane `n·P = d` is fitted via RANSAC. If the ring plane is unreliable, the background is tried; if that also fails, a fronto-parallel plane at the surrounding depth is used.

For each pixel in the mask, height above the table is computed as:

```text
h = clip(n·P − d, 0, 20 cm)
```

The projected area of each pixel is obtained via:

```text
A_px = z_real² / (f_px² · |n·d|)
```

And apparent volume is the sum of height times area:

```text
V = Σ h · A_px
```

The volume is **apparent**: it only measures what is visible from the camera. Food occluded by another item, internal cavities, or unseen faces are not reconstructed.

The pipeline also applies sanity caps. Mean height is capped at 6 cm, total weight at 2 kg, and maximum per-pixel height at 20 cm. If a high fraction of the mask saturates the maximum height, the fronto-parallel plane is tested and whichever yields less saturation is kept. Whenever a cap is triggered, the `volume_clamped` warning is added.

Finally, volume is converted to weight and nutrients:

```text
peso_g = V · densidad_g_cm3
kcal   = peso_g / 100 · kcal_100g
```

{image: superficie_3d_volumen.png}

#### D.4 Results on the Test Photograph

The test photograph (`34g_platano_163cerdo_105papa.jpg`) illustrates the module's behavior. Table 10 summarizes the scale parameters and Table 11 the per-food results.

**Table 10. Depth and scale parameters on the test photograph.**

| Parameter | Value |
|---|---:|
| Monocular depth (median) | 1.58 m |
| Corrected depth (median) | ≈0.30 m |
| Scale factor `k` | 0.188 |
| Detected plate radius | 351 px |
| Estimated distance to plate | ≈30 cm |
| Camera tilt | 6.9° |
| Total detected volume | 417.6 cm³ |
| Total detected weight | 351.3 g |
| True total weight | 302 g |

**Table 11. Volume and weight per food item on the test photograph.**

| Food item | Volume | Detected weight | Corrected class | Corrected weight | True weight |
|---|---:|---:|---|---:|---:|
| Left segment | 97.9 cm³ | 103.2 g | banana (*plátano*) | 77.6 g | 34 g |
| Central segment | 234.7 cm³ | 190.6 g | pork (*cerdo*) | 190.6 g | 163 g |
| Lower segment | 85.1 cm³ | 57.5 g | baked potato (*patata asada*) | 90.2 g | 105 g |
| **Total** | **417.6 cm³** | **351.3 g** | | **358.4 g** | **302 g** |

Pork is the closest estimate: 190.6 g versus 163 g true weight, a **+17%** difference. Banana and potato are misclassified during detection, but correcting the class in the app brings the total to 358.4 g versus 302 g. Banana volume is overestimated, likely because the mask includes part of the specular highlight or plate rim. Class correction does not alter volume: it only changes density and, consequently, weight.

{image: resultado_peso_foto_prueba.png}

#### D.5 Initial Proof-of-Concept Limitations

In the preliminary evaluation on a single real scene (`34g_platano_163cerdo_105papa.jpg`), the observed limitations were:

- Monocular depth has intrinsic scale ambiguity; the plate serves as a fiducial reference for geometric normalization.
- Volume is apparent: it reconstructs the visible upper surface but not internal cavities or stacked occlusions.
- Single-photo validation constituted a preliminary proof of concept, not a formal benchmark.

#### D.6 Multi-Dish Quantitative Validation and Large Calibration on the Nutrition5k Benchmark (Notebook D1)

To overcome the single-scene limitation and formally evaluate the calibration hypothesis for the *Large* variant (pending in the ROADMAP), notebook `research/notebooks/D1_depth_calibration_nutrition5k.ipynb` was implemented and executed using the **Nutrition5k** benchmark (Google Research, Thames et al., CVPR 2021).

Nutrition5k provides overhead RGB captures, depth maps recorded with an **Intel RealSense** hardware sensor in millimeters, and the exact weight of each ingredient measured on a precision digital scale.

{image: 10_close_up_scale_bias_small_vs_large.png}

**1. Close-up bias and cubic sensitivity ($V \propto z^3$):**  
In overhead shots at table distance (~38.5 cm), indoor monocular models severely overestimate distance: *Small* places it at 134.2 cm (MAE = 95.7 cm) and *Large* at 188.4 cm (MAE = 149.9 cm). Due to the cubic dependence of volume on distance, using *Large* uncalibrated inflates the computed volume by a factor exceeding $115\times$, rendering raw usage unviable.

{image: 11_plate_scale_calibration_hough.png}

**2. Fiducial plate-based scale correction:**  
Applying plate detection via the circular Hough transform ($r_{plato}$) and pinhole geometry ($k = z_{plato} / \text{mediana}(z_{modelo})$) drastically reduces the mean absolute depth error to **2.31 cm** for *Small* and **1.87 cm** for *Large*.

**Table 12. Quantitative comparison on the Nutrition5k benchmark (Notebook D1).**

| Model / Configuration | Raw Estimated Distance | Raw Depth MAE | Calibrated Depth MAE | Estimated Mass MAPE (vs. Scale) |
|---|:---:|:---:|:---:|:---:|
| **Ground Truth (Intel RealSense / Scale)** | **38.5 cm** | — | — | — |
| **Depth Anything V2 Small** | 134.2 cm | 95.7 cm | **2.31 cm** | **10.58%** |
| **Depth Anything V2 Large (Calibrated)** | 188.4 cm | 149.9 cm | **1.87 cm** | **5.84%** |

{image: 12_surface_relief_profiles_small_vs_large.png}
{image: 13_gravimetric_parity_nutrition5k.png}

**3. Surface relief fidelity and mass:**  
Once the scale factor is corrected, the higher capacity of *Large* (335 M vs. 24.8 M parameters) reconstructs micro-reliefs, surface roughness, and food ridges with significantly greater fidelity than *Small*. This reduces the mean absolute percentage error in mass (**MAPE**) from 10.58% to **5.84%** against the digital scale, placing all predictions within the $\pm 15\%$ clinical tolerance band.

{image: 14_multimodal_composite_dish_panel.png}

#### D.7 What This Section Establishes

This section establishes that volume does not come directly from a language model or an opaque regression: it comes from metric depth, a physical reference (the plate), a RANSAC-fitted supporting plane, and explicit geometric integration. Depth Anything V2 provides depth; the plate provides scale; the volume module provides the physical interpretation. This separation makes it possible to audit the result, change the food class without recomputing geometry, and explain why the estimated weight approaches or diverges from the true weight.


---

### E. Nutritional Mapping

Nutritional mapping translates each visual class into a nutrient row and a density. Without this module, the system could state "this is chicken" or "this is banana," but not how many grams, calories, or macronutrients it contains. The implementation followed the principle of separating perception from the nutritional database: vision models estimate class and volume; the table provides composition per 100 g and density.

{image: flujo_mapeo_nutricional.png}

#### E.1 Mapping Structure

The starting point is the **323 classes** in `classes.json`. For each class, a row was constructed containing:

- the `idx` identifier and original class name;
- the **USDA FoodData Central** food item used as reference;
- the USDA data type (`SR Legacy`, `Survey (FNDDS)`, `Foundation`, or `receta`);
- nutrients per 100 g;
- density in g/cm³ and its provenance;
- review status and alerts.

The final table, `nutrition_wide_densidad.csv`, has **323 rows and 219 columns**. It includes metadata, energy, macronutrients, micronutrients, and density columns (`densidad_g_cm3`, `densidad_tipo`, `densidad_fuente`, `densidad_estado`, `densidad_estimada`, `densidad_motivo`). The file `food_names_es.csv` adds Spanish translations of the food names.

The table is used in two steps:

```text
gramos = volumen_cm3 × densidad_g_cm3
kcal   = gramos / 100 × kcal_100g
```

Macronutrients are computed using the same ratio. Volume comes from the depth module described in V.D; density and composition come from the mapping.

#### E.2 Construction and Review Process

The mapping was not generated automatically from start to finish. The process was:

1. **Candidate search** in USDA FoodData Central for each class.
2. **Initial proposal** of food item and nutrients using DeepSeek V4 Pro, cached to avoid repeated API calls.
3. **Manual review of all 323 rows**, organized into seven batches.
4. **Per-class decision**: `ok` (accept proposal), `cambiar` (use another `fdc_id`), or `receta` (compute from ingredients).
5. **Validation** of energy coherence, recipes, and a 20-class sample.

Manual review introduced **88 changes** relative to the initial draft. Every class has a final decision; none remain pending. Table 12 summarizes the match types.

**Table 12. USDA match types.**

| Match Type | Classes |
|---|---:|
| Exact (`exact`) | 183 |
| Manual (`manual`) | 73 |
| Close (`close`) | 41 |
| Recipe (`receta`) | 15 |
| Proxy (`proxy`) | 10 |
| Composite (`composite`) | 1 |
| **Total** | **323** |

USDA data sources are distributed across **172 SR Legacy entries**, **111 Survey (FNDDS)**, **25 Foundation**, and **15 recipes**. SR Legacy and FNDDS entries supply most nutrients; Foundation entries are newer, but in some cases report fewer micronutrients.

#### E.3 Nutrients and Recipes

Each row contains nutrients per 100 g. The primary fields are energy (`kcal_100g`), protein (`Protein (g)`), carbohydrates (`Carbohydrate, by difference (g)`), and fat (`Total lipid (fat) (g)`). The table also retains fiber, sugars, sodium, fatty acids, and a broad list of vitamins and minerals.

The **15 composite dishes** were computed using `recetas.csv`: each recipe lists ingredients with their `fdc_id` and grams per 100 g of prepared dish. Ingredient grams in each recipe sum to 100 g, and nutrients are obtained by weighted summation. Energy for each ingredient is taken from USDA; if an ingredient does not report a nutrient, that nutrient counts as zero. This is accurate for a nutrient absent in an oil, but may underestimate vitamins and minerals when data are genuinely missing.

#### E.4 Density: From Volume to Grams

Density is the link connecting apparent volume in the photograph to mass. The mapping applies the following priority order:

1. **USDA volume measure**: 203 classes. The weight of one cup or tablespoon is divided by its volume (cup = 236.6 cm³; tablespoon = 14.8 cm³; teaspoon = 4.9 cm³). Measures corresponding to a different physical form or falling out of range are discarded.
2. **Published tables**: 60 classes. Includes 33 entries from FAO/INFOODS and 23 from Table 4.2 of *Engineering Properties of Foods* (meats, fish, apple, pear, cheese), plus USDA AMS and other references.
3. **Geometric calculation**: 43 classes. No published density existed for the form in which the food is served; computed as `ρ = portion mass / solid volume` using typical dimensions. **These are not measurements** and carry an estimated uncertainty of ±15–20%.
4. **Recipe**: 15 classes. Computed as `ρ = 100 / Σ(gᵢ/ρᵢ)` from ingredient densities.
5. **Category reference**: 2 classes (whole egg and cream).

Table 13 summarizes the sources and confidence levels.

**Table 13. Density sources.**

| Source | Classes | Confidence |
|---|---:|---|
| USDA volume measure | 203 | high or medium |
| Published table (FAO, Table 4.2, USDA AMS, others) | 60 | medium |
| Geometric calculation | 43 | low |
| Recipe calculation | 15 | low |
| Category reference | 2 | medium |
| **Total** | **323** | |

Overall confidence is **173 high, 92 medium, and 58 low** densities. The 58 low-confidence entries correspond to the 43 geometric calculations and 15 recipes.

The density review also corrected keyword-matching misclassifications: `blueberries` had fallen under "blue cheese," `pineapple` under "nuts" due to *pine*, `potato_salad` under "leafy greens," `pasta_in_butterfly_form_farfalle` under "butter" due to *butterfly*, `quiche` under "cheese," and `salad_lambs_ear` under "lamb." All **168 changes** were audited in `densidad_cambios.csv`.

#### E.5 Real Mapping Examples

Table 14 shows three classes used in the test photograph that illustrate the three main density sources.

**Table 14. Example mapping rows.**

| Class | USDA | Match | kcal/100 g | Protein | Carbs | Fat | Density | Source |
|---|---|---|---:|---:|---:|---:|---:|---|
| `banana` (*plátano*) | Bananas, raw | exact | 89 | 1.09 g | 22.84 g | 0.33 g | 0.793 | USDA measure |
| `pork_n_s` (*cerdo*) | Pork, ground, 84% lean / 16% fat, cooked, pan-broiled | manual | 301 | 27.14 g | 0.00 g | 21.39 g | 0.812 | geometric calculation |
| `baked_potato` (*patata asada*) | Potatoes, baked, flesh and skin, without salt | exact | 93 | 2.50 g | 21.15 g | 0.13 g | 1.06 | published table (USDA AMS) |

{image: ejemplo_mapeo_tres_clases.png}

Applying the formula to the volumes measured in V.D: banana yields 97.9 × 0.793 = 77.6 g; pork yields 234.7 × 0.812 = 190.6 g; and potato yields 85.1 × 1.060 = 90.2 g. The differences relative to true weights were already discussed in V.D: pork is the closest estimate and banana is the most overestimated.

#### E.6 Quality Control

The mapping underwent four checks:

- **Energy coherence:** 316 of 323 classes satisfy `kcal ≈ 4·protein + 4·carbs + 9·fat` within a ±15% tolerance and fiber correction. The seven exceptions are alcoholic beverages (wine, beer, Aperol) and water; alcohol is excluded from the Atwater formula and water has 0 kcal.
- **Recipes:** all sum to 100 g.
- **Decisions:** all 323 classes have a final decision.
- **Manual verification:** 20 classes were reviewed; 18/20 were correct and two errors were fixed (`spring_roll_fried` → 172105 and `bread_grain` → 168013).

Nevertheless, **48 rows remain pending technical review**. They include 23 low-confidence rows, 15 recipes, 21 proxies or approximations, and 5 already explained coherence cases. The **43 geometric densities** remain calculations rather than measurements, and the **15 recipes** have an estimated typical portion.

{image: cobertura_calidad_mapeo.png}

#### E.7 Limitations

The mapping is complete, but it is not a clinical database. Its main limitations are:

- **Uneven micronutrient coverage:** some Foundation entries report between 11 and 58 nutrients; in roughly twenty classes, vitamins and minerals are missing.
- **Zero-filled recipes:** when an ingredient does not report a nutrient, zero is assigned; this can underestimate micronutrients.
- **Proxies:** classes without an exact USDA equivalent, such as `aperitif` or `halloumi`, use an approximation flagged in `revision_tecnica.csv`.
- **Apparent vs. solid density:** for piled foods, the photographed volume includes air; for compact pieces, it does not. The chosen density attempts to match the serving form, but is not always exact.
- **Idealized geometry:** the 43 geometric densities use typical shapes and dimensions; expected error is ±15–20%, sufficient for calorie estimation but not for precision weighing.
- **No TCAC:** the implementation relied on USDA FoodData Central. Integration with the Colombian TCAC table is not part of this version.
- **No external validation:** the 20-row check is an internal verification, not a validation by nutritionists.

#### E.8 What This Section Establishes

This section establishes that nutritional output is not hallucinated by the language model: it comes from a curated and reviewed table, with an explicit density and a traceable source per class. This separation allows changing a food's class in the app without repeating the volume measurement, auditing the origin of every nutrient, and distinguishing between a USDA measure, a published table, and a geometric calculation. The mapping covers all 323 classes and is sufficiently complete for the product, but must be presented with its uncertainties: 43 geometric densities, 48 rows pending review, and uneven micronutrient coverage.


---

### F. Reasoning Layer: Gemini

Gemini does not participate in perception or measurement. Its role is to interpret the structured output of the pipeline and convert it into concise advice. This separation is a core design decision of the project: the language model does not see the photograph, does not estimate volume, and does not recalculate calories; it receives a JSON object containing foods, grams, energy, and macronutrients, and explains what those figures imply.

{image: flujo_capa_razonamiento.png}

#### F.1 Role Within the Architecture

The actual flow is:

```text
photo → segmentation → classification → depth → volume
      → density → weight, kcal, and macros
      → structured JSON → Gemini → concise advice
```

Gemini is invoked **after** the pipeline has computed the plate. It receives neither the image nor the masks, and it has no access to the full nutritional table. It only receives the fields required for reasoning: food name, estimated grams, calories, protein, carbohydrates, and fat. Polygons, masks, volumes, and per-100 g values are excluded from the payload to reduce cost and prevent the model from attempting to recalculate what has already been measured.

The result is stored alongside the analysis and displayed on the results screen. If the user corrects a food item or its weight in grams, the advice is regenerated for the updated plate.

#### F.2 Input and Output

Table 15 summarizes the contract of the reasoning layer.

**Table 15. Input and output of the Gemini layer.**

| Element | Content |
|---|---|
| Input | JSON with `alimentos`: name, `peso_g`, calories, and macros |
| Output | Text of at most three sentences |
| Language | Spanish or English according to `Accept-Language`; any other language defaults to Spanish |
| Model | Gemini Flash Lite (`gemini-flash-lite-latest`) |
| Timeout | 10 s |
| Fallback | On failure, returns empty string and the analysis is preserved |
| Personalization | First name approximately 1 in 3 requests |

The payload does not include the image or polygons, nor does it include the user's full history or dietary goals. The advice refers solely to the current plate.

#### F.3 Prompt and Language

The prompt is applied as a *system instruction*. The Spanish version is:

```text
Eres un experto nutricional. Recibes un JSON con alimentos, sus gramos calculados y sus macronutrientes basados en datos del USDA. Tu objetivo es dar un consejo ultra-conciso (máximo 3 oraciones) sobre este plato. No recalcules las calorías, asume que los datos son exactos. Enfócate en el impacto metabólico (ej. picos de glucosa, saciedad, balance). Tono directo y amigable. Responde siempre en español y no repitas el JSON.
```

The English version is:

```text
You are a nutrition expert. You receive a JSON with foods, their estimated grams and their USDA-based macros. Give an ultra-concise tip (max 3 sentences) about this plate. Do not recalculate calories, assume the data is exact. Focus on the metabolic impact (e.g. glucose spikes, satiety, balance). Direct, friendly tone. Always answer in English and do not repeat the JSON.
```

When personalization is triggered, a single sentence is appended:

```text
Puedes dirigirte al usuario como {name} una sola vez, de forma natural; si no encaja, no lo menciones.
```

or, in English:

```text
You may address the user as {name} once, naturally; skip it if it does not fit.
```

The name is taken from the profile, trimmed to the first name, and passed in only about **35%** of requests. The goal is to prevent the assistant from repeating the user's name in every tip and sounding artificial.

{image: ejemplo_consejo_gemini.png}

#### F.4 Integration and Fault Tolerance

The call to Gemini is synchronous with a 10 s timeout. The model configured in `GEMINI_MODEL` is tried first, and on failure it falls back to `gemini-flash-lite-latest`. If neither responds, the function returns an empty string: the analysis is still saved and the UI does not block. On an edit, if Gemini fails, the previous advice is retained.

Because the model does not receive the image, cost and latency are low compared to visual inference. Most of the system's response time is spent on Modal, not on Gemini.

#### F.5 What Gemini Does and Does Not Do

**What it does:**

- Interprets the plate in metabolic terms: satiety, glucose spikes, macronutrient balance.
- Provides concise, readable advice for the user.
- Adapts language and, occasionally, includes the user's name.
- Explains the result without repeating the JSON.

**What it does not do:**

- Does not detect foods.
- Does not segment.
- Does not estimate volume or weight.
- Does not recalculate calories or macros.
- Does not replace a nutritionist.
- Does not use user history or goals in this version.

The last limitation is important: V5 proposed that Gemini would interpret user goals, history, and context. The current implementation is scoped strictly to the current plate and a three-sentence tip. This is a deliberate scope decision, not an implemented capability left unused.

#### F.6 Limitations and Evaluation

No quantitative evaluation of advice quality was performed. There is no reference answer set or user study; validation is functional: the advice is generated, saved, displayed, and regenerated when the plate is edited. Text quality is subjective and depends on the model and prompt.

Other limitations:

- The advice is informational and non-medical; it has no knowledge of allergies, pathologies, or clinical goals.
- It does not use history, so it cannot tell if the user already ate the same meal earlier that day.
- Name personalization is probabilistic; at times the advice is not personalized.
- If Gemini fails, the user may receive no advice, although the nutritional analysis remains available.

#### F.7 What This Section Establishes

This section establishes that Gemini is a **thin interpretation layer**, not the core engine of the system. Its value lies in explaining an already-measured result rather than producing the measurement. This separation allows auditing weight and calories independently of language generation, swapping the language model without touching the pipeline, and keeping the application operational even when Gemini is unavailable.


---

### G. Web Application and Deployment

The web application is the layer that turns the pipeline into a usable product. It allows users to authenticate, capture or upload a photograph, trigger analysis, review results, correct food items, and browse history. The system is deployed and operates end-to-end on managed services.

{image: arquitectura_despliegue.png}

#### G.1 Functional Flow

The main workflow is:

1. The user signs in with Google.
2. Captures a photo with the camera or uploads an image from the gallery.
3. The frontend requests a presigned URL and uploads the image directly to Cloudflare R2.
4. Django receives the image reference and calls the Modal endpoint with the selected pipeline.
5. Modal executes segmentation, classification, depth, volume, and nutrition lookup.
6. Django receives the JSON, requests advice from Gemini, and persists the `FoodLog`.
7. The frontend displays the result, masks, weight, calories, and macros.
8. The user may correct the class, grams, or plate diameter, or delete the analysis.

#### G.2 Frontend

The frontend is implemented in Angular and deployed on Vercel. Its main features are:

- **Google authentication** and JWT token management.
- **Guided capture** using `getUserMedia` and `DeviceOrientationEvent`.
- **Camera level**: the ring and shutter button turn green when tilt is approximately perpendicular to the table; if held steady, a countdown triggers capture.
- **FOV adjustment** and reading of 35 mm equivalent focal length when available.
- **Visual result** with overlaid SVG masks, per-region labels, and nutritional breakdown.
- **Gallery history** with horizontal scrolling, thumbnails, and preloading of the next analysis.
- **Editing** of food class, grams, and plate diameter.
- **Deletion** of the analysis and associated image, with two-step confirmation.
- **Date and time** in the device's local time zone.
- **Profile, theme, and settings**.
- **A/B pipeline selector** for administrators, stored only on the device.

Guided capture is an aid rather than a strict requirement: if the browser does not expose orientation APIs, the app still works with standard capture. The non-overhead photo warning is also computed a posteriori from the supporting plane normal.

#### G.3 Backend and API

The backend is a Django REST API deployed on Render. It acts as orchestrator and security boundary: the frontend never receives Modal, R2, or Gemini keys. Table 16 summarizes the main endpoints.

**Table 16. Main API endpoints.**

| Method | Route | Function |
|---|---|---|
| POST | `/api/auth/google/` | Exchanges Google ID token for JWT |
| POST | `/api/auth/refresh/` | Refreshes access token |
| GET / PATCH | `/api/me/` | User profile and name editing |
| POST | `/api/uploads/presign/` | Presigned URL for uploading to R2 |
| GET / POST | `/api/food-logs/` | History and creation of an analysis |
| GET / PATCH / DELETE | `/api/food-logs/<id>/` | Detail, correction, and deletion |
| GET | `/api/foods/?q=` | Search across the 323 classes |

Creating a `FoodLog` downloads the image from R2, calls Modal, and, if foods are detected, requests advice from Gemini. The detail endpoint returns each food with its volume, weight, density, calories, and macros. Corrections are applied server-side: changing the class recalculates weight using the new density; changing grams adjusts volume; changing the plate diameter rescales the entire analysis by the cube of the diameter without reprocessing the photo. Analyses with manually set grams are left untouched when the diameter changes.

The API always filters by `usuario=request.user`; a user cannot read or modify another user's analyses. The image key is also validated against the user's prefix.

#### G.4 Inference Service

Inference runs on Modal on an A10G GPU. The service loads the segmentation, classification, and depth models along with the nutritional table, and exposes an endpoint protected by the shared secret `X-Modal-Secret`. The frontend cannot call it directly.

The service receives the image and inference parameters (`pipeline`, `depth_model`, `fov_deg`, `f35_mm`) and returns the JSON containing foods, volumes, weights, calories, macros, polygons, centroids, and warnings. The backend timeout is 90 s. The first analysis after an idle period may take longer due to *cold start*; afterward, the instance stays warm for a few minutes.

#### G.5 Deployment and Operations

Table 17 summarizes the key operational parameters.

**Table 17. Operational limits and parameters.**

| Parameter | Value |
|---|---|
| Input image maximum longer side | 1,024 px |
| Maximum upload size | 10 MB |
| Accepted formats | JPEG, PNG, WebP |
| Upload URL expiration | 300 s |
| Read URL expiration | 1 h |
| Image retention in R2 | 72 h |
| `FoodLog` retention | 30 days |
| Modal timeout | 90 s |
| Gemini timeout | 10 s |
| Supported plate diameter | 15–40 cm |
| Supported FOV | 10–170° |

Deployment is distributed as follows:

- **Vercel:** Angular frontend and `caloriescounter.app` domain.
- **Render:** Django API and health check.
- **Modal:** GPU inference and models.
- **Neon:** PostgreSQL for users and analyses.
- **Cloudflare R2:** images via presigned URLs.

#### G.6 Security and Privacy

- **Authentication:** Google OAuth and JWT; access tokens last 1 h and refresh tokens 14 days.
- **Isolation:** all analysis queries are filtered by user.
- **Direct upload:** the frontend uploads to R2 via a presigned URL; the backend never receives the binary file.
- **Private bucket:** images are read via 1 h presigned URLs.
- **Modal:** the endpoint requires `X-Modal-Secret`; it is not public.
- **Secrets:** Modal, R2, and Gemini keys live on the backend, never on the frontend.
- **Retention:** images are deleted after 72 h and analyses after 30 days; manual deletion also removes the image from R2.

#### G.7 Application Limitations

- Modal *cold start* can lengthen the first analysis.
- The app depends on camera and browser support; orientation APIs are not available on all devices.
- There is no offline mode or native mobile application.
- History is not used to personalize Gemini advice; advice is limited to the current plate.
- If Gemini fails, the analysis is saved, though advice may remain empty.
- Images expire after 72 h; older analyses can still be opened, but without the photo.
- Pipeline B and Depth Anything V2 Small are the defaults; the admin menu allows toggling both the perception pipeline (A/B) and the depth predictor (Small vs. Large), saving options on-device for comparative testing.

#### G.8 What This Section Establishes

This section establishes that the project is not merely an experimental notebook: it is a deployed application with authentication, guided capture, GPU inference, private storage, history, and result editing. The architecture cleanly separates frontend, API, inference, and storage, enabling a model or provider to be swapped without rewriting the app. Operational limitations—cold start, retention, browser dependence, and advice scope—are stated explicitly so the functional prototype is not mistaken for a clinical product.


---

### H. Validation and Generated Artifacts

Project validation combines quantitative evidence, unit checks, functional app validation, and reproducible artifacts. It is neither a clinical validation nor a user study: it is the evidence required to support that the pipeline works, comparisons are traceable, and results can be reproduced.

#### H.1 Experiments and Notebooks

Experimentation is organized into three families and two supporting notebooks:

- **Family A (class-agnostic segmentation):** A1, A2, and A4.
- **Family B (class-aware segmentation):** B1, B2, and B4.
- **Family C (crop classification):** C1, C2, and C3.
- **Notebook 00:** dataset preparation, v2.0 → v2.1 mapping, splits, and classifier crops.
- **Notebook 99:** comparison, audit, and profiles.

There are **nine canonical experiments**. The notebook `B1_yolo26_clases v4.ipynb` is kept as an earlier trial; the canonical version is `B1_yolo26m_classes.ipynb`. All nine test results are present and used in the comparison.

#### H.2 Comparison Notebook

The notebook `99_results_comparison.ipynb` is the backbone of the comparative evidence. It contains:

1. **Inventory and coverage** of available results.
2. **Audit 1.1** of runs, notebooks, and test JSONs.
3. **Class-agnostic segmentation models** (Family A, plus Family B in agnostic mode).
4. **Class-aware segmentation models** (Family B) and class accuracy.
5. **Classifiers** (Family C), intervals, and paired comparison.
6. **Lightweight and robust profiles**, with components A, C, and B analyzed separately.
7. **Summary and export**, plus the optional P1 pipelines section.

The notebook generates `resumen.csv`, `resumen.xlsx`, `resumen.json`, `segmentadores_agnostico.csv`, `segmentadores_clases.csv`, `clasificadores.csv`, `clasificadores_pareado.csv`, `perfiles_piezas.csv`, `perfiles_resumen.csv`, `perfiles_delta.csv`, and bar/efficiency figures. It also produces `auditoria_runs.csv` cross-referencing weights, epochs, `DONE.json`, notebook, and result.

{image: cuaderno_comparacion_resumen.png}

Two gaps remain visible in this comparison: the end-to-end P1 pipeline (A+C) was not built—profile comparison is component-wise—and B4 did not save `matched_cls`, so class accuracy on matched instances is only available for B1 and B2.

#### H.3 Visual Resources

Visual resources are stored in `presentación/tests/Recursos_visuales/`. They were generated using the actual pipeline and actual nutritional table, not fabricated data:

- `01_flujo_pipeline.png`: the seven steps of the pipeline.
- `02_mapa_profundidad.png`: photo, masks, monocular depth, corrected depth, and height above the table.
- `03_volumen_3d.png`: 3D surface and per-food volume.
- `04_resultado_plato.png`: result overlaid on the photo with weight, kcal, and macros.
- `05_pesos_vs_reales.png`: estimated weight versus true weight.
- `06_deteccion_vs_correccion.png`: detection versus class correction.
- `07_mapeo_flujo.png`, `08_mapeo_cobertura.png`, and `09_mapeo_ejemplo.png`: construction, coverage, and examples of the nutritional mapping.

The folder includes an `index.html` gallery, a `README.md`, supporting JSON/CSV/NPZ files, and the scripts `generar_recursos.py`, `generar_datos.py`, `generar_figuras.py`, and `generar_mapeo.py`.

{image: galeria_recursos_visuales.png}

#### H.4 Testing and Functional Validation

Technical validation includes:

- **Unit tests for volume and nutrition calculations** in `ml/tests/test_core.py`.
- **Functional app validation**: login, upload, inference, result display, history, editing food/grams/diameter, and deletion.
- **Deployment verification**: frontend on Vercel, API on Render with health check, Modal available, and R2 accessible.
- **Result audit**: all nine test JSONs are present and Notebook 99 reads them without broken files.

There is no formal UI test suite or usability study. Functional validation is manual and relies on the deployed app.

#### H.5 What the Evidence Demonstrates

Table 18 summarizes the relationship between evidence and the conclusions it supports.

**Table 18. Evidence and conclusions.**

| Evidence | What It Demonstrates |
|---|---|
| AP50/AR100 of A1, A2, A4, B1, B2, B4 | A4 achieves the best mask; YOLO is lighter and faster; the gap between class-aware and agnostic separates mask error from class error |
| Top-1, top-5, and macro-F1 of C1, C2, C3 | C2 offers the best cost/accuracy ratio; C3 only marginally improves macro-F1 at 9× parameters |
| Lightweight and robust profiles | A+C yields better masks; B offers a cheaper integrated solution; the quality leap is in segmentation |
| Depth and volume on the test photo | Plate scaling corrects depth; pork is within +17%; detected total is 351.3 g vs. 302 g true |
| Nutritional mapping | 323/323 classes with density; 316/323 energy-coherent; 18/20 in manual check |
| Deployed app | The photo → inference → result → history → correction flow works end-to-end |

Table 19 lists the main artifacts.

**Table 19. Validation and reproducibility artifacts.**

| Artifact | Location |
|---|---|
| Experiment notebooks | `presentación/cuadernillos/` |
| Comparison notebook | `presentación/99_results_comparison.ipynb` |
| Test results | `presentación/calorie_counter/resultados/*.json` |
| Comparative tables and figures | `presentación/calorie_counter/comparacion/` |
| Visual resources | `presentación/tests/Recursos_visuales/` |
| Nutritional mapping | `presentación/README_mapeo nutricional.md` and `ml/data/nutrition_wide_densidad.csv` |
| Volume/nutrition tests | `ml/tests/test_core.py` |

#### H.6 Validation Limitations

The evidence is sufficient for a functional prototype, but not for clinical validation. The main limitations are:

- Depth and volume validation relies on **a single photograph** with known weights; it is not a benchmark.
- There is no user study or usability evaluation.
- No controlled comparison was performed against InceptionV3, Mask R-CNN, or MiDaS.
- The test set is internal (10% of train), not the official AIcrowd test set.
- B4 did not save `matched_cls`.
- The P1 pipeline was not built; profile comparison is component-wise.
- **48 rows** of the mapping remain pending technical review and **43 geometric densities** carry ±15–20% uncertainty.
- A4/B4 and A1/A2 use different resolutions, so latencies are not directly comparable.

#### H.7 What This Section Establishes

This section establishes that the project does not merely produce isolated metrics: it delivers a reproducible set of notebooks, results, tables, figures, tests, and visual resources. The comparison justifies why each model was chosen and what is traded off when selecting the lightweight or robust profile. It also makes the gaps explicit—P1, B4's `matched_cls`, technical review of the mapping, and validation on additional scenes—so progress is read as a functional system with known limits rather than a closed claim.


---

### I. Changes Relative to the Initial Proposal

The implementation preserves the modular philosophy of V5, but does not literally reproduce the architectures proposed in that document. The most important change is not a model swap, but **ordering**: V5 describes classification first and segmentation second; the actual system segments first and classifies each crop. The remaining changes replace three perception components with more recent alternatives and narrow Gemini's scope. This section documents those differences and avoids presenting them as unproven improvements.

{image: propuesta_vs_implementacion.png}

#### I.1 Correction of Pipeline Order

V5 presents perception as "classification (InceptionV3) and segmentation (Mask R-CNN)," suggesting full-image classification followed by segmentation. The Option B implementation does the opposite:

1. Mask2Former proposes masks for all instances.
2. Each mask is cropped.
3. Inception-V4 classifies each crop.
4. Class and mask are combined into a `Segment`.

This ordering has three practical advantages. First, the classifier receives an isolated region rather than the entire plate with background, other foods, and garnish. Second, it avoids assigning a single class to an image containing multiple foods. Third, it produces the masks needed by the volume module. In Option A, YOLO26-seg performs segmentation and classification jointly, yet preserves the same logic: instance first, class second.

{image: orden_pipeline_corregido.png}

#### I.2 Model Substitutions

Table 20 summarizes the changes between the V5 proposal and the implementation.

**Table 20. Initial proposal vs. implementation.**

| Component | V5 Proposal | Implementation | Reason for Change | Evidence |
|---|---|---|---|---|
| Pipeline order | Classify then segment | Segment then classify each crop (B); joint in A | Classifier receives an isolated region; mask feeds volume | V.C |
| Classification | InceptionV3 | Inception-V4, MobileNetV3, and custom CNN | Three cost/accuracy alternatives; availability in `timm` | C1–C3 |
| Segmentation | Mask R-CNN | Mask2Former Swin-tiny and YOLO26-seg | Instance segmentation; agnostic and class-aware versions; lightweight profile | A1/A2/A4/B1/B2/B4 |
| Depth | MiDaS | Depth Anything V2 Metric Indoor Small | Metric output in meters; indoor scenes; production cost | V.D |
| Volume | Mask + depth | Pinhole + RANSAC plane + plate scaling | Physical reference and close-up bias correction | V.D |
| Nutrition | TCAC/USDA | USDA FoodData Central + density | 323 classes, 219 columns, and per-class density | V.E |
| LLM | Gemini with goals and history | Gemini Flash Lite, current plate only | Product scope; concise and traceable advice | V.F |
| Application | Conceptual architecture | Angular + Django REST + Modal + Neon + R2 | End-to-end deployed product | V.G |

The substitutions were not made to "beat" the V5 architectures. They were made because the system needed metric output, instance masks, a lightweight profile, and a viable deployment. No controlled benchmark was run comparing Inception-V4 against InceptionV3, Mask2Former against Mask R-CNN, or Depth Anything V2 against MiDaS. Therefore, the accurate phrasing is **"was updated,"** not **"was shown to be better."**

{image: sustituciones_modelos.png}

#### I.3 Scope Changes in Gemini

V5 proposed that Gemini would interpret user goals, history, and context. The current implementation is limited to a three-sentence tip about the current plate. It does not use history, does not know dietary goals, and does not receive the image. This is a deliberate scope reduction to keep the advice concise, low-cost, and auditable. The architecture leaves room to expand it, but that expansion is not part of this version.

#### I.4 What Remains Unchanged

Despite the changes, the conceptual architecture remains intact:

- The four-stage separation: perception, depth/volume, nutritional mapping, and reasoning.
- The principle that the LLM does not compute calories or volume.
- The use of a structured JSON object as the contract between measurement and language.
- The web application as the final product, not merely a demonstration.
- The separation between class-agnostic segmentation and classification, even though the ordering was corrected.

#### I.5 What Would Be Required to Claim an Improvement

Turning these changes into a rigorous experimental comparison would require:

| Claim | Required Baseline | Status |
|---|---|---|
| Inception-V4 is better than InceptionV3 | Same splits, resolution, and training budget | Not performed |
| Mask2Former is better than Mask R-CNN | Same splits, backbone, and resolution | Not performed |
| Depth Anything V2 is better than MiDaS | Same scenes and metric scaling protocol | Not performed |
| USDA is better than TCAC | Same classes and nutritional coverage | Not performed; coverage differs |
| A+C is better than B | End-to-end P1 on the same images | Not built; comparison is component-wise |

These comparisons are future work, not results of this version. Table 20 should be read as a table of engineering decisions, not as a table of superiority.

#### I.6 Implications for the Document

Section IV of V5 should be updated so that the proposed and implemented architectures do not contradict each other. Specifically:

- The order must be **segment → classify**, not the reverse.
- The architectures should be updated to Inception-V4, Mask2Former/YOLO26-seg, and Depth Anything V2.
- It should be explained that MiDaS was not discarded for being inferior, but because its output is not metric.
- It should be clarified that comparisons against the original architectures are not experimental.

This Section V.I fulfills that role: it documents the change, justifies it, and prevents the reader from interpreting the progress as a literal implementation of V5.

#### I.7 What This Section Establishes

This section establishes that the project evolved from its initial design, but did so explicitly and defensibly. The segment → classify order is a necessary correction; the model substitutions are engineering decisions; narrowing Gemini's scope is a product decision. None of this is presented as a proven improvement over InceptionV3, Mask R-CNN, or MiDaS, because those comparisons were not conducted. The value of the progress lies in the complete system, not in any alleged isolated superiority of individual models.


---

### J. Limitations and Remaining Work

The system operates end-to-end, but its results must be interpreted within a specific scope. This section separates technical, methodological, and product limitations, and concludes with a prioritized list of remaining work. The intent is not to weaken the progress, but to delineate what can be claimed and what remains open.

{image: mapa_limitaciones_pipeline.png}

#### J.1 Technical Limitations

**Depth and volume**

- Monocular depth has scale ambiguity. Depth Anything V2 is metric, yet in close-ups it still requires the plate as a reference.
- If the plate is not detected, the pipeline falls back to a typical distance or leaves raw depth; volume may deviate.
- Volume is **apparent**: it does not reconstruct hidden faces, internal cavities, or occluded food items.
- A poorly fitted table plane can yield unrealistic volumes. Sanity caps prevent extreme cases, but do not replace a physical measurement.
- Initial depth and volume validation relied on a single photograph with known weights; it is not a benchmark.

**Perception**

- Class imbalance is severe: 215 classes have fewer than five annotations in validation and 28 are absent. Per-class metrics with few instances are noisy.
- The test photograph exhibits real misclassifications: banana is detected as chicken and potato as caprese salad. The app allows correcting them, but correction depends on the user.
- B4 did not save `matched_cls`; fine-grained class comparison on matched instances is only available for B1 and B2.
- Resolutions are not uniform: A4/B4 use 640/224 px and A1/B1 use 640 px versus A2/B2 at 224 px. Latencies are not directly comparable.
- Ground-truth masks are the original polygons, which are coarse. AP75 and AP may penalize a visually accurate contour simply because it does not match the polygon.

**Nutrition**

- 43 classes use calculated geometric densities rather than measurements, with an estimated uncertainty of ±15–20%.
- 48 rows remain pending technical review.
- Some Foundation entries report few micronutrients; in roughly twenty classes, vitamins and minerals are missing.
- Recipes assign zero when an ingredient does not report a nutrient; this can underestimate micronutrients.
- Proxies are used for classes without an exact USDA equivalent.
- The Colombian TCAC table was not integrated; the primary source is USDA FoodData Central.

**Pipeline and product**

- The end-to-end P1 pipeline (A+C) was not built. Profile comparison is component-wise rather than a complete pipeline.
- The app depends on camera and browser support; orientation APIs are not available on all devices.
- There is no offline mode or native application.
- Modal *cold start* can lengthen the first analysis.
- Images are retained for 72 h and analyses for 30 days; older analyses open without the photo.
- Gemini does not use history or goals; advice is limited to the current plate.

#### J.2 Methodological Limitations

- The test set is internal: 10% of train was held out rather than using the official AIcrowd test set. External validity is bounded to the defined protocol.
- In the reviewed run, `run_duplicate_check=False`; near-duplicates between train and test were not checked.
- No controlled comparison was performed against InceptionV3, Mask R-CNN, or MiDaS. Substitutions are engineering decisions, not proven improvements.
- There is no user study or formal usability evaluation.
- There is no clinical or nutritional validation with specialists; the system is not a medical device.
- Profile comparison is not an end-to-end P1 pipeline; it does not measure the true cost of combining A and C on predicted masks.
- The initial single-scene depth and volume validation was superseded by the multi-dish quantitative evaluation on the Nutrition5k benchmark (Notebook D1), achieving a MAPE of 5.84% (calibrated Large) and 10.58% (calibrated Small) against a digital scale.

#### J.3 Impact and Mitigation

Table 21 maps each limitation to its impact and current or pending mitigation.

**Table 21. Limitations, impact, and mitigation.**

| Limitation | Impact | Current Mitigation | Remaining Work |
|---|---|---|---|
| Depth scale ambiguity | Error in cm³ and therefore in grams | 26 cm plate, fallback, and sanity caps | Validate across more scenes and cameras |
| Class confusion | Incorrect density and skewed weight | Manual correction in the app | Improve classifier and review rare classes |
| Geometric densities | ±15–20% error in 43 classes | Flagged as calculation, not measurement | Measure a real portion and replace the value |
| 48 rows without technical review | Risk of suboptimal nutrients or densities | Documented review queue | Complete review with a specialist |
| B4 missing `matched_cls` | Incomplete class comparison | B1 and B2 are reported | Recompute B4 |
| P1 not built | Cannot claim A+C outperforms B | Component-wise comparison | Build P1 and evaluate on the same images |
| Internal test set without duplicate check | Limited external validity | Fixed, stratified split | Run near-duplicate check and, if possible, official test |
| No user study | True usability is unknown | Manual functional validation | User study |
| No clinical validation | Not a medical device | Informational language and disclaimers | Validation with nutritionists |

{image: prioridades_trabajo_futuro.png}

#### J.4 Prioritized Remaining Work

Table 22 orders the remaining work by priority.

**Table 22. Remaining work.**

| Priority | Task | Rationale |
|---|---|---|
| P0 | Recompute `matched_cls` for B4 | Closes the class comparison for Family B |
| P0 | Build and evaluate P1 (end-to-end A+C) | Central comparison between Proposal 1 and Proposal 2 |
| P0 | Complete technical review of the 48 rows | Reduces nutritional risk of the product |
| P1 | Validate depth/volume across more scenes | Turns a proof of concept into a formal evaluation |
| P1 | Measure or validate the 43 geometric densities | Reduces error on classes with calculated density |
| P1 | Benchmark against InceptionV3, Mask R-CNN, and MiDaS | Enables claiming improvements, not just changes |
| P2 | Usability study and nutritional validation | Evaluates the product, not just the model |
| P2 | Improve cold start and mobile experience | Reduces usage friction |
| P2 | Publish reproducible artifacts | Facilitates review and replication |

#### J.5 What This Section Establishes

This section establishes that the limitations are known, bounded, and traceable. The system is not presented as a measuring instrument or a clinical device; it is presented as a functional prototype with an auditable pipeline, a deployed app, and a concrete list of improvements. Limitations do not invalidate the progress: they define its scope and chart the path toward making it a more reliable product.


---

### K. Progress Conclusion

The project progressed from a state-of-the-art review and conceptual architecture to a deployed system that analyzes a plate photograph, estimates volume and weight, queries a nutritional table, and returns concise advice. The progress is not a literal implementation of V5: it is a modular implementation that preserves its philosophy, corrects the pipeline ordering, and updates perception components through documented engineering decisions.

{image: resumen_visual_avance.png}

#### K.1 Summary of What Was Built

The final architecture maintains four separated responsibilities:

1. **Perception:** segment first and classify afterward, using Mask2Former/YOLO26-seg and a family of classifiers.
2. **Geometry:** metric depth with Depth Anything V2, plate-based scaling, RANSAC plane fitting, and apparent volume.
3. **Nutrition:** mapping of 323 classes to USDA FoodData Central, with density and composition per 100 g.
4. **Reasoning:** Gemini as a thin layer that interprets the structured JSON without recalculating measurements.

The Angular app, Django API, Modal inference service, Neon database, and R2 storage complete the system. It is not just an experimental notebook: it is a functional product with authentication, guided capture, history, result correction, and deletion.

#### K.2 Key Findings

Table 23 summarizes the contributions and the supporting evidence.

**Table 23. Contributions and evidence.**

| Contribution | Evidence | Status |
|---|---|---|
| End-to-end system | Deployed app, V.G and V.H | Functional |
| Segment → classify ordering | V.C; nine experiments | Implemented |
| Metric depth and volume | V.D; test photo | Validated on one scene |
| 323-class nutritional mapping | V.E; 323/323 with density | Complete, review pending |
| Gemini as reasoning layer | V.F; prompt and fallback | Implemented, limited scope |
| Profile comparison | V.C and V.H; Notebook 99 | Complete; P1 pending |

The results support three takeaways. First, **A4 is the best option when mask quality is prioritized**, and **B4 is the best when a single cheap integrated model is prioritized**. Second, **C2 offers the best cost/accuracy ratio**, whereas C3 only marginally improves macro-F1 with nine times as many parameters. Third, the robust profile improves A's AP50 by **+0.102** and AR100 by **+0.192** over the lightweight profile, but adds **+81.3 M** parameters and **+115.2 ms** to the A+C pair; the quality leap comes from segmentation, not the classifier.

On the test photograph, monocular depth drops from a median of **1.58 m** to **≈0.30 m** after plate scaling. Pork lands at **190.6 g** versus **163 g** true (**+17%**), and the detected total is **351.3 g** versus **302 g** true. Banana and potato are misclassified, but the app allows correcting them without repeating the measurement: the corrected total becomes **358.4 g**.

The nutritional mapping covers **323/323 classes** with density, **316/323** with energy coherence, and **18/20** in manual verification. Its limits—43 geometric densities, 48 pending rows, and uneven micronutrient coverage—remain explicit.

{image: contribuciones_principales.png}

#### K.3 What the Progress Contributes

The value of this work does not lie in an isolated model, but in **auditable integration**:

- Separates geometric measurement from language, so weight and calories do not depend on an LLM.
- Uses the plate as a physical reference to correct monocular depth ambiguity.
- Allows changing a food's class without recomputing volume.
- Delivers an empirical comparison within the implementation, complete with metrics, profiles, and reproducible artifacts.
- Documents differences from V5 and avoids claiming unproven improvements.

#### K.4 Scope and Limits

The system is a **functional prototype**, not a measuring instrument or a clinical device. Open items include end-to-end P1, B4's `matched_cls`, review of 48 mapping rows, measurement of 43 geometric densities, controlled comparisons against InceptionV3/Mask R-CNN/MiDaS, and validation with more scenes and users. Section V.J details each item and prioritizes the work.

#### K.5 Closing

The progress can be summarized as follows: the project now has a complete pipeline, a deployed app, a reproducible comparison, and a suite of resources explaining how results are obtained. It does not claim to have solved perfect portion estimation; it claims to have built a modular, measurable system that is honest about what it can and cannot assert. That is the step separating a state-of-the-art proposal from an engineering prototype.


---

### L. Publishing Artifacts on GitHub

Publishing artifacts is part of reproducibility, yet not everything used can be made public. The repository must allow another person to understand the pipeline, run the notebooks, and reproduce the tables without exposing weights, secrets, personal images, or data whose license prohibits redistribution.

#### L.1 Publication Criteria

An artifact is published if it meets four conditions:

1. **It is small** and does not require Git LFS for the normal workflow.
2. **It is reproducible** without relying on private files.
3. **It contains no secrets** or personal data.
4. **Its license permits redistribution**, or only a reference is published.

Table 24 summarizes the decision by artifact type.

**Table 24. Artifacts: what to publish and what not to publish.**

| Artifact | Publish? | Condition |
|---|---|---|
| Experiment notebooks | Yes | Strip heavy outputs; exclude private paths |
| Comparison Notebook 99 | Yes | Keep or strip outputs; exclude secrets |
| CSVs and figures in `comparacion/` | Yes | Small and reproducible |
| Visual resources (PNG, HTML, README) | Yes | Verify license of the test photo |
| Nutritional mapping README | Yes | Cite USDA, FAO/INFOODS, and Table 4.2 |
| `nutrition_wide_densidad.csv` | Yes | Attribute to USDA; do not relicense as own data |
| `crops_{train,val,test}.csv` | Optional | Metadata only; check paths and personal data |
| `datos_visuales.npz` | Optional | Contains the test photo; publish only with consent |
| Weights `.pt` / `.pth` / `.onnx` | No | Stored in Modal Volume or Drive |
| Dataset images and annotations | No | Depends on Food Recognition 2022 license |
| User photos | No | Privacy |
| `.env`, keys, secrets | No | Security |
| Entire `presentación/` | No | 5.8 GB including weights and runs |

#### L.2 What to Publish

The minimum recommended publication includes:

- `00_data_preparation.ipynb` and the nine canonical notebooks.
- `99_results_comparison.ipynb`.
- CSVs and figures in `presentacion/calorie_counter/comparacion/`.
- All of `presentacion/tests/Recursos_visuales/`, excluding the photo if consent is lacking.
- `presentacion/README_mapeo nutricional.md`.
- `ml/data/nutrition_wide_densidad.csv` and `ml/data/food_names_es.csv`.
- Figure-generation and comparison scripts.
- `ml/tests/test_core.py`.

Notebooks must preserve execution order and instructions for placing weights. If outputs are stripped, a `README` with expected results and screenshots of the main tables should be included.

#### L.3 What Not to Publish

- **Weights:** `.pt`, `.pth`, `.onnx`, `.safetensors`. Already in `.gitignore`; loaded from Modal or Drive.
- **Secrets:** `.env`, `MODAL_SHARED_SECRET`, R2 keys, `GEMINI_API_KEY`, `USDA_API_KEY`.
- **Original dataset:** images and annotations from Food Recognition 2022 if its license prohibits redistribution; link the source and explain how to download it.
- **Personal photos:** `34g_platano_163cerdo_105papa.jpg` is a photo taken by the author; publishing it requires consent or replacing it with a licensed image.
- **Runs and predictions:** `runs/`, `predicciones/`, `predicciones_pilot/`, and large prediction JSONs can weigh hundreds of MB; they are unnecessary to reproduce the tables.
- **The entire `presentación/` tree:** includes weights, runs, and local data.

#### L.4 Recommended Organization

Rather than publishing `presentación/` as-is, a `research/` or `docs/` folder with this structure is recommended:

```text
research/
├── README.md
├── notebooks/
│   ├── 00_data_preparation.ipynb
│   ├── A1_...ipynb
│   ├── ...
│   └── 99_results_comparison.ipynb
├── comparison/
│   ├── resumen.csv
│   ├── perfiles_resumen.csv
│   └── figures...
├── visual_resources/
│   ├── index.html
│   ├── 01_...png
│   └── ...
├── nutrition_mapping/
│   ├── README_mapeo nutricional.md
│   └── nutrition_wide_densidad.csv
└── scripts/
    ├── generar_recursos.py
    └── generar_mapeo.py
```

Recommendations:

- Strip notebook outputs with `nbstripout` or export to HTML if visual evidence is to be preserved.
- If large outputs are needed, use Git LFS, but not for weights.
- Update `.gitignore` to exclude `presentación/calorie_counter/runs/`, `predicciones/`, `predicciones_pilot/`, and `*.pt`.
- Avoid absolute Colab or Drive paths in published notebooks.

{image: estructura_repositorio_publico.png}

#### L.5 Licenses and Attribution

- **Code:** choose a permissive license, such as MIT or Apache-2.0.
- **Documentation and figures:** CC BY 4.0 may be used, indicating authorship.
- **USDA FoodData Central:** public domain; cite the source and access date.
- **FAO/INFOODS and Table 4.2:** cite the source in the mapping README.
- **Food Recognition 2022:** respect the dataset's terms; do not relicense its images as your own.
- **Test photo:** obtain consent or replace with an explicitly licensed image.

Neither the original dataset nor the USDA table should be relicensed as proprietary data. The repository license covers the code and documentation, not third-party data.

#### L.6 Reproducibility

The repository `README` should explain:

1. Dependencies for `ml`, `backend`, and `frontend`.
2. Where to place weights (`MODELS_DIR` or Modal Volume).
3. Execution order: `00_datos` → A/B/C notebooks → `99_comparacion` → `generar_recursos.py`.
4. How to regenerate figures without a GPU.
5. What results are expected and where they are saved.
6. Which artifacts are excluded and why.

#### L.7 Pre-Publication Checklist

- [ ] No `.env`, keys, or secrets in history.
- [ ] No personal photos without consent.
- [ ] Weights are excluded.
- [ ] Notebooks contain no private paths.
- [ ] Code and documentation licenses are clear.
- [ ] USDA, FAO/INFOODS, and Table 4.2 are cited.
- [ ] The `README` explains the execution order.
- [ ] Figures and tables regenerate with the scripts.
- [ ] Repository size remains reasonable for GitHub.
- [ ] Third-party data are not relicensed.

{image: checklist_publicacion.png}

#### L.8 What This Section Establishes

This section establishes that reproducibility does not mean uploading everything, but publishing what is necessary under the right conditions. Notebooks, comparison outputs, visual resources, and the mapping can be public; weights, secrets, personal photos, and restrictively licensed datasets cannot. With this separation, the repository remains useful for review and replication without compromising privacy, security, or licensing.


---

## Proposed Work Order

1. **V.A** — Overview and stack.
2. **V.B** — Data and preprocessing.
3. **V.C** — Visual perception and correction of the segment → classify order.
4. **V.D** — Depth, plate scaling, and justification for Depth Anything V2.
5. **V.E** — Nutritional mapping.
6. **V.F** — Gemini.
7. **V.G** — Application and deployment.
8. **V.H** — Validation and resources.
9. **V.I** — Changes relative to the proposal.
10. **V.J** — Limitations and remaining work.
11. **V.K** — Conclusion.
12. **V.L** — Publishing on GitHub.

V.A–V.L are now in English and ready to be incorporated into `InvestigaciónV5.docx`.
