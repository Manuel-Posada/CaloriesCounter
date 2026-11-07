# Sección V — Implementación y avance

**Documento base:** `presentación/InvestigaciónV5.docx`
**Estado:** borrador de trabajo para completar subsección por subsección.
**Fecha:** noviembre de 2026.
**Idioma:** V.A en inglés; V.B–V.L en español (pendiente de traducción).

> **Nota de trabajo.** Según la actualización del autor, los 10 entrenamientos están completos y el cuaderno 99 ya recoge la comparación. Este borrador parte de ese estado. Las cifras se revisarán al cerrar cada subsección.
>
> **Correcciones importantes respecto al V5:**
> - El pipeline real **no clasifica primero y segmenta después**. En la Opción B, primero segmenta (Mask2Former agnóstico) y luego clasifica cada recorte (Inception-V4). En la Opción A, YOLO26-seg segmenta y clasifica a la vez.
> - La arquitectura implementada no es InceptionV3 + Mask R-CNN + MiDaS. Es Inception-V4 + Mask2Former/YOLO26-seg + Depth Anything V2.
> - La introducción del V5 ya fue corregida (ya no habla de SAR/speckle).
> - La base de recortes se generó con el cuadernillo 00 **sin SAM2**: los recortes usan el polígono original como máscara (ver V.B.4).

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


### B. Datos y preprocesamiento

Esta sección describe el dataset original, el proceso de armonización de clases, las particiones utilizadas y la base de recortes que alimenta a los clasificadores. El objetivo es doble: fijar el protocolo experimental y explicar las decisiones que condicionan las métricas presentadas en las secciones C–E.

{imagen: flujo_preparacion_datos.png}

#### B.1 Dataset original

El punto de partida es **Food Recognition 2022 (MyFoodRepo)**, publicado en Kaggle como `sainikhileshreddy/food-recognition-2022` (aproximadamente 4,91 GB). El dataset está anotado a nivel de instancia mediante polígonos. La versión de anotaciones **v2.0** contiene **498 categorías** y se distribuye en **39.962 imágenes de entrenamiento** con **76.491 anotaciones** y **1.000 imágenes de validación** con **1.830 anotaciones**. El conjunto de test oficial no incluye anotaciones públicas, por lo que no puede utilizarse directamente para calcular AP o top-1.

Las anotaciones no son máscaras RLE, sino polígonos. Además, el **12,3 % de las instancias de train** y el **16,9 % de validación** contienen más de un polígono, lo que obliga a fusionarlos antes de exportar el dataset a formatos como YOLO-seg o COCO. Esta característica es relevante porque afecta tanto al entrenamiento de los segmentadores como a la definición de la máscara de referencia.

#### B.2 Mapeo de clases v2.0 → v2.1

Para alinear el dataset con la taxonomía **v2.1** del reto se aplicó el mapeo oficial `v2.1_breaking_class_mapping.json` y la lista `classes_round2.json`. El mapeo contiene **498 pares** y conduce a **323 clases finales**. Durante el proceso se descartaron **109 clases v2.0** que no forman parte de v2.1, lo que supone **3.175 anotaciones eliminadas**. Además, **32 clases v2.1** agrupan más de una clase v2.0.

Tras aplicar el mapeo, el dataset queda en **39.106 imágenes y 73.438 anotaciones de entrenamiento**, y **946 imágenes y 1.708 anotaciones de validación**. Esta reducción es la que fija el espacio de etiquetas definitivo del proyecto: las **323 clases** que también utiliza la tabla nutricional.

#### B.3 Particiones y protocolo de test

Como el test oficial no tiene anotaciones públicas, se reservó un **10 % del conjunto de entrenamiento** como test propio. La partición se estratificó por la clase dominante de cada imagen y se fijó con `seed=42`. El resultado final se resume en la Tabla 4.

**Tabla 4. Particiones utilizadas en todos los experimentos.**

| Split | Imágenes | Anotaciones |
|---|---:|---:|
| Train | 35.195 | 66.033 |
| Val | 946 | 1.708 |
| Test | 3.911 | 7.405 |

El test es, por tanto, un **conjunto reservado propio**, no el test oficial de AIcrowd. Se mantuvo separado de validación y no se utilizó para ajustar hiperparámetros. En la ejecución revisada, `run_duplicate_check=False`, por lo que no se aplicó la comprobación de casi-duplicados entre train y test; esta ausencia se reconoce como una limitación del protocolo.

El desbalance de clases es fuerte. En validación, **215 clases** tienen menos de cinco anotaciones y **28 clases** no aparecen; en test, **43 clases** tienen menos de cinco anotaciones, aunque **ninguna falta**. Por este motivo, las métricas principales se acompañan de **macro-F1** e intervalos, y las métricas por clase con pocas instancias deben interpretarse con cautela.

{imagen: distribucion_clases_por_split.png}

#### B.4 Base de recortes para los clasificadores

Los clasificadores C1, C2 y C3 no se entrenan con la imagen completa, sino con recortes de cada instancia. El cuadernillo `00_datos_food_recognition_v4_sam2.ipynb` genera dos variantes:

- `crops/`: fondo negro, caja de la máscara con un **2 %** de margen, lado mayor máximo de **256 px** y erosión de **1 px**.
- `crops_ctx/`: el mismo recorte con el fondo original y un **10 %** de margen.

Antes de guardar cada recorte se aplican tres filtros de calidad: lado menor mínimo de **32 px**, área mínima de **1.024 px** y relleno mínimo de la caja de **0,10**. Los recortes generados en la ejecución final se resumen en la Tabla 5.

**Tabla 5. Recortes generados para los clasificadores.**

| Split | Recortes | Descartados |
|---|---:|---|
| Train | 65.300 | 153 por lado pequeño, 498 por relleno bajo, 82 por área pequeña |
| Val | 1.669 | 8 / 26 / 5 |
| Test | 7.301 | 19 / 73 / 12 |

El cuadernillo produce, además, `crops_{split}.csv` con los metadatos de cada recorte, `refined_polys_{split}.json`, `manifest.json`, `classes.json`, `splits.json` y un zip final de aproximadamente **2,46 GB**. Los clasificadores C1, C2 y C3 utilizan `crops/` (fondo negro), mientras que los segmentadores A/B trabajan con las imágenes completas y las anotaciones COCO.

{imagen: ejemplos_recortes_crops.png}

**Máscara utilizada: polígono original, sin SAM2.** A pesar del nombre `v4_sam2`, la ejecución final no aplicó SAM2. El cuadernillo configura `facebook/sam2.1-hiera-base-plus` con lado máximo 1024, `score ≥ 0,80`, `IoU ≥ 0,60` y expansión de caja del 15 %, pero la celda de carga desactivó SAM2 por falta de GPU. Como consecuencia, los tres CSV tienen `mask_src = polygon` en los **74.270 recortes** (65.300 + 1.669 + 7.301), y la base se generó con el **polígono original** como máscara. Es importante no describirla como “refinada con SAM2”.

La comprobación es reproducible:

```python
import pandas as pd
pd.read_csv("crops_train.csv").mask_src.value_counts()
```

Si en el futuro se regenera la base con GPU y SAM2, será una **nueva versión** del dataset: cambiarán los conteos, la descripción y sería necesario reentrenar los clasificadores.

#### B.5 Implicaciones para el resto del proyecto

Esta preparación fija tres condiciones que se repiten en las secciones siguientes. Primero, todos los clasificadores comparten exactamente los mismos recortes y el mismo split, por lo que sus métricas son comparables entre sí. Segundo, los segmentadores A/B se evalúan sobre imágenes completas, no sobre recortes; por eso sus métricas no son directamente intercambiables con las de C. Tercero, el desbalance y el test propio explican por qué se reportan macro-F1, intervalos y métricas por clase, y por qué las conclusiones se limitan a este protocolo experimental.

---

### C. Percepción visual: segmentar primero, clasificar después

La capa de percepción convierte la fotografía en instancias de alimento con una clase y una máscara. A diferencia de la descripción preliminar de la sección IV, el pipeline implementado **no clasifica primero la imagen completa y segmenta después**. En la Opción B el orden es explícito: primero se segmentan las instancias con un modelo agnóstico y después se clasifica cada recorte. Este orden evita que el clasificador vea el plato completo, reduce la influencia del fondo y proporciona las máscaras que necesita el módulo de volumen. La Opción A, basada en YOLO26-seg, realiza segmentación y clasificación de forma conjunta y se conserva como alternativa ligera.

{imagen: pipeline_percepcion_visual.png}

#### C.1 Arquitectura de percepción

La implementación organiza la percepción en dos familias de segmentación y tres alternativas de clasificación:

- **Segmentación A/B:** Mask2Former Swin-tiny, en modo agnóstico (A4) y con 323 clases (B4).
- **Segmentación YOLO:** YOLO26-seg en tamaños `m` y `n`, para A1/A2/B1/B2 y el perfil ligero.
- **Clasificación C:** CNN propia desde cero (C1), MobileNetV3 (C2) e Inception-V4 (C3).

En la Opción B, Mask2Former propone las máscaras sin conocer la clase; cada máscara se recorta con el mismo preprocesado descrito en V.B y el clasificador asigna una de las 323 clases. En la Opción A, YOLO26-seg devuelve máscara y clase en una sola pasada. Los clasificadores C1/C2/C3 se entrenan sobre los recortes de `crops/`, no sobre la imagen completa.

#### C.2 Segmentación

La Tabla 6 recoge los resultados de los cuatro segmentadores y de sus evaluaciones agnósticas. Se reportan AP50, AP y AR100, junto con parámetros y latencia.

**Tabla 6. Resultados de segmentación en test.**

| Modelo | AP50 | AP | AR100 | Parámetros | Latencia |
|---|---:|---:|---:|---:|---:|
| A1 · YOLO26m agnóstico | 0,682 | 0,475 | 0,551 | 26,97 M | 20,8 ms |
| A2 · YOLO26n agnóstico | 0,651 | 0,445 | 0,535 | 3,08 M | 16,0 ms |
| A4 · Mask2Former agnóstico | **0,752** | **0,548** | **0,726** | 47,4 M | 111,3 ms |
| B1 · YOLO26m con clases | 0,325 | 0,232 | 0,326 | 27,55 M | 19,9 ms |
| B1 · evaluación agnóstica | 0,670 | 0,433 | 0,567 | — | — |
| B2 · YOLO26n con clases | 0,207 | 0,148 | 0,236 | 3,26 M | 15,8 ms |
| B2 · evaluación agnóstica | 0,601 | 0,387 | 0,553 | — | — |
| B4 · Mask2Former con clases | 0,352 | 0,265 | 0,605 | 47,5 M | 74,2 ms |
| B4 · evaluación agnóstica | 0,657 | 0,454 | 0,709 | — | — |

