# Recursos visuales · mapa de profundidad y estimación de peso

Estos recursos explican, con la **foto real de prueba** y el **pipeline real de la app (Opción B)**, cómo se pasa de una foto a un peso en gramos:

```
foto → Mask2Former (máscaras) → Inception-V4 (clases)
     → Depth Anything V2 métrico → escala con el plato (26 cm)
     → retroproyección 3D + plano RANSAC → volumen → peso y nutrición
```

Foto: `34g_platano_163cerdo_105papa.jpg` (1024×768 tras el preprocesado de la app).
Pesos reales anotados en el nombre: **34 g de plátano + 163 g de cerdo + 105 g de patata asada = 302 g**.

## Archivos

| Archivo | Qué muestra |
|---|---|
| `01_flujo_pipeline.png` | Infografía de los 7 pasos del pipeline, con miniaturas de foto, máscaras y profundidad. |
| `02_mapa_profundidad.png` | Foto con máscaras y plato, profundidad monocular en metros, profundidad corregida con el plato y altura sobre la mesa en cm. |
| `03_volumen_3d.png` | Superficie 3D de cada alimento (altura sobre la mesa) con su volumen y peso estimados. |
| `04_resultado_plato.png` | Resultado final sobre la foto + tarjeta con peso, volumen, densidad y calorías. |
| `05_pesos_vs_reales.png` | Comparación de peso: pipeline con la clase detectada, tras corregir la clase y peso real. |
| `06_deteccion_vs_correccion.png` | Lado a lado: lo que detecta el pipeline y lo que queda al cambiar la clase en la app. |
| `07_mapeo_flujo.png` | Cómo se construyó el mapeo nutricional: 323 clases → USDA → revisión → densidad → validación. |
| `08_mapeo_cobertura.png` | Cobertura y calidad: match, origen USDA, fuentes de densidad, confianza y límites. |
| `09_mapeo_ejemplo.png` | Tres clases reales (plátano, cerdo, patata) y el paso volumen × densidad → gramos. |
| `10_sesgo_primer_plano_small_vs_large.png` | Sesgo de escala en primer plano (38.5 cm vs 110-175 cm) en Depth Anything V2 Small vs Large. |
| `11_calibracion_escala_plato_hough.png` | Detección fiduciaria del plato por Hough circular y normalización métrica de profundidad. |
| `12_perfiles_relieve_3d_small_vs_large.png` | Corte transversal y resolución de microtopografía superficial (Small vs Large). |
| `13_paridad_gravimetrica_nutrition5k.png` | Dispersión gravimétrica sobre el benchmark Nutrition5k con banda clínica del ±15%. |
| `14_panel_comparativo_multimodal_plato.png` | Panel completo multimodal: RGB original, máscaras de segmentación, mapa 3D y desglose nutricional. |
| `en/` | Colección completa de las figuras 10 a 14 con textos, etiquetas y leyendas en inglés para publicación. |
| `profundidad_volumen_metricas.csv` | Métricas cuantitativas detalladas de distancia, MAE y masas predichas en Nutrition5k. |
| `resultado_pipeline_B.json` | Salida JSON completa del pipeline (la misma estructura que devuelve la app). |
| `segmentos.csv` | Tabla por segmento: clase, confianza, volumen, densidad, peso, altura, plano, corrección y peso real. |
| `datos_visuales.npz` | Arrays usados por las figuras (foto, profundidades, máscaras, mapas de altura). |
| `index.html` | Galería navegable con todas las figuras, la tabla de resultados y el resumen del pipeline. |
| `generar_recursos.py` | Regenera todo en dos procesos (modelos y figuras separados). |
| `generar_datos.py` | Ejecuta el pipeline y guarda los datos. |
| `generar_figuras.py` | Dibuja las figuras del pipeline a partir de los datos guardados. |
| `generar_mapeo.py` | Lee `nutrition_wide_densidad.csv` y dibuja las figuras 07–09 del mapeo nutricional. |

## Cómo se calcula el volumen

1. **Profundidad monocular.** Depth Anything V2 métrico devuelve `z_modelo(x, y)` en metros. En primeros planos el modelo sobreestima la distancia: en esta foto la mediana es **1,58 m** cuando el plato está a unos **30 cm**.
2. **Escala con el plato.** Se detecta el borde del plato (Hough, 26 cm de diámetro). Con geometría pinhole:

   ```text
   z_plato = f_px · D_plato / (2 · r_plato)
   k       = z_plato / z_modelo
   z_real  = k · z_modelo
   ```

   En esta foto: `k = 0,188`; la mediana corregida baja a **~0,30 m**.