A4 obtiene la mejor calidad de máscara en modo agnóstico: AP50 de 0,752, AP de 0,548 y AR100 de 0,726. Le siguen A1 y A2, que con 26,97 M y 3,08 M de parámetros alcanzan AP50 de 0,682 y 0,651, respectivamente. La familia YOLO es mucho más rápida y ligera que Mask2Former, aunque pierde entre 7 y 10 puntos de AP50.

En la familia B, el AP con clases es bajo (0,352 en B4, 0,325 en B1 y 0,207 en B2) porque exige que coincidan máscara y clase. Al evaluar los mismos modelos en modo agnóstico, el AP50 sube a 0,657 en B4, 0,670 en B1 y 0,601 en B2. Es decir, una parte importante de la pérdida con clases procede de la clasificación, no solo del contorno. La comparación de latencia entre Mask2Former y YOLO no es directa: A4 usa 640 px y B4 224 px; A1/B1 usan 640 px y A2/B2 224 px.

{imagen: ejemplos_segmentacion_a4_b4.png}

#### C.3 Clasificación

La Tabla 7 resume los tres clasificadores entrenados sobre los recortes de `crops/`.

**Tabla 7. Resultados de clasificación en test.**

| Modelo | Top-1 | Top-5 | Macro-F1 | Parámetros | Latencia |
|---|---:|---:|---:|---:|---:|
| C1 · CNN propia | 0,506 | 0,776 | 0,308 | 11,44 M | 6,9 ms |
| C2 · MobileNetV3 | **0,579** | **0,840** | 0,423 | 4,62 M | 10,7 ms |
| C3 · Inception-V4 | 0,578 | 0,835 | **0,427** | 41,64 M | 30,6 ms |

C2 es la mejor opción en coste/precisión: obtiene el top-1 y el top-5 más altos con solo 4,62 M de parámetros y 10,7 ms. C3 queda prácticamente empatado en top-1 (0,578) y mejora muy ligeramente el macro-F1 (0,427 frente a 0,423), pero multiplica por nueve los parámetros y casi triplica la latencia. C1 es la alternativa más ligera, pero queda por debajo en las tres métricas. El macro-F1 es bajo en los tres casos porque hay 323 clases y un desbalance fuerte; el top-1 está dominado por las clases frecuentes.

{imagen: ejemplos_clasificacion_c1_c2_c3.png}

#### C.4 Lectura conjunta: perfil robusto y perfil ligero

La Tabla 8 compara los dos perfiles completos. En el perfil ligero, A2 se combina con C2 y se enfrenta a B2; en el robusto, A4 se combina con C3 y se enfrenta a B4.

**Tabla 8. Comparación de los perfiles ligero y robusto.**

| Perfil | A | C | B | AP50 A | AP50 B (clases) | AP50 B (agnóstico) | Top-1 C | Params A+C | Params B | Latencia A+C | Latencia B |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Ligero | A2 | C2 | B2 | 0,651 | 0,207 | 0,601 | 0,579 | 7,70 M | 3,26 M | 26,7 ms | 15,8 ms |
| Robusto | A4 | C3 | B4 | **0,752** | 0,352 | 0,657 | 0,578 | 89,0 M | 47,5 M | 141,8 ms | 74,2 ms |

En el perfil ligero, A2 segmenta mejor que B2 en modo agnóstico (0,651 frente a 0,601; diferencia de **−0,050** a favor de A2), pero B2 es un único modelo de 3,26 M y 15,8 ms, mientras que A2+C2 suma 7,70 M y 26,7 ms. La balanza es similar a la del perfil robusto: las piezas A+C ofrecen mejor máscara y un clasificador independiente; B ofrece una solución integrada más barata.

En el perfil robusto, A4 supera a B4 en modo agnóstico (0,752 frente a 0,657; diferencia de **−0,096**), pero A4+C3 suma 89,0 M y 141,8 ms frente a 47,5 M y 74,2 ms de B4. Además, A4 y B4 no usan el mismo tamaño de entrada (640 frente a 224), por lo que la latencia no es directamente comparable.

En conjunto, el perfil robusto mejora el AP50 de A en **+0,102** y el AR100 en **+0,192** respecto al ligero, pero añade **+81,3 M** de parámetros y **+115,2 ms** a la pareja A+C. La diferencia entre C2 y C3 es prácticamente nula; el salto de calidad está en la segmentación, no en el clasificador.

{imagen: comparacion_perfiles_visual.png}

La Tabla 9 añade la exactitud de clase sobre instancias emparejadas de los modelos B. Debe interpretarse con cuidado: mide la clase solo en las instancias que el modelo encontró, no es equivalente al top-1 de C sobre todos los recortes.

**Tabla 9. Exactitud de clase sobre instancias emparejadas (modelos B).**

| Modelo | Accuracy | Macro-F1 | Balanced acc. | Det. recall | Det. precision | n emparejadas |
|---|---:|---:|---:|---:|---:|---:|
| B1 · YOLO26m | **0,736** | **0,542** | **0,547** | 0,585 | 0,790 | 4.333 |
| B2 · YOLO26n | 0,674 | 0,386 | 0,395 | 0,441 | 0,794 | 3.267 |
| B4 · Mask2Former | — | — | — | — | — | — |

B1 obtiene la mejor exactitud de clase (0,736) y el mejor macro-F1 (0,542), seguido de B2 (0,674 y 0,386). B4 no guardó `matched_cls`, por lo que su comparación fina con el techo de C queda pendiente. Los valores de B1/B2 no son directamente comparables con el top-1 de C: C clasifica todos los recortes de test, mientras que B1/B2 solo evalúan las instancias que consiguieron emparejar.

Como variante intermedia, A1+B1 suma 54,5 M y 40,7 ms, frente a 27,55 M y 19,9 ms de B1. A1 obtiene AP50 0,682 y B1 baja a 0,325 con clases pero sube a 0,670 en modo agnóstico. No forma parte de los dos perfiles principales, pero confirma la misma tendencia: YOLO26m mejora la máscara respecto a YOLO26n a cambio de más parámetros y latencia.

#### C.5 Qué establece esta sección

Esta sección fija cuatro conclusiones. Primera, el orden correcto del pipeline es **segmentar → clasificar**, no al contrario. Segunda, A4 es la mejor opción cuando prima la calidad de máscara y A2 la mejor dentro del perfil ligero; B4 y B2 son las alternativas integradas más baratas. Tercera, C2 es la mejor relación coste/precisión y C3 solo se justifica si se busca exprimir ligeramente el macro-F1. Cuarta, el perfil ligero ya está completo: A2+C2 y B2 pueden compararse con las mismas métricas que el perfil robusto.

La comparación es entre las alternativas implementadas, no contra InceptionV3 o Mask R-CNN del V5. No se hizo un benchmark controlado contra esas arquitecturas, por lo que las sustituciones deben presentarse como decisiones de ingeniería y no como una mejora demostrada frente a la propuesta inicial.


---

### D. Profundidad y volumen: por qué se cambió a Depth Anything V2

El módulo de volumen es el puente entre la máscara de un alimento y su peso en gramos. Para estimar centímetros cúbicos no basta con saber qué alimento es: hace falta una profundidad métrica, una referencia de escala y un modelo geométrico de la escena. Esta sección explica por qué se sustituyó MiDaS por Depth Anything V2, cómo se corrige la escala con el plato y cómo se obtiene el volumen aparente.

{imagen: pipeline_profundidad_volumen.png}

#### D.1 Por qué se cambió MiDaS por Depth Anything V2

La propuesta inicial del V5 utilizaba MiDaS. MiDaS produce una estimación de profundidad **relativa** o de disparidad: ordena los píxeles de cerca a lejos, pero no devuelve una distancia en metros. Esa salida es útil para efectos visuales o para comparar regiones, pero no permite calcular cm³ sin una transformación adicional y una referencia física.

La implementación adoptó **Depth Anything V2 Metric Indoor Small**, una variante métrica entrenada para interiores. El cambio se justifica por cuatro motivos:

1. Devuelve profundidad en **metros**, que es la entrada natural del modelo pinhole y del cálculo de volumen.
2. Está orientada a **interiores**, que es el caso de uso de la app: un plato sobre una mesa.
3. La variante **Small** es la validada de extremo a extremo y la que se usa en producción; mantiene un coste compatible con el despliegue.
4. La variante **Large** sobreestima la distancia en primeros planos. En pruebas internas situó la mesa a ~1,8 m donde había ~0,4 m y disparó el volumen; por eso no se adoptó sin una calibración adicional.

El cambio no se presenta como una comparación experimental controlada entre MiDaS y Depth Anything V2. No se ejecutó un benchmark con las dos arquitecturas sobre el mismo conjunto. Es una **decisión de ingeniería** basada en la necesidad de una salida métrica, en la disponibilidad del modelo y en su comportamiento observado en el caso de uso.

#### D.2 Escala con el plato

Depth Anything V2 es métrico “en teoría”, pero en primeros planos sigue teniendo sesgo. La distancia estimada para la mesa puede ser varias veces mayor que la real, y el volumen crece con el cubo de la distancia. Para corregirlo se usa el **plato** como referencia de tamaño conocido.

El proceso es el siguiente:

1. La imagen se reduce a un lado mayor de 1024 px, igual que en el resto del pipeline.
2. Se estima la profundidad `z_modelo(x, y)` en metros.
3. Se detecta el borde del plato con Hough. El diámetro nominal es `D_plato = 26 cm`.
4. Se calcula la distancia al plato con geometría pinhole:

```text
z_plato = f_px · D_plato / (2 · r_plato)
```

5. Se obtiene el factor de escala comparando esa distancia con la mediana de la profundidad estimada:

```text
k      = z_plato / mediana(z_modelo)
z_real = k · z_modelo
```

La focal `f_px` se resuelve con prioridad: FOV horizontal explícito, focal equivalente 35 mm del EXIF o, si no hay datos, un FOV por defecto de 65°.

Si el plato no se detecta con suficiente fiabilidad, el pipeline no inventa una escala: si la mediana de profundidad supera los 80 cm, la acota a una distancia típica de foto de plato (35 cm) y añade la advertencia `no_plate_reference`; si está dentro de un rango razonable, deja la profundidad original. El factor de escala solo se acepta si cae dentro del rango permitido (0,05–1,6); fuera de ese rango se considera que el círculo detectado no es el plato.

{imagen: mapa_profundidad_escala_plato.png}

#### D.3 Geometría 3D y volumen aparente

Con la profundidad corregida, cada píxel se retroproyecta a coordenadas de cámara con el modelo pinhole:

```text
P = z_real · ((x − cx)/f_px, (y − cy)/f_px, 1)
```

El siguiente paso es ajustar el plano de apoyo. Se construye un anillo de píxeles alrededor de la máscara, se excluyen todos los alimentos y se ajusta un plano `n·P = d` con RANSAC. Si el plano del anillo no es fiable, se prueba el fondo; si tampoco, se usa un plano fronto-paralelo a la profundidad del entorno.

Para cada píxel de la máscara se calcula la altura sobre la mesa:

```text
h = clip(n·P − d, 0, 20 cm)
```

El área proyectada de cada píxel se obtiene con:

```text
A_px = z_real² / (f_px² · |n·d|)
```

Y el volumen aparente es la suma de altura por área:

```text
V = Σ h · A_px
```

El volumen es **aparente**: solo mide lo visible desde la cámara. Una comida oculta por otra, un hueco interno o una cara no visible no se reconstruyen.

El pipeline aplica además topes de cordura. La altura media se recorta a 6 cm, el peso total a 2 kg y la altura máxima por píxel a 20 cm. Si una fracción alta de la máscara satura la altura máxima, se prueba el plano fronto-paralelo y se queda el que produzca menos saturación. Cuando se aplica un recorte, se añade la advertencia `volume_clamped`.

Finalmente, el volumen se convierte en peso y nutrientes:

```text
peso_g = V · densidad_g_cm3
kcal   = peso_g / 100 · kcal_100g
```

{imagen: superficie_3d_volumen.png}

#### D.4 Resultados sobre la foto de prueba

La foto de prueba (`34g_platano_163cerdo_105papa.jpg`) permite comprobar el comportamiento del módulo. La Tabla 10 resume los parámetros de escala y la Tabla 11 los resultados por alimento.

**Tabla 10. Parámetros de profundidad y escala en la foto de prueba.**

| Parámetro | Valor |
|---|---:|
| Profundidad monocular (mediana) | 1,58 m |
| Profundidad corregida (mediana) | ≈0,30 m |
| Factor de escala `k` | 0,188 |
| Radio del plato detectado | 351 px |
| Distancia estimada al plato | ≈30 cm |
| Inclinación de cámara | 6,9° |
| Volumen total detectado | 417,6 cm³ |
| Peso total detectado | 351,3 g |
| Peso total real | 302 g |

**Tabla 11. Volumen y peso por alimento en la foto de prueba.**

| Alimento | Volumen | Peso detectado | Clase corregida | Peso corregido | Peso real |
|---|---:|---:|---|---:|---:|
| Segmento izquierdo | 97,9 cm³ | 103,2 g | plátano | 77,6 g | 34 g |
| Segmento central | 234,7 cm³ | 190,6 g | cerdo | 190,6 g | 163 g |
| Segmento inferior | 85,1 cm³ | 57,5 g | patata asada | 90,2 g | 105 g |
| **Total** | **417,6 cm³** | **351,3 g** | | **358,4 g** | **302 g** |

El cerdo es el caso más cercano: 190,6 g frente a 163 g reales, un **+17 %**. El plátano y la patata se confunden de clase en la detección, pero al corregir la clase en la app el total queda en 358,4 g frente a 302 g. El volumen del plátano está sobreestimado, probablemente porque la máscara incluye parte del brillo o del borde del plato. La corrección de clase no cambia el volumen: solo cambia la densidad y, con ella, el peso.

{imagen: resultado_peso_foto_prueba.png}

#### D.5 Límites y decisiones abiertas

El módulo funciona de extremo a extremo, pero no debe presentarse como un instrumento de medida. Sus límites principales son:

- La profundidad monocular sigue teniendo ambigüedad de escala; el plato es una referencia, no una calibración perfecta.
- El volumen es aparente y depende de la oclusión y del ángulo de la cámara.
- Un plano de mesa mal ajustado puede producir volúmenes irreales; los topes de cordura evitan los casos extremos, pero no sustituyen una medición.
- La validación con una sola foto es una prueba de concepto, no un benchmark.
- No se hizo una comparación controlada MiDaS frente a Depth Anything V2; el cambio se justifica por la necesidad de una salida métrica.
- La densidad del mapeo nutricional también introduce error: 43 clases usan densidades geométricas con incertidumbre estimada de ±15–20 %.

#### D.6 Qué establece esta sección

Esta sección establece que el volumen no sale directamente de un modelo de lenguaje ni de una regresión opaca: sale de una profundidad métrica, una referencia física (el plato), un plano de apoyo ajustado con RANSAC y una integración geométrica explícita. Depth Anything V2 aporta la profundidad; el plato aporta la escala; el módulo de volumen aporta la interpretación física. Esa separación es la que permite auditar el resultado, cambiarlo de clase sin recalcular la geometría y explicar por qué el peso estimado se acerca o se aleja del real.


---

### E. Mapeo nutricional

El mapeo nutricional traduce cada clase visual a una fila de nutrientes y a una densidad. Sin este módulo, el sistema podría decir “esto es pollo” o “esto es plátano”, pero no cuántos gramos, calorías o macronutrientes contiene. La implementación siguió el principio de separar la percepción de la base nutricional: los modelos de visión estiman la clase y el volumen; la tabla aporta la composición por 100 g y la densidad.

{imagen: flujo_mapeo_nutricional.png}

#### E.1 Estructura del mapeo

El punto de partida son las **323 clases** de `classes.json`. Para cada clase se construyó una fila con:

- el identificador `idx` y el nombre original;
- el alimento de **USDA FoodData Central** utilizado como referencia;
- el tipo de dato USDA (`SR Legacy`, `Survey (FNDDS)`, `Foundation` o `receta`);
- los nutrientes por 100 g;
- la densidad en g/cm³ y su procedencia;
- el estado de revisión y las alertas.

La tabla final, `nutrition_wide_densidad.csv`, tiene **323 filas y 219 columnas**. Incluye metadatos, energía, macronutrientes, micronutrientes y las columnas de densidad (`densidad_g_cm3`, `densidad_tipo`, `densidad_fuente`, `densidad_estado`, `densidad_estimada`, `densidad_motivo`). El archivo `food_names_es.csv` añade la traducción de los nombres al español.

La tabla se usa en dos pasos:

```text
gramos = volumen_cm3 × densidad_g_cm3
kcal   = gramos / 100 × kcal_100g
```

Los macronutrientes se calculan con la misma proporción. El volumen procede del módulo de profundidad descrito en V.D; la densidad y la composición proceden del mapeo.

#### E.2 Proceso de construcción y revisión

El mapeo no se generó automáticamente de principio a fin. El proceso fue:

1. **Búsqueda de candidatos** en USDA FoodData Central para cada clase.
2. **Propuesta inicial** de alimento y nutrientes con DeepSeek V4 Pro, almacenada en caché para no repetir llamadas.
3. **Revisión manual de las 323 filas**, organizada en siete lotes.
4. **Decisión por clase**: `ok` (se acepta la propuesta), `cambiar` (se usa otro `fdc_id`) o `receta` (se calcula a partir de ingredientes).
5. **Validación** de coherencia energética, recetas y una muestra de veinte clases.

La revisión manual introdujo **88 cambios** respecto al borrador inicial. Todas las clases tienen decisión final; no quedó ninguna pendiente. La Tabla 12 resume el tipo de emparejamiento.

**Tabla 12. Tipo de emparejamiento con USDA.**

| Tipo de match | Clases |
|---|---:|
| Exacto (`exact`) | 183 |
| Manual (`manual`) | 73 |
| Cercano (`close`) | 41 |
| Receta (`receta`) | 15 |
| Proxy (`proxy`) | 10 |
| Compuesto (`composite`) | 1 |
| **Total** | **323** |

El origen de los datos USDA se reparte en **172 entradas SR Legacy**, **111 Survey (FNDDS)**, **25 Foundation** y **15 recetas**. Las entradas SR Legacy y FNDDS aportan la mayor parte de los nutrientes; las Foundation son más recientes, pero en algunos casos tienen menos micronutrientes reportados.

#### E.3 Nutrientes y recetas

Cada fila contiene los nutrientes por 100 g. Los campos principales son energía (`kcal_100g`), proteína (`Protein (g)`), carbohidratos (`Carbohydrate, by difference (g)`) y grasa (`Total lipid (fat) (g)`). La tabla conserva además fibra, azúcares, sodio, ácidos grasos y una lista amplia de vitaminas y minerales.

Los **15 platos compuestos** se calcularon con `recetas.csv`: cada receta contiene ingredientes con su `fdc_id` y sus gramos por 100 g de plato listo. Los gramos de cada receta suman 100 g y los nutrientes se obtienen por suma ponderada. La energía de cada ingrediente se toma de USDA; si un ingrediente no reporta un nutriente, ese nutriente cuenta como cero. Esto es correcto para un nutriente ausente en un aceite, pero puede subestimar vitaminas y minerales cuando el dato falta de verdad.

#### E.4 Densidad: de volumen a gramos

La densidad es la pieza que conecta el volumen aparente de la foto con la masa. El mapeo aplica este orden de prioridad:

1. **Medida de volumen de USDA**: 203 clases. Se usa el peso de una taza o cucharada y se divide por su volumen (taza = 236,6 cm³; cucharada = 14,8 cm³; cucharadita = 4,9 cm³). Se descartan medidas que miden otra forma física o que quedan fuera de rango.
2. **Tablas publicadas**: 60 clases. Incluyen 33 entradas de FAO/INFOODS y 23 de la tabla 4.2 de *Engineering Properties of Foods* (carnes, pescado, manzana, pera, queso), además de USDA AMS y otras referencias.
3. **Cálculo geométrico**: 43 clases. No había una densidad publicada para la forma en que se sirve el alimento; se calculó `ρ = masa de la porción / volumen de un sólido` con dimensiones típicas. **No son mediciones** y tienen una incertidumbre estimada de ±15–20 %.
4. **Receta**: 15 clases. Se aplica `ρ = 100 / Σ(gᵢ/ρᵢ)` a partir de las densidades de los ingredientes.
5. **Referencia de categoría**: 2 clases (huevo entero y nata).

La Tabla 13 resume las fuentes y la confianza.

**Tabla 13. Fuentes de densidad.**

| Fuente | Clases | Confianza |
|---|---:|---|
| Medida de volumen USDA | 203 | alta o media |
| Tabla publicada (FAO, tabla 4.2, USDA AMS, otras) | 60 | media |
| Cálculo geométrico | 43 | baja |
| Cálculo por receta | 15 | baja |
| Referencia de categoría | 2 | media |
| **Total** | **323** | |