3. **Retroproyección 3D.** Cada píxel se lleva a coordenadas de cámara con el modelo pinhole:

   ```text
   P = z_real · ((x - cx)/f, (y - cy)/f, 1)
   ```

4. **Plano de apoyo.** Se ajusta un plano `n·P = d` con RANSAC usando el anillo de mesa alrededor de la comida (sin incluir ninguna máscara de alimento).
5. **Altura y volumen.** Para cada píxel de la máscara:

   ```text
   h     = clip(n·P - d, 0, 20 cm)
   A_px  = z_real² / (f² · |n·d|)
   V     = Σ h · A_px
   ```

6. **Peso y nutrición.**

   ```text
   peso_g = V · densidad_g_cm3
   kcal   = peso_g / 100 · kcal_100g
   ```

Es un **volumen aparente**: solo mide lo que se ve desde la cámara. El plato es la referencia de escala; sin plato fiable, el pipeline avisa y acota la distancia.

## Resultado de esta foto

El pipeline detectó 3 segmentos, pero confundió dos clases: el plátano salió como **pollo** y la patata como **ensalada caprese**. La app permite cambiar la clase sin repetir la medición: el volumen no cambia, solo la densidad.

| Segmento | Clase detectada | Volumen | Peso detectado | Clase corregida | Peso corregido | Peso real |
|---|---|---:|---:|---|---:|---:|
| izquierdo | pollo | 97,9 cm³ | 103,2 g | plátano | 77,6 g | 34 g |
| central | cerdo | 234,7 cm³ | 190,6 g | cerdo | 190,6 g | 163 g |
| inferior | ensalada caprese | 85,1 cm³ | 57,5 g | patata asada | 90,2 g | 105 g |
| **total** | | **417,6 cm³** | **351,3 g** | | **358,4 g** | **302 g** |

- El **cerdo** es el caso bueno: 190,6 g frente a 163 g reales (**+17 %**).
- El plátano y la patata sí se confunden de clase; aun así, la corrección manual deja el total en **358 g** frente a 302 g.
- El volumen del plátano está sobreestimado (97,9 cm³ para 34 g), probablemente porque la máscara incluye parte del borde/brillo del plato. Es el segmento más difícil de esta foto.

## Mapeo nutricional (figuras 07–09)

El detalle completo está en [`../README_mapeo nutricional.md`](../README_mapeo%20nutricional.md).

El mapeo asigna a cada una de las **323 clases** un alimento de USDA FoodData Central, sus nutrientes por 100 g y una densidad (g/cm³). Se revisaron las 323 filas a mano en 7 lotes (88 cambios respecto al borrador) y se validó la coherencia energética y una muestra de 20 clases.

- **Match:** exacto 183, manual 73, close 41, receta 15, proxy 10, composite 1.
- **Origen USDA:** SR Legacy 172, Survey (FNDDS) 111, Foundation 25, receta 15.
- **Densidad:** medida USDA 203, tabla publicada 60, cálculo geométrico 43, receta 15, referencia de categoría 2.
- **Calidad:** 173 densidades de confianza alta, 92 media y 58 baja; 316/323 filas con coherencia energética; 18/20 en la verificación manual; 48 filas pendientes de revisión técnica.

La figura 09 usa los volúmenes medidos en la foto para los tres alimentos: plátano 97,9 cm³ × 0,793 = 77,6 g; cerdo 234,7 × 0,812 = 190,6 g; patata 85,1 × 1,060 = 90,2 g.

## Regenerar

Desde la raíz del repositorio, con el entorno de `ml` que tenga `torch`, `transformers`, `timm`, `opencv-python-headless` y los pesos en la raíz:

```powershell
python presentación/tests/Recursos_visuales/generar_recursos.py
```

El script ejecuta `generar_datos.py` (modelos, profundidad, máscaras, volúmenes) y después `generar_figuras.py` en otro proceso, para que matplotlib no comparta memoria con los modelos. En CPU tarda unos segundos; no necesita GPU.

## Notas

- La foto es difícil a propósito: tres alimentos, uno grande y dos pequeños, con brillos y salsa. Sirve para enseñar **cómo funciona la geometría**, no como benchmark de precisión.
- El pipeline de la app es la **Opción B** (`mask2former_agnostic.pt` + `inception_v4_food323.pt`) + Depth Anything V2 *Metric Indoor Small*.
- Las cifras de profundidad y volumen dependen del plato detectado; si el plato no se detecta, el pipeline cambia a una distancia típica y añade una advertencia.