La confianza global es de **173 densidades altas, 92 medias y 58 bajas**. Las 58 bajas coinciden con las 43 geométricas y las 15 recetas.

La revisión de densidades también corrigió errores de clasificación por palabras: `blueberries` caía en “queso azul”, `pineapple` en “frutos secos” por *pine*, `potato_salad` en “hojas verdes”, `pasta_in_butterfly_form_farfalle` en “mantequilla” por *butterfly*, `quiche` en “queso” y `salad_lambs_ear` en “cordero”. Los **168 cambios** quedaron auditados en `densidad_cambios.csv`.

#### E.5 Ejemplos reales del mapeo

La Tabla 14 muestra tres clases que se usan en la foto de prueba y que ilustran las tres fuentes principales de densidad.

**Tabla 14. Ejemplos de filas del mapeo.**

| Clase | USDA | Match | kcal/100 g | Proteína | Carbohidratos | Grasa | Densidad | Fuente |
|---|---|---|---:|---:|---:|---:|---:|---|
| `banana` (plátano) | Bananas, raw | exacto | 89 | 1,09 g | 22,84 g | 0,33 g | 0,793 | medida USDA |
| `pork_n_s` (cerdo) | Pork, ground, 84 % lean / 16 % fat, cooked, pan-broiled | manual | 301 | 27,14 g | 0,00 g | 21,39 g | 0,812 | cálculo geométrico |
| `baked_potato` (patata asada) | Potatoes, baked, flesh and skin, without salt | exacto | 93 | 2,50 g | 21,15 g | 0,13 g | 1,06 | tabla publicada (USDA AMS) |

{imagen: ejemplo_mapeo_tres_clases.png}

Aplicando la fórmula a los volúmenes medidos en V.D: el plátano queda en 97,9 × 0,793 = 77,6 g; el cerdo en 234,7 × 0,812 = 190,6 g; y la patata en 85,1 × 1,060 = 90,2 g. La diferencia con los pesos reales ya se discutió en V.D: el cerdo es el caso más cercano y el plátano es el más sobreestimado.

#### E.6 Control de calidad

El mapeo se sometió a cuatro comprobaciones:

- **Coherencia energética:** 316 de 323 clases cumplen `kcal ≈ 4·proteína + 4·carbohidratos + 9·grasa` con una tolerancia del ±15 % y corrección por fibra. Las siete excepciones son bebidas alcohólicas (vino, cerveza, Aperol) y agua; el alcohol no entra en la fórmula de Atwater y el agua tiene 0 kcal.
- **Recetas:** todas suman 100 g.
- **Decisiones:** las 323 clases tienen decisión final.
- **Verificación manual:** se revisaron veinte clases; 18/20 fueron correctas y se corrigieron dos errores (`spring_roll_fried` → 172105 y `bread_grain` → 168013).

Aun así, quedan **48 filas pendientes de revisión técnica**. Incluyen 23 de confianza baja, 15 recetas, 21 proxies o aproximaciones y 5 casos de coherencia ya explicados. Las **43 densidades geométricas** siguen siendo cálculos, no mediciones, y las **15 recetas** tienen una porción típica estimada.

{imagen: cobertura_calidad_mapeo.png}

#### E.7 Límites

El mapeo es completo, pero no es una base clínica. Sus límites principales son:

- **Cobertura desigual de micronutrientes:** algunas entradas Foundation reportan entre 11 y 58 nutrientes; en unas veinte clases faltan vitaminas y minerales.
- **Recetas con ceros:** cuando un ingrediente no reporta un nutriente, se asigna cero; esto puede subestimar micronutrientes.
- **Proxies:** clases sin equivalente exacto en USDA, como `aperitif` o `halloumi`, usan una aproximación marcada en `revision_tecnica.csv`.
- **Densidad aparente frente a sólida:** para alimentos en montón, el volumen de la foto incluye aire; para piezas compactas, no. La densidad elegida intenta corresponder a la forma de servicio, pero no siempre es exacta.
- **Geometría idealizada:** las 43 densidades geométricas usan formas y dimensiones típicas; el error esperado es ±15–20 %, suficiente para estimar calorías, no para pesar con precisión.
- **Sin TCAC:** la implementación se apoyó en USDA FoodData Central. La integración con la tabla colombiana TCAC no forma parte de esta versión.
- **Sin validación externa:** la verificación de 20 filas es un control interno, no una validación con nutricionistas.

#### E.8 Qué establece esta sección

Esta sección establece que el resultado nutricional no lo inventa el modelo de lenguaje: sale de una tabla construida y revisada, con una densidad explícita y una fuente trazable por clase. Esa separación permite cambiar la clase de un alimento en la app sin repetir la medición de volumen, auditar de dónde sale cada nutriente y distinguir entre una medida USDA, una tabla publicada y un cálculo geométrico. El mapeo cubre las 323 clases y es suficientemente completo para el producto, pero debe presentarse con sus incertidumbres: 43 densidades geométricas, 48 filas pendientes de revisión y una cobertura irregular de micronutrientes.


---

### F. Capa de razonamiento: Gemini

Gemini no participa en la percepción ni en la medición. Su función es interpretar el resultado estructurado del pipeline y convertirlo en un consejo breve. Esta separación es una decisión central del proyecto: el modelo de lenguaje no ve la foto, no estima volumen y no recalcula calorías; recibe un JSON con alimentos, gramos, energía y macronutrientes, y explica lo que esos datos implican.

{imagen: flujo_capa_razonamiento.png}

#### F.1 Papel dentro de la arquitectura

El flujo real es:

```text
foto → segmentación → clasificación → profundidad → volumen
     → densidad → peso, kcal y macros
     → JSON estructurado → Gemini → consejo breve
```

Gemini se invoca **después** de que el pipeline haya calculado el plato. No recibe la imagen ni las máscaras, y no tiene acceso a la tabla nutricional completa. Solo recibe los campos que necesita para razonar: nombre del alimento, gramos estimados, calorías, proteínas, carbohidratos y grasas. Los polígonos, las máscaras, los volúmenes y los valores por 100 g se excluyen del payload para reducir coste y evitar que el modelo intente recalcular lo que ya está medido.

El resultado se guarda con el análisis y se muestra en la pantalla de resultado. Si el usuario corrige un alimento o los gramos, el consejo se regenera con el plato actualizado.

#### F.2 Entrada y salida

La Tabla 15 resume el contrato de la capa de razonamiento.

**Tabla 15. Entrada y salida de la capa Gemini.**

| Elemento | Contenido |
|---|---|
| Entrada | JSON con `alimentos`: nombre, `peso_g`, calorías y macros |
| Salida | Texto de máximo tres oraciones |
| Idioma | Español o inglés según `Accept-Language`; cualquier otro idioma cae a español |
| Modelo | Gemini Flash Lite (`gemini-flash-lite-latest`) |
| Tiempo máximo | 10 s |
| Fallback | Si falla, devuelve vacío y el análisis se conserva |
| Personalización | Nombre de pila aproximadamente 1 de cada 3 veces |

El payload no incluye la imagen ni los polígonos. Tampoco incluye el historial completo del usuario ni objetivos dietéticos. El consejo se refiere únicamente al plato actual.

#### F.3 Prompt e idioma

El prompt se aplica como *system instruction*. La versión en español es:

```text
Eres un experto nutricional. Recibes un JSON con alimentos, sus gramos calculados y sus macronutrientes basados en datos del USDA. Tu objetivo es dar un consejo ultra-conciso (máximo 3 oraciones) sobre este plato. No recalcules las calorías, asume que los datos son exactos. Enfócate en el impacto metabólico (ej. picos de glucosa, saciedad, balance). Tono directo y amigable. Responde siempre en español y no repitas el JSON.
```

La versión en inglés es:

```text
You are a nutrition expert. You receive a JSON with foods, their estimated grams and their USDA-based macros. Give an ultra-concise tip (max 3 sentences) about this plate. Do not recalculate calories, assume the data is exact. Focus on the metabolic impact (e.g. glucose spikes, satiety, balance). Direct, friendly tone. Always answer in English and do not repeat the JSON.
```

Cuando toca personalizar, se añade una sola frase:

```text
Puedes dirigirte al usuario como {name} una sola vez, de forma natural; si no encaja, no lo menciones.
```

o, en inglés:

```text
You may address the user as {name} once, naturally; skip it if it does not fit.
```

El nombre se toma del perfil, se recorta al primer nombre y solo se pasa aproximadamente en el **35 %** de las peticiones. El objetivo es que el asistente no repita el nombre en cada consejo y que el texto no suene artificial.

{imagen: ejemplo_consejo_gemini.png}

#### F.4 Integración y tolerancia a fallos

La llamada a Gemini es síncrona y tiene un timeout de 10 s. Se intenta primero el modelo configurado en `GEMINI_MODEL` y, si falla, se prueba `gemini-flash-lite-latest`. Si ninguno responde, la función devuelve una cadena vacía: el análisis se guarda igualmente y la interfaz no se bloquea. En una edición, si Gemini falla, se conserva el consejo anterior.

El modelo no recibe la imagen, así que el coste y la latencia son bajos en comparación con la inferencia visual. La mayor parte del tiempo de respuesta del sistema está en Modal, no en Gemini.

#### F.5 Qué hace y qué no hace Gemini

**Sí hace:**

- Interpretar el plato en términos metabólicos: saciedad, picos de glucosa, equilibrio de macronutrientes.
- Dar un consejo breve y legible para el usuario.
- Adaptar el idioma y, ocasionalmente, el nombre.
- Explicar el resultado sin repetir el JSON.

**No hace:**

- No detecta alimentos.
- No segmenta.
- No estima volumen ni peso.
- No recalcula calorías ni macros.
- No sustituye a un nutricionista.
- No usa el historial ni los objetivos del usuario en esta versión.

La última limitación es importante: el V5 proponía que Gemini interpretara objetivos, historial y contexto. La implementación actual se limita al plato actual y a un consejo de tres oraciones. Es una decisión de alcance, no una capacidad que se haya implementado y no se use.

#### F.6 Límites y evaluación

No se hizo una evaluación cuantitativa de la calidad de los consejos. No hay un conjunto de respuestas de referencia ni un estudio con usuarios; la validación es funcional: el consejo se genera, se guarda, se muestra y se regenera al corregir el plato. La calidad del texto es subjetiva y depende del modelo y del prompt.

Otras limitaciones:

- El consejo es informativo y no médico; no conoce alergias, patologías ni objetivos clínicos.
- No usa el historial, así que no puede decir si el usuario ya comió lo mismo hoy.
- El nombre se usa de forma probabilística; a veces el consejo no personaliza.
- Si Gemini falla, el usuario puede quedarse sin consejo, aunque el análisis nutricional sigue disponible.

#### F.7 Qué establece esta sección

Esta sección establece que Gemini es una **capa fina de interpretación**, no el motor del sistema. Su valor está en explicar un resultado ya medido, no en producir la medición. Esa separación es la que permite auditar el peso y las calorías sin depender del lenguaje, cambiar el modelo de lenguaje sin tocar el pipeline y mantener la app funcionando aunque Gemini no esté disponible.


---

### G. Aplicación web y despliegue

La aplicación web es la capa que convierte el pipeline en un producto usable. Permite autenticarse, capturar o subir una foto, lanzar el análisis, revisar el resultado, corregir alimentos y consultar el historial. El sistema está desplegado y funciona de extremo a extremo sobre servicios gestionados.

{imagen: arquitectura_despliegue.png}

#### G.1 Flujo funcional

El recorrido principal es:

1. El usuario inicia sesión con Google.
2. Captura una foto con la cámara o sube una imagen de la galería.
3. El frontend pide una URL prefirmada y sube la imagen directamente a Cloudflare R2.
4. Django recibe la referencia de la imagen y llama al endpoint de Modal con el pipeline seleccionado.
5. Modal ejecuta segmentación, clasificación, profundidad, volumen y nutrición.
6. Django recibe el JSON, pide el consejo a Gemini y guarda el `FoodLog`.
7. El frontend muestra el resultado, las máscaras, el peso, las calorías y los macros.
8. El usuario puede corregir la clase, los gramos o el diámetro del plato, o borrar el análisis.

#### G.2 Frontend

El frontend está implementado en Angular y desplegado en Vercel. Sus funciones principales son:

- **Autenticación con Google** y gestión del token JWT.
- **Captura guiada** con `getUserMedia` y `DeviceOrientationEvent`.
- **Nivel de cámara**: el aro y el disparador se ponen verdes cuando la inclinación es aproximadamente perpendicular a la mesa; si se mantiene, se dispara con cuenta atrás.
- **Ajuste de FOV** y lectura de la focal equivalente 35 mm cuando está disponible.
- **Resultado visual** con las máscaras superpuestas como SVG, etiquetas por zona y detalle nutricional.
- **Historial en galería** con scroll horizontal, miniaturas y precarga del siguiente análisis.
- **Edición** de alimento, gramos y diámetro del plato.
- **Borrado** del análisis y de la imagen asociada, con confirmación en dos pasos.
- **Fecha y hora** en la zona del dispositivo.
- **Perfil, tema y ajustes**.
- **Selector de pipeline A/B** para administradores, guardado solo en el dispositivo.

La captura guiada es una ayuda, no una imposición: si el navegador no ofrece las APIs de orientación, la app sigue funcionando con la captura normal. El aviso de foto no cenital se calcula también a posteriori con la normal del plano de apoyo.

#### G.3 Backend y API

El backend es una API Django REST desplegada en Render. Actúa como orquestador y como frontera de seguridad: el frontend nunca recibe las claves de Modal, R2 o Gemini. La Tabla 16 resume los endpoints principales.

**Tabla 16. Endpoints principales de la API.**

| Método | Ruta | Función |
|---|---|---|
| POST | `/api/auth/google/` | Intercambia el ID token de Google por JWT |
| POST | `/api/auth/refresh/` | Renueva el token de acceso |
| GET / PATCH | `/api/me/` | Perfil del usuario y edición de nombre |
| POST | `/api/uploads/presign/` | URL prefirmada para subir a R2 |
| GET / POST | `/api/food-logs/` | Historial y creación de un análisis |
| GET / PATCH / DELETE | `/api/food-logs/<id>/` | Detalle, corrección y borrado |
| GET | `/api/foods/?q=` | Búsqueda en las 323 clases |

La creación de un `FoodLog` descarga la imagen de R2, llama a Modal y, si hay alimentos, pide el consejo a Gemini. El detalle devuelve los alimentos con su volumen, peso, densidad, calorías y macros. Las correcciones se aplican en el servidor: cambiar la clase recalcula el peso con la nueva densidad; cambiar los gramos ajusta el volumen; cambiar el diámetro del plato reescala el análisis completo con el cubo del diámetro, sin reprocesar la foto. Los análisis con gramos puestos a mano no se tocan al cambiar el diámetro.

La API filtra siempre por `usuario=request.user`; un usuario no puede leer ni modificar los análisis de otro. La clave de imagen se valida además contra el prefijo del usuario.

#### G.4 Servicio de inferencia

La inferencia vive en Modal, en una GPU A10G. El servicio carga los modelos de segmentación, clasificación y profundidad, junto con la tabla nutricional, y expone un endpoint protegido por el secreto compartido `X-Modal-Secret`. El frontend no puede llamarlo directamente.

El servicio recibe la imagen y los parámetros de cámara (`pipeline`, `fov_deg`, `f35_mm`) y devuelve el JSON con alimentos, volúmenes, pesos, calorías, macros, polígonos, centroides y advertencias. El timeout del backend es de 90 s. El primer análisis tras un periodo de inactividad puede tardar más por el *cold start*; después, la instancia se mantiene caliente durante unos minutos.

#### G.5 Despliegue y operación

La Tabla 17 resume los parámetros operativos más relevantes.

**Tabla 17. Límites y parámetros de operación.**

| Parámetro | Valor |
|---|---|
| Lado mayor de la imagen de entrada | 1024 px |
| Tamaño máximo de subida | 10 MB |
| Formatos aceptados | JPEG, PNG, WebP |
| Expiración de la URL de subida | 300 s |
| Expiración de la URL de lectura | 1 h |
| Retención de la imagen en R2 | 72 h |
| Retención del `FoodLog` | 30 días |
| Timeout de Modal | 90 s |
| Timeout de Gemini | 10 s |
| Diámetro de plato admitido | 15–40 cm |
| FOV admitido | 10–170° |

El despliegue se reparte así:

- **Vercel:** frontend Angular y dominio `caloriescounter.app`.
- **Render:** API Django y health check.
- **Modal:** inferencia GPU y modelos.
- **Neon:** PostgreSQL para usuarios y análisis.
- **Cloudflare R2:** imágenes con URL prefirmada.

#### G.6 Seguridad y privacidad

- **Autenticación:** Google OAuth y JWT; el token de acceso dura 1 h y el de refresco 14 días.
- **Aislamiento:** todas las consultas de análisis se filtran por usuario.
- **Subida directa:** el frontend sube a R2 con una URL prefirmada; el backend no recibe el archivo binario.
- **Bucket privado:** las imágenes se leen con URLs prefirmadas de 1 h.
- **Modal:** el endpoint exige `X-Modal-Secret`; no es público.
- **Secretos:** las claves de Modal, R2 y Gemini viven en el backend, nunca en el frontend.
- **Retención:** las imágenes se borran a las 72 h y los análisis a los 30 días; el borrado manual elimina también la imagen de R2.

#### G.7 Límites de la aplicación

- El *cold start* de Modal puede alargar el primer análisis.
- La app depende de la cámara y del navegador; las APIs de orientación no están disponibles en todos los dispositivos.
- No hay funcionamiento offline ni aplicación nativa.
- El historial no se usa para personalizar el consejo de Gemini; el consejo se refiere solo al plato actual.
- Si Gemini falla, el análisis se guarda pero el consejo puede quedar vacío.
- Las imágenes desaparecen a las 72 h; los análisis antiguos se pueden abrir, pero sin foto.
- El pipeline B es el predeterminado; el selector A/B está pensado para administradores y solo afecta al dispositivo.

#### G.8 Qué establece esta sección

Esta sección establece que el proyecto no es solo un cuaderno de experimentos: es una aplicación desplegada con autenticación, captura guiada, inferencia GPU, almacenamiento privado, historial y corrección de resultados. La arquitectura separa claramente frontend, API, inferencia y almacenamiento, lo que permite cambiar un modelo o un proveedor sin reescribir la app. Las limitaciones operativas —cold start, retención, dependencia del navegador y alcance del consejo— quedan explícitas para no confundir el prototipo funcional con un producto clínico.


---

### H. Validación y recursos generados

La validación del proyecto combina evidencia cuantitativa, comprobaciones unitarias, validación funcional de la app y artefactos reproducibles. No es una validación clínica ni un estudio con usuarios: es la evidencia necesaria para sostener que el pipeline funciona, que las comparaciones son trazables y que los resultados pueden reproducirse.

#### H.1 Experimentos y cuadernillos

La experimentación se organiza en tres familias y dos cuadernillos de soporte:

- **Familia A (segmentación agnóstica):** A1, A2 y A4.
- **Familia B (segmentación con clases):** B1, B2 y B4.
- **Familia C (clasificación de recortes):** C1, C2 y C3.
- **Cuadernillo 00:** preparación del dataset, mapeo v2.0 → v2.1, particiones y recortes para clasificadores.
- **Cuadernillo 99:** comparación, auditoría y perfiles.

Son **nueve experimentos canónicos**. El cuadernillo `B1_yolo26_clases v4.ipynb` se conserva como ensayo anterior; la versión canónica es `B1_yolo26_clases_v4_final_m.ipynb`. Los nueve resultados de test están presentes y se usan en la comparación.

#### H.2 Cuaderno de comparación

El cuaderno `99_comparacion_resultados.ipynb` es el eje de la evidencia comparativa. Contiene:

1. **Inventario y cobertura** de los resultados disponibles.
2. **Auditoría 1.1** de runs, cuadernillos y JSON de test.
3. **Segmentadores agnósticos** (familia A y B en modo agnóstico).
4. **Segmentadores con clases** (familia B) y exactitud de clase.
5. **Clasificadores** (familia C), intervalos y comparación pareada.
6. **Perfiles ligero y robusto**, con las piezas A, C y B por separado.
7. **Resumen y exportación**, más la sección opcional de pipelines P1.

El cuaderno genera `resumen.csv`, `resumen.xlsx`, `resumen.json`, `segmentadores_agnostico.csv`, `segmentadores_clases.csv`, `clasificadores.csv`, `clasificadores_pareado.csv`, `perfiles_piezas.csv`, `perfiles_resumen.csv`, `perfiles_delta.csv` y las figuras de barras y eficiencia. También deja `auditoria_runs.csv` con el cruce entre pesos, épocas, `DONE.json`, cuadernillo y resultado.

{imagen: cuaderno_comparacion_resumen.png}

Dos límites quedan visibles en esta comparación: el pipeline P1 (A+C end-to-end) no se construyó —la comparación de perfiles es por piezas— y B4 no guardó `matched_cls`, por lo que la exactitud de clase sobre instancias emparejadas solo está disponible para B1 y B2.

#### H.3 Recursos visuales

Los recursos visuales están en `presentación/tests/Recursos_visuales/`. Se generaron con el pipeline real y con la tabla nutricional real, no con datos inventados:

- `01_flujo_pipeline.png`: los siete pasos del pipeline.
- `02_mapa_profundidad.png`: foto, máscaras, profundidad monocular, profundidad corregida y altura sobre la mesa.
- `03_volumen_3d.png`: superficie 3D y volumen por alimento.
- `04_resultado_plato.png`: resultado sobre la foto con peso, kcal y macros.
- `05_pesos_vs_reales.png`: peso estimado frente a peso real.
- `06_deteccion_vs_correccion.png`: detección frente a corrección de clase.
- `07_mapeo_flujo.png`, `08_mapeo_cobertura.png` y `09_mapeo_ejemplo.png`: construcción, cobertura y ejemplos del mapeo nutricional.

La carpeta incluye una galería `index.html`, un `README.md`, los JSON/CSV/NPZ de apoyo y los scripts `generar_recursos.py`, `generar_datos.py`, `generar_figuras.py` y `generar_mapeo.py`.

{imagen: galeria_recursos_visuales.png}

#### H.4 Pruebas y validación funcional

La validación técnica incluye:

- **Pruebas unitarias del cálculo de volumen y nutrición** en `ml/tests/test_core.py`.
- **Validación funcional de la app**: login, subida, inferencia, resultado, historial, edición de alimento/gramos/diámetro y borrado.
- **Comprobación de despliegue**: frontend en Vercel, API en Render con health check, Modal disponible y R2 accesible.
- **Auditoría de resultados**: los nueve JSON de test están presentes y el cuaderno 99 los lee sin archivos rotos.

No hay una batería formal de tests de interfaz ni un estudio de usabilidad. La validación funcional es manual y se apoya en la app desplegada.

#### H.5 Qué demuestra la evidencia

La Tabla 18 resume la relación entre la evidencia y la conclusión que sostiene.

**Tabla 18. Evidencia y conclusión.**

| Evidencia | Qué demuestra |
|---|---|
| AP50/AR100 de A1, A2, A4, B1, B2, B4 | A4 obtiene la mejor máscara; YOLO es más ligero y rápido; la brecha entre clases y agnóstico separa error de máscara y de clase |
| Top-1, top-5 y macro-F1 de C1, C2, C3 | C2 es la mejor relación coste/precisión; C3 solo mejora marginalmente el macro-F1 con 9× parámetros |
| Perfiles ligero y robusto | A+C ofrece mejor máscara; B ofrece una solución integrada más barata; el salto de calidad está en la segmentación |
| Profundidad y volumen de la foto de prueba | La escala con plato corrige la profundidad; el cerdo queda a +17 %; el total detectado es 351,3 g frente a 302 g reales |
| Mapeo nutricional | 323/323 clases con densidad; 316/323 con coherencia energética; 18/20 en la verificación manual |
| App desplegada | El flujo foto → inferencia → resultado → historial → corrección funciona de extremo a extremo |

La Tabla 19 enumera los artefactos principales.

**Tabla 19. Artefactos de validación y reproducibilidad.**

| Artefacto | Ubicación |
|---|---|
| Cuadernillos de experimentos | `presentación/cuadernillos/` |
| Cuaderno de comparación | `presentación/99_comparacion_resultados.ipynb` |
| Resultados de test | `presentación/calorie_counter/resultados/*.json` |
| Tablas y figuras comparativas | `presentación/calorie_counter/comparacion/` |
| Recursos visuales | `presentación/tests/Recursos_visuales/` |
| Mapeo nutricional | `presentación/README_mapeo nutricional.md` y `ml/data/nutrition_wide_densidad.csv` |
| Pruebas de volumen/nutrición | `ml/tests/test_core.py` |

#### H.6 Límites de la validación

La evidencia es suficiente para un prototipo funcional, pero no para una validación clínica. Los límites principales son:

- La validación de profundidad y volumen se apoya en **una sola foto** con pesos conocidos; no es un benchmark.
- No hay estudio con usuarios ni evaluación de usabilidad.
- No se hizo una comparación controlada contra InceptionV3, Mask R-CNN o MiDaS.
- El test es propio (10 % de train), no el test oficial de AIcrowd.
- B4 no guardó `matched_cls`.
- El pipeline P1 no se construyó; la comparación de perfiles es por piezas.
- Quedan **48 filas** del mapeo pendientes de revisión técnica y **43 densidades geométricas** con ±15–20 % de incertidumbre.
- A4/B4 y A1/A2 usan resoluciones distintas, así que las latencias no son directamente comparables.

#### H.7 Qué establece esta sección

Esta sección establece que el proyecto no solo produce métricas aisladas: deja un conjunto reproducible de cuadernillos, resultados, tablas, figuras, pruebas y recursos visuales. La comparación permite defender por qué se eligió cada modelo y qué se sacrifica al elegir el perfil ligero o el robusto. También deja explícitos los huecos —P1, `matched_cls` de B4, revisión técnica del mapeo y validación con más escenas— para que el avance se lea como un sistema funcional con límites conocidos, no como una promesa cerrada.


---

### I. Cambios respecto a la propuesta inicial

La implementación conserva la filosofía modular del V5, pero no reproduce literalmente las arquitecturas que el documento proponía. El cambio más importante no es de modelo, sino de **orden**: el V5 describe primero la clasificación y después la segmentación; el sistema real segmenta primero y clasifica cada recorte. Los demás cambios sustituyen tres componentes de percepción por alternativas más recientes y ajustan el alcance de Gemini. Esta sección documenta esas diferencias y evita presentarlas como mejoras no demostradas.

{imagen: propuesta_vs_implementacion.png}

#### I.1 Corrección del orden del pipeline

El V5 presenta la percepción como “clasificación (InceptionV3) y segmentación (Mask R-CNN)”, lo que sugiere clasificar la imagen completa y segmentar después. La implementación de la Opción B hace lo contrario:

1. Mask2Former propone las máscaras de todas las instancias.
2. Cada máscara se recorta.
3. Inception-V4 clasifica cada recorte.
4. La clase y la máscara se combinan en un `Segment`.

Este orden tiene tres ventajas prácticas. Primero, el clasificador recibe una región aislada y no el plato completo con fondo, otros alimentos y decoración. Segundo, evita asignar una sola clase a una imagen con varios alimentos. Tercero, produce las máscaras que necesita el módulo de volumen. En la Opción A, YOLO26-seg hace segmentación y clasificación conjuntamente, pero mantiene la misma lógica: primero la instancia, después la clase.

{imagen: orden_pipeline_corregido.png}

#### I.2 Sustituciones de modelos

La Tabla 20 resume los cambios entre la propuesta del V5 y la implementación.

**Tabla 20. Propuesta inicial frente a implementación.**

| Componente | Propuesta V5 | Implementación | Motivo del cambio | Evidencia |
|---|---|---|---|---|
| Orden del pipeline | Clasificar y luego segmentar | Segmentar y luego clasificar cada recorte (B); conjunta en A | El clasificador recibe una región aislada; la máscara alimenta el volumen | V.C |
| Clasificación | InceptionV3 | Inception-V4, MobileNetV3 y CNN propia | Tres alternativas de coste/precisión; disponibilidad en `timm` | C1–C3 |
| Segmentación | Mask R-CNN | Mask2Former Swin-tiny y YOLO26-seg | Segmentación de instancias; versión agnóstica y con clases; perfil ligero | A1/A2/A4/B1/B2/B4 |
| Profundidad | MiDaS | Depth Anything V2 Metric Indoor Small | Salida métrica en metros; interiores; coste de producción | V.D |
| Volumen | Máscara + profundidad | Pinhole + plano RANSAC + escala con plato | Referencia física y corrección del sesgo de primer plano | V.D |
| Nutrición | TCAC/USDA | USDA FoodData Central + densidad | 323 clases, 219 columnas y densidad por clase | V.E |
| LLM | Gemini con objetivos e historial | Gemini Flash Lite, solo plato actual | Alcance del producto; consejo breve y trazable | V.F |
| Aplicación | Arquitectura conceptual | Angular + Django REST + Modal + Neon + R2 | Producto desplegado de extremo a extremo | V.G |

Las sustituciones no se hicieron para “ganar” a las arquitecturas del V5. Se hicieron porque el sistema necesitaba una salida métrica, máscaras de instancia, un perfil ligero y un despliegue viable. No se ejecutó un benchmark controlado de Inception-V4 contra InceptionV3, de Mask2Former contra Mask R-CNN ni de Depth Anything V2 contra MiDaS. Por tanto, la formulación correcta es **“se actualizó”**, no **“se demostró que es mejor”**.

{imagen: sustituciones_modelos.png}

#### I.3 Cambios de alcance en Gemini

El V5 proponía que Gemini interpretara objetivos del usuario, historial y contexto. La implementación actual se limita a un consejo de tres oraciones sobre el plato actual. No usa historial, no conoce objetivos dietéticos y no recibe la imagen. Es una reducción de alcance deliberada para mantener el consejo breve, barato y auditable. La arquitectura deja espacio para ampliarlo, pero esa ampliación no forma parte de esta versión.

#### I.4 Qué se mantiene

A pesar de los cambios, la arquitectura conceptual se mantiene:

- La separación en cuatro etapas: percepción, profundidad/volumen, mapeo nutricional y razonamiento.
- La idea de que el LLM no calcula calorías ni volumen.
- El uso de un JSON estructurado como contrato entre medición y lenguaje.
- La aplicación web como producto final, no solo como demostración.
- La separación entre segmentación agnóstica y clasificación, aunque el orden se haya corregido.

#### I.5 Qué haría falta para afirmar una mejora

Para convertir estos cambios en una comparación experimental rigurosa haría falta:

| Afirmación | Baseline necesario | Estado |
|---|---|---|
| Inception-V4 es mejor que InceptionV3 | Mismos splits, resolución y presupuesto de entrenamiento | No realizado |
| Mask2Former es mejor que Mask R-CNN | Mismos splits, backbone y resolución | No realizado |
| Depth Anything V2 es mejor que MiDaS | Mismas escenas y protocolo de escala métrica | No realizado |
| USDA es mejor que TCAC | Mismas clases y cobertura nutricional | No realizado; la cobertura es distinta |
| A+C es mejor que B | P1 end-to-end con las mismas imágenes | No construido; la comparación es por piezas |

Estas comparaciones son trabajo futuro, no resultados de esta versión. La Tabla 20 debe leerse como una tabla de decisiones de ingeniería, no como una tabla de superioridad.

#### I.6 Implicaciones para el documento

La sección IV del V5 debe corregirse para que la arquitectura propuesta y la implementada no se contradigan. En concreto:

- El orden debe ser **segmentar → clasificar**, no al contrario.
- Las arquitecturas deben actualizarse a Inception-V4, Mask2Former/YOLO26-seg y Depth Anything V2.
- Debe explicarse que MiDaS no se descartó por ser inferior, sino porque su salida no es métrica.
- Debe aclararse que la comparación con las arquitecturas originales no es experimental.

Esta sección V.I cumple esa función: deja constancia del cambio, lo justifica y evita que el lector interprete el avance como una implementación literal del V5.

#### I.7 Qué establece esta sección

Esta sección establece que el proyecto evolucionó respecto al diseño inicial, pero de forma explícita y defendible. El orden segmentar → clasificar es una corrección necesaria; las sustituciones de modelos son decisiones de ingeniería; la reducción del alcance de Gemini es una decisión de producto. Nada de esto se presenta como una mejora demostrada frente a InceptionV3, Mask R-CNN o MiDaS, porque esas comparaciones no se hicieron. El valor del avance está en el sistema completo, no en una supuesta superioridad aislada de cada modelo.


---

### J. Limitaciones y trabajo pendiente

El sistema funciona de extremo a extremo, pero sus resultados deben leerse dentro de un alcance concreto. Esta sección separa las limitaciones técnicas, las metodológicas y las de producto, y termina con una lista priorizada de trabajo pendiente. La intención no es debilitar el avance, sino delimitar qué se puede afirmar y qué queda abierto.

{imagen: mapa_limitaciones_pipeline.png}

#### J.1 Limitaciones técnicas

**Profundidad y volumen**

- La profundidad monocular tiene ambigüedad de escala. Depth Anything V2 es métrico, pero en primeros planos sigue necesitando el plato como referencia.
- Si el plato no se detecta, el pipeline usa una distancia típica o deja la profundidad original; el volumen puede desviarse.
- El volumen es **aparente**: no reconstruye caras ocultas, huecos internos ni alimentos tapados.
- Un plano de mesa mal ajustado puede producir volúmenes irreales. Los topes de cordura evitan los casos extremos, pero no sustituyen una medición.
- La validación de profundidad y volumen se apoya en una sola foto con pesos conocidos; no es un benchmark.

**Percepción**

- El desbalance de clases es fuerte: 215 clases tienen menos de cinco anotaciones en validación y 28 no aparecen. Las métricas por clase con pocas instancias son ruidosas.
- La foto de prueba muestra confusiones reales: el plátano se detecta como pollo y la patata como ensalada caprese. La app permite corregirlo, pero la corrección depende del usuario.
- B4 no guardó `matched_cls`; la comparación fina de clase sobre instancias emparejadas solo está disponible para B1 y B2.
- Las resoluciones no son homogéneas: A4/B4 usan 640/224 px y A1/B1 usan 640 px frente a A2/B2 con 224 px. Las latencias no son directamente comparables.
- Las máscaras de referencia son los polígonos originales, que son toscos. AP75 y AP pueden penalizar un contorno visualmente bueno solo porque no coincide con el polígono.

**Nutrición**

- 43 clases usan densidades geométricas calculadas, no medidas, con una incertidumbre estimada de ±15–20 %.
- Quedan 48 filas pendientes de revisión técnica.
- Algunas entradas Foundation tienen pocos micronutrientes reportados; en unas veinte clases faltan vitaminas y minerales.
- Las recetas asignan cero cuando un ingrediente no reporta un nutriente; esto puede subestimar micronutrientes.
- Hay proxies para clases sin equivalente exacto en USDA.
- La tabla colombiana TCAC no se integró; la fuente principal es USDA FoodData Central.

**Pipeline y producto**

- El pipeline P1 (A+C end-to-end) no se construyó. La comparación de perfiles es por piezas, no un pipeline completo.
- La app depende de la cámara y del navegador; las APIs de orientación no están disponibles en todos los dispositivos.
- No hay funcionamiento offline ni aplicación nativa.
- El *cold start* de Modal puede alargar el primer análisis.
- Las imágenes se retienen 72 h y los análisis 30 días; los análisis antiguos se abren sin foto.
- Gemini no usa historial ni objetivos; el consejo se limita al plato actual.

#### J.2 Limitaciones metodológicas

- El test es propio: se reservó un 10 % de train, no es el test oficial de AIcrowd. La validez externa queda limitada al protocolo definido.
- En la ejecución revisada, `run_duplicate_check=False`; no se verificó la existencia de casi-duplicados entre train y test.
- No se hizo una comparación controlada contra InceptionV3, Mask R-CNN o MiDaS. Las sustituciones son decisiones de ingeniería, no mejoras demostradas.
- No hay estudio con usuarios ni evaluación formal de usabilidad.
- No hay validación clínica ni nutricional con especialistas; el sistema no es un dispositivo médico.
- La comparación de perfiles no es un P1 end-to-end; no mide el coste real de combinar A y C sobre máscaras predichas.
- La validación de profundidad y volumen con una sola escena no permite estimar el error en otras cámaras, platos, iluminaciones o ángulos.

#### J.3 Impacto y mitigación

La Tabla 21 relaciona cada limitación con su impacto y con la mitigación actual o pendiente.

**Tabla 21. Limitaciones, impacto y mitigación.**

| Limitación | Impacto | Mitigación actual | Trabajo pendiente |
|---|---|---|---|
| Ambigüedad de escala en profundidad | Error en cm³ y, por tanto, en gramos | Plato de 26 cm, fallback y topes de cordura | Validar con más escenas y cámaras |
| Confusión de clases | Densidad incorrecta y peso desviado | Corrección manual en la app | Mejorar clasificador y revisar clases raras |
| Densidades geométricas | ±15–20 % de error en 43 clases | Marcadas como cálculo, no medición | Medir una porción real y sustituir el valor |
| 48 filas sin revisión técnica | Riesgo de nutrientes o densidades mejorables | Cola de revisión documentada | Cerrar la revisión con especialista |
| B4 sin `matched_cls` | Comparación de clase incompleta | Se reportan B1 y B2 | Recalcular B4 |
| P1 no construido | No se puede afirmar que A+C supere a B | Comparación por piezas | Construir P1 y evaluarlo con las mismas imágenes |
| Test propio sin control de duplicados | Validez externa limitada | Split fijo y estratificado | Ejecutar control de casi-duplicados y, si es posible, test oficial |
| Sin estudio de usuarios | No se conoce la usabilidad real | Validación funcional manual | Estudio con usuarios |
| Sin validación clínica | No es un dispositivo médico | Lenguaje informativo y avisos | Validación con nutricionistas |

{imagen: prioridades_trabajo_futuro.png}

#### J.4 Trabajo pendiente priorizado

La Tabla 22 ordena el trabajo pendiente por prioridad.

**Tabla 22. Trabajo pendiente.**

| Prioridad | Tarea | Por qué |
|---|---|---|
| P0 | Recalcular `matched_cls` de B4 | Cierra la comparación de clase de la familia B |
| P0 | Construir y evaluar P1 (A+C end-to-end) | Es la comparación central entre propuesta 1 y propuesta 2 |
| P0 | Cerrar la revisión técnica de las 48 filas | Reduce el riesgo nutricional del producto |
| P1 | Validar profundidad/volumen en más escenas | Convierte una prueba de concepto en una evaluación |
| P1 | Medir o validar las 43 densidades geométricas | Reduce el error de las clases con densidad calculada |
| P1 | Comparar con InceptionV3, Mask R-CNN y MiDaS | Permite afirmar mejoras, no solo cambios |
| P2 | Estudio de usabilidad y validación nutricional | Evalúa el producto, no solo el modelo |
| P2 | Mejorar cold start y experiencia móvil | Reduce fricción de uso |
| P2 | Publicar artefactos reproducibles | Facilita revisión y replicación |

#### J.5 Qué establece esta sección

Esta sección establece que las limitaciones son conocidas, acotadas y rastreables. El sistema no se presenta como un instrumento de medida ni como un dispositivo clínico; se presenta como un prototipo funcional con un pipeline auditable, una app desplegada y una lista concreta de mejoras. Las limitaciones no invalidan el avance: definen su alcance y marcan el camino para convertirlo en un producto más fiable.


---

### K. Conclusión del avance

El proyecto pasó de una revisión del estado del arte y una arquitectura conceptual a un sistema desplegado que analiza una foto de un plato, estima volumen y peso, consulta una tabla nutricional y devuelve un consejo breve. El avance no es una implementación literal del V5: es una implementación modular que conserva su filosofía, corrige el orden del pipeline y actualiza las piezas de percepción con decisiones de ingeniería documentadas.

{imagen: resumen_visual_avance.png}

#### K.1 Síntesis de lo construido

La arquitectura final mantiene cuatro responsabilidades separadas:

1. **Percepción:** segmentar primero y clasificar después, con Mask2Former/YOLO26-seg y una familia de clasificadores.
2. **Geometría:** profundidad métrica con Depth Anything V2, escala con el plato, plano RANSAC y volumen aparente.
3. **Nutrición:** mapeo de 323 clases a USDA FoodData Central, con densidad y composición por 100 g.
4. **Razonamiento:** Gemini como capa fina que interpreta el JSON estructurado y no recalcula la medición.

La app Angular, la API Django, la inferencia Modal, la base Neon y el almacenamiento R2 completan el sistema. No es solo un cuaderno de experimentos: es un producto funcional con autenticación, captura guiada, historial, corrección de resultados y borrado.

#### K.2 Hallazgos principales

La Tabla 23 resume las contribuciones y la evidencia que las sostiene.

**Tabla 23. Contribuciones y evidencia.**

| Contribución | Evidencia | Estado |
|---|---|---|
| Sistema de extremo a extremo | App desplegada, V.G y V.H | Funcional |
| Orden segmentar → clasificar | V.C; nueve experimentos | Implementado |
| Profundidad métrica y volumen | V.D; foto de prueba | Validado en una escena |
| Mapeo nutricional de 323 clases | V.E; 323/323 con densidad | Completo, con revisión pendiente |
| Gemini como capa de razonamiento | V.F; prompt y fallback | Implementado, alcance limitado |
| Comparación por perfiles | V.C y V.H; cuaderno 99 | Completa; P1 pendiente |

Los resultados permiten defender tres ideas. Primera, **A4 es la mejor opción cuando prima la máscara** y **B4 la mejor cuando prima un único modelo integrado y barato**. Segunda, **C2 es la mejor relación coste/precisión** y C3 solo mejora marginalmente el macro-F1 con nueve veces más parámetros. Tercera, el perfil robusto mejora el AP50 de A en **+0,102** y el AR100 en **+0,192** respecto al ligero, pero añade **+81,3 M** de parámetros y **+115,2 ms** a la pareja A+C; el salto está en la segmentación, no en el clasificador.

En la foto de prueba, la profundidad monocular pasa de una mediana de **1,58 m** a **≈0,30 m** tras la escala con el plato. El cerdo queda en **190,6 g** frente a **163 g** reales (**+17 %**), y el total detectado es **351,3 g** frente a **302 g** reales. El plátano y la patata se confunden de clase, pero la app permite corregirlos sin repetir la medición: el total corregido queda en **358,4 g**.

El mapeo nutricional cubre **323/323 clases** con densidad, **316/323** con coherencia energética y **18/20** en la verificación manual. Sus límites —43 densidades geométricas, 48 filas pendientes y cobertura irregular de micronutrientes— quedan explícitos.

{imagen: contribuciones_principales.png}

#### K.3 Qué aporta el avance

El valor del trabajo no está en un modelo aislado, sino en la **integración auditable**:

- Separa la medición geométrica del lenguaje, de modo que el peso y las calorías no dependen de un LLM.
- Usa el plato como referencia física para corregir la ambigüedad de la profundidad monocular.
- Permite cambiar la clase de un alimento sin recalcular el volumen.
- Deja una comparación empírica dentro de la implementación, con métricas, perfiles y artefactos reproducibles.
- Documenta las diferencias con el V5 y evita afirmar mejoras que no se demostraron.

#### K.4 Alcance y límites

El sistema es un **prototipo funcional**, no un instrumento de medida ni un dispositivo clínico. Quedan abiertos el P1 end-to-end, el `matched_cls` de B4, la revisión de 48 filas del mapeo, la medición de 43 densidades geométricas, las comparaciones controladas contra InceptionV3/Mask R-CNN/MiDaS y la validación con más escenas y usuarios. La sección V.J detalla cada punto y prioriza el trabajo.

#### K.5 Cierre

El avance se puede resumir así: el proyecto ya tiene un pipeline completo, una app desplegada, una comparación reproducible y un conjunto de recursos que explican cómo se obtienen los resultados. No pretende haber resuelto la estimación perfecta de porciones; pretende haber construido un sistema modular, medible y honesto sobre lo que puede y no puede afirmar. Ese es el paso que separa una propuesta de estado del arte de un prototipo de ingeniería.


---

### L. Publicación de artefactos en GitHub

La publicación de artefactos es parte de la reproducibilidad, pero no todo lo que se usó puede hacerse público. El repositorio debe permitir que otra persona entienda el pipeline, ejecute los cuadernillos y reproduzca las tablas sin exponer pesos, secretos, imágenes personales ni datos cuya licencia no lo permita.

#### L.1 Criterios de publicación

Un artefacto se publica si cumple cuatro condiciones:

1. **Es pequeño** y no obliga a usar Git LFS para el flujo normal.
2. **Es reproducible** sin depender de archivos privados.
3. **No contiene secretos** ni datos personales.
4. **Su licencia permite redistribuirlo** o se publica solo la referencia.

La Tabla 24 resume la decisión por tipo de artefacto.

**Tabla 24. Artefactos: qué publicar y qué no.**

| Artefacto | ¿Publicar? | Condición |
|---|---|---|
| Cuadernillos de experimentos | Sí | Limpiar salidas pesadas; no incluir rutas privadas |
| Cuaderno 99 de comparación | Sí | Mantener las salidas o limpiarlas; no incluir secretos |
| CSVs y figuras de `comparacion/` | Sí | Son pequeños y reproducibles |
| Recursos visuales (PNG, HTML, README) | Sí | Verificar la licencia de la foto de prueba |
| README del mapeo nutricional | Sí | Citar USDA, FAO/INFOODS y la tabla 4.2 |
| `nutrition_wide_densidad.csv` | Sí | Atribución a USDA; no relicenciar como dato propio |
| `crops_{train,val,test}.csv` | Opcional | Solo metadatos; revisar rutas y datos personales |
| `datos_visuales.npz` | Opcional | Contiene la foto de prueba; publicar solo con consentimiento |
| Pesos `.pt` / `.pth` / `.onnx` | No | Van al Volume de Modal o a Drive |
| Imágenes y anotaciones del dataset | No | Depende de la licencia de Food Recognition 2022 |
| Fotos de usuarios | No | Privacidad |
| `.env`, claves, secretos | No | Seguridad |
| `presentación/` completo | No | 5,8 GB con pesos y runs |

#### L.2 Qué publicar

La publicación mínima recomendada es:

- `00_datos_food_recognition_v4_sam2.ipynb` y los nueve cuadernillos canónicos.
- `99_comparacion_resultados.ipynb`.
- Los CSV y figuras de `presentacion/calorie_counter/comparacion/`.
- `presentacion/tests/Recursos_visuales/` completo, salvo la foto si no hay consentimiento.
- `presentacion/README_mapeo nutricional.md`.
- `ml/data/nutrition_wide_densidad.csv` y `ml/data/food_names_es.csv`.
- Los scripts de generación de figuras y comparación.
- `ml/tests/test_core.py`.

Los cuadernillos deben conservar el orden de ejecución y las instrucciones para colocar los pesos. Si se limpian las salidas, conviene dejar un `README` con los resultados esperados y capturas de las tablas principales.

#### L.3 Qué no publicar

- **Pesos:** `.pt`, `.pth`, `.onnx`, `.safetensors`. Ya están en `.gitignore`; se cargan desde Modal o Drive.
- **Secretos:** `.env`, `MODAL_SHARED_SECRET`, claves de R2, `GEMINI_API_KEY`, `USDA_API_KEY`.
- **Dataset original:** imágenes y anotaciones de Food Recognition 2022 si su licencia no permite redistribución; se enlaza la fuente y se explica cómo descargarla.
- **Fotos personales:** la foto `34g_platano_163cerdo_105papa.jpg` es una foto del autor; para publicarla hace falta consentimiento o sustituirla por una imagen con licencia.
- **Runs y predicciones:** `runs/`, `predicciones/`, `predicciones_pilot/` y los JSON gigantes de predicciones pueden pesar cientos de MB; no son necesarios para reproducir las tablas.
- **El árbol completo de `presentación/`:** incluye pesos, runs y datos locales.

#### L.4 Organización recomendada

En lugar de publicar `presentación/` tal cual, conviene una carpeta `research/` o `docs/` con esta estructura:

```text
research/
├── README.md
├── notebooks/
│   ├── 00_datos_food_recognition_v4_sam2.ipynb
│   ├── A1_...ipynb
│   ├── ...
│   └── 99_comparacion_resultados.ipynb
├── comparison/
│   ├── resumen.csv
│   ├── perfiles_resumen.csv
│   └── figuras...
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

Recomendaciones:

- Limpiar las salidas de los cuadernos con `nbstripout` o exportar a HTML si se quiere conservar la evidencia visual.
- Si se necesitan salidas grandes, usar Git LFS, pero no para los pesos.
- Actualizar `.gitignore` para excluir `presentación/calorie_counter/runs/`, `predicciones/`, `predicciones_pilot/` y `*.pt`.
- Evitar rutas absolutas de Colab o Drive en los cuadernos publicados.

{imagen: estructura_repositorio_publico.png}

#### L.5 Licencias y atribución

- **Código:** elegir una licencia permisiva, por ejemplo MIT o Apache-2.0.
- **Documentación y figuras:** se puede usar CC BY 4.0, indicando la autoría.
- **USDA FoodData Central:** es de dominio público; citar la fuente y la fecha de consulta.
- **FAO/INFOODS y tabla 4.2:** citar la fuente en el README del mapeo.
- **Food Recognition 2022:** respetar los términos del dataset; no relicenciar sus imágenes como si fueran propias.
- **Foto de prueba:** obtener consentimiento o sustituirla por una imagen con licencia explícita.

No se debe relicenciar el dataset original ni la tabla USDA como si fueran datos propios. La licencia del repositorio cubre el código y la documentación, no los datos de terceros.

#### L.6 Reproducibilidad

El `README` del repositorio debe explicar:

1. Dependencias de `ml`, `backend` y `frontend`.
2. Dónde colocar los pesos (`MODELS_DIR` o Volume de Modal).
3. El orden de ejecución: `00_datos` → cuadernillos A/B/C → `99_comparacion` → `generar_recursos.py`.
4. Cómo regenerar las figuras sin GPU.
5. Qué resultados se esperan y dónde se guardan.
6. Qué artefactos no se incluyen y por qué.

#### L.7 Checklist antes de publicar

- [ ] No hay `.env`, claves ni secretos en el historial.
- [ ] No hay fotos personales sin consentimiento.
- [ ] Los pesos están excluidos.
- [ ] Los cuadernillos no tienen rutas privadas.
- [ ] La licencia del código y de la documentación está clara.
- [ ] USDA, FAO/INFOODS y la tabla 4.2 están citados.
- [ ] El `README` explica el orden de ejecución.
- [ ] Las figuras y tablas se regeneran con los scripts.
- [ ] El repositorio no supera el tamaño razonable para GitHub.
- [ ] Los datos de terceros no se relicencian.

{imagen: checklist_publicacion.png}

#### L.8 Qué establece esta sección

Esta sección establece que la reproducibilidad no consiste en subir todo, sino en publicar lo necesario con las condiciones adecuadas. Los cuadernillos, la comparación, los recursos visuales y el mapeo pueden ser públicos; los pesos, secretos, fotos personales y datasets con licencia restrictiva no. Con esta separación, el repositorio queda útil para revisión y replicación sin comprometer privacidad, seguridad ni licencias.


---

## Orden de trabajo propuesto

1. **V.A** — Visión general y stack.
2. **V.B** — Datos y preprocesamiento.
3. **V.C** — Percepción visual y corrección del orden segmentar → clasificar.
4. **V.D** — Profundidad, escala con plato y justificación de Depth Anything V2.
5. **V.E** — Mapeo nutricional.
6. **V.F** — Gemini.
7. **V.G** — Aplicación y despliegue.
8. **V.H** — Validación y recursos.
9. **V.I** — Cambios frente a la propuesta.
10. **V.J** — Limitaciones y pendientes.
11. **V.K** — Conclusión.
12. **V.L** — Publicación en GitHub.

V.A queda en inglés; V.B–V.L están en español, pendientes de traducción antes de pegarlas en `InvestigaciónV5.docx`.
