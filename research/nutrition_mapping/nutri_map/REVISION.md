# Informe de revisión del mapeo nutricional (323 clases)

## Resumen

- **Cobertura:** 323 de 323 clases con decisión final.
  - 235 `ok` (se acepta el borrador de DeepSeek).
  - 73 `cambiar` (se usa otro id de USDA).
  - 15 `receta` (plato compuesto calculado con `recetas.csv`).
- **Entradas USDA:** 308 clases. **Recetas:** 15 clases.
- **Borrador de DeepSeek V4 Pro:** 88 de 323 filas (27 %) cambiaron al revisarlas (15 recetas, 73 cambios de id). En 6 filas el borrador estaba vacío.
- **Confianza de mis decisiones:** 176 alta, 124 media, 23 baja.
- **Filas para segunda revisión técnica:** 48 (ver `revision_tecnica.csv`).
- **Densidades:** 323/323 con valor. 203 medidas de volumen USDA, 60 de tablas publicadas, 2 referencias físicas, 43 por cálculo geométrico y 15 por receta. Ninguna pendiente de pesar; las 43 geométricas no son mediciones (ver sección «Densidades: cobertura de fuentes»).
- **Medición de error:** medida sobre el lote de 20 filas verificado con asistencia de un LLM: **2 errores en 20 (10 %; IC 95 %: 2,8 %–30,1 %)**. Ambos se corrigieron y el resto de la tabla se recalculó.

## Modelo y proceso

- **Nota de alcance:** la revisión de las 323 filas y la verificación de las 20 filas se hicieron con asistencia de un LLM, bajo criterios aprobados por los autores. No constituyen una auditoría humana independiente.
- Un modelo (DeepSeek V4 Pro, `deepseek-v4-pro`, `temperature=0`) propuso candidatos de USDA para las 323 clases. Ninguna respuesta fue inválida.
- Revisé las 323 filas con los candidatos de USDA y el criterio aprobado:
  1. Se mapea al estado en que se consume (cocido para verduras y carnes que se comen cocidas; crudo para ensaladas y fruta).
  2. Si la clase dice "sin sal" o "sin aderezo", se respeta.
  3. Compuestos: receta estándar por 100 g de plato listo, con porción típica.
  4. Categorías genéricas: preparación típica de consumo.
  5. Entre dos candidatos válidos, el más genérico.
- Validación: kcal frente a 4·proteína + 4·(carbohidratos − fibra) + 2·fibra + 9·grasa.

## Errores encontrados y corregidos

1. **Búsqueda sin la entrada correcta** (remolacha): se añadió una consulta con el nombre original de la clase y la entrada se corrigió a mano.
2. **Compuesto aceptado automáticamente** (ensalada con aguacate, 54 kcal frente a ~20 kcal de la receta): ahora ninguna fila se acepta sin revisión.
3. **Estado incorrecto** (crudo en vez de consumido): 71 cambios en carnes, pescados, pastas, arroces, legumbres y verduras.
4. **Entradas Foundation incompletas** (sin proteína, grasa ni carbohidratos): toronja, pasas, pan, mayonesa y salchichón. Se reemplazaron por entradas SR Legacy (6 filas).
5. **Bug de energía en recetas:** los ingredientes que solo traen energía Atwater (957/958) contaban como 0 kcal. Birchermuesli salía −20 % y salsa de champiñones −132 %. Corregido.
6. **Inconsistencia de decisiones:** 7 filas con `ok` apuntaban a un id distinto al borrador (el sistema habría tomado el borrador). Se convirtieron en cambios explícitos.
7. **Marcas:** DiGiorno se sustituyó por pizza genérica. Nutella/Caotina y Coca-Cola se tradujeron a categorías genéricas.
8. **Bebida de glucosa** (0,12 g de carbohidratos en la entrada de USDA): pasó a receta (azúcar + agua).
9. **Dos errores de estado/categoría detectados en la verificación de 20 filas:** `spring_roll_fried` usaba la versión sin freír (112 kcal) y `bread_grain` usaba grano crudo seco (371 kcal). Corregidos a 172105 (214 kcal) y 168013 (265 kcal).

## Validación de coherencia kcal frente a macronutrientes

- **316 de 323** cumplen la coherencia (tolerancia ±15 %).
- **5 vinos, cerveza y Aperol:** diferencia esperada, porque la fórmula de Atwater no incluye el alcohol (7 kcal/g). No son errores de datos.
- **2 agua:** 0 kcal, correcto.

## Filas para segunda revisión técnica (48)

Detalle completo en `revision_tecnica.csv`. Criterios: confianza baja, recetas, proxies o aproximaciones y incoherencias explicadas.

**Confianza baja (23):**

| idx | Clase | Decisión | id | Motivo |
|---|---|---|---|---|
| 13 | leaf_spinach | ok | 168462 | Clase ambigua: cruda o cocida |
| 35 | shoots_n_s | ok | 169210 | Brotes de bambú; estado y uso poco claros |
| 94 | grits_polenta_maize_flour | ok | 169697 | Polenta: solo hay versión seca |
| 103 | bread_fruit | ok | 171714 | Fruta del pan normalmente cocida |
| 126 | tuna | cambiar | 172006 | Atún cocido genérico; yellowfin como aproximación |
| 146 | aperitif_with_alcohol (Aperol spritz) | cambiar | 2710674 | Sin entrada de Aperol; ponche alcohólico |
| 164 | spring_roll_fried | cambiar | 172105 | Corregido: proxy de rollito frito (egg roll vegetal); no hay spring roll frito en USDA |
| 166 | salt_cake_ch_vegetables_filled | receta | — | Pastel salado: ids y proporciones aproximados |
| 181 | birchermuesli | receta | — | Proporciones de muesli y yogur |
| 189 | french_pizza_from_alsace | receta | — | Tarte flambée: masa y cobertura aproximadas |
| 191 | porridge (leche semidesnatada) | receta | — | Proporción avena/leche |
| 198 | ham_raw | ok | 168222 | Jamón crudo curado; entrada de pierna cruda |
| 215 | pizza_with_ham_with_mushrooms | cambiar | 172095 | Pizza genérica con cobertura de carne |
| 228 | cordon_bleu | ok | 2706418 | Entrada de ternera; el original suele ser de cerdo |
| 239 | salad_lambs_ear | ok | 2709789 | Proxy: lechuga cruda |
| 240 | balsamic_salad_dressing | ok | 2710195 | Proxy: aliño genérico, no balsámico |
| 247 | pie_apricot | receta | — | Masa + albaricoque + azúcar |
| 248 | pie_plum | receta | — | Masa + ciruela + azúcar |
| 251 | mixed_milk_beverage | receta | — | Mezcla de leche, soja y avena |
| 258 | bread_grain | cambiar | 168013 | Corregido: pan multigrano; antes era grano crudo seco |
| 272 | sauce_mushroom | receta | — | Nata + champiñones + mantequilla |
| 302 | crunch_muesli | ok | 2708447 | Cereal crujiente como aproximación |
| 312 | meat_n_s | cambiar | 174034 | Carne genérica: res picada cocida |

**Recetas (15):** todas necesitan validación de proporciones. Ver también los nutrientes rellenados con 0 más abajo.

**Proxies y aproximaciones (21 en total, algunas ya listadas arriba):** en `revision_tecnica.csv`.

## Límites conocidos

- **Entradas Foundation con pocos nutrientes:** entre 11 y 58 nutrientes por entrada. Hay vitaminas y minerales que faltarán en unas 20 clases. Energía y macronutrientes sí están validados.
- **Recetas con nutrientes rellenados con 0:** si un ingrediente no reporta un nutriente, cuenta como 0. Eso afecta sobre todo a vitaminas y minerales. Por receta: entre 10 y 328 datos rellenados (ver log de ejecución).
- **Criterio de estado:** los 71 cambios de id dependen de la regla "estado de consumo". Si la regla no te convence, hay que revisar esas filas.
- **Decisiones no verificadas en fuentes externas:** dependen de las descripciones de USDA y de mi criterio. La verificación de 20 filas dio 2 errores; ambos corregidos, pero el resto sigue apoyado en el criterio y en la descripción de USDA, no en una comprobación externa.
- **Auditoría estadística limitada:** la tasa de error medida es 10 % (2/20), con un intervalo del 2,8 % al 30,1 %. Es una muestra pequeña: sirve para detectar el tipo de error, no para garantizar una precisión exacta.

## Archivos

| Archivo | Contenido |
|---|---|
| `review_queue_done.csv` | Decisiones finales para el cuadernillo |
| `decisiones_resumen.csv` | Decisión, id, confianza y nota por clase |
| `revision_tecnica.csv` | Las 48 filas para segunda revisión |
| `recetas.csv` | Los 15 compuestos con ingredientes y gramos |
| `validacion_coherencia.csv` | Validación kcal frente a macronutrientes |
| `nutrition_wide.csv`, `nutrition_long.csv`, `nutrient_dictionary.csv`, `nutrition_map.json` | Tablas finales de nutrientes |

## Verificación del lote de 20 filas (Muestreo)

Lote en `verificacion_20.csv`: 10 filas de confianza baja (mapeo USDA puro) y 10 recetas, revisadas con asistencia de un LLM, con las columnas `tu_veredicto_OK_o_ERROR` y `comentario`. Las columnas de nutrientes y densidad de ese CSV son una foto del **estado anterior** a las correcciones; los valores vigentes están en `nutrition_wide_densidad.csv`.

- **Resultado global:** 18 / 20 correctas (90 % de acierto), 2 / 20 errores (**10 % de tasa de error**; IC 95 % con Wilson: 2,8 %–30,1 %).
- **Por estrato:** confianza baja 2/10 errores (20 %; IC 95 %: 5,7 %–51,0 %); recetas y filas de confianza alta/media 0/10 errores (IC 95 %: 0 %–27,8 %).
- **Patrón:** los dos errores son del mismo tipo, **estado o categoría equivocada del alimento**, y ambos estaban marcados como confianza baja. Ningún error apareció en recetas, confianza alta o confianza media.

**Errores detectados y corregidos:**

| idx | Clase | Antes | Después | Efecto |
|---|---|---|---|---|
| 164 | `spring_roll_fried` | 2708704, rollito de papel de arroz **sin freír** (112 kcal) | 172105, egg roll vegetal frito (214 kcal) | +91 % de energía; era una subestimación grave |
| 258 | `bread_grain` | 2710830, grano de Khorasan **crudo y seco** (371 kcal) | 168013, pan multigrano (265 kcal) | −29 % de energía; era grano, no pan |

En 164 no existe ningún spring roll frito en USDA: se usó el rollito frito medido más cercano (egg roll vegetal) y quedó anotado como proxy. En 258 la clase es un pan (`bread-grain`), no un cereal en grano; se usó pan multigrano, que es la entrada genérica de esa categoría.

**Casos con duda especial que resultaron correctos:**

- `idx 103` (`bread_fruit`): **OK**. "Breadfruit" es la fruta del pan (*Artocarpus altilis*), no un pan de trigo.
- `idx 126` (`tuna`): **OK**. Atún amarillo cocido como proxy válido de la clase genérica.
- `idx 239` (`salad_lambs_ear`): **OK**. Lechuga cruda como proxy de hoja verde.
- `idx 215` (`pizza_with_ham_with_mushrooms`): **OK**. Pizza de carne genérica.

**Efecto en las tablas:** se regeneraron `review_queue_done.csv`, `nutrition_wide.csv`, `nutrition_long.csv`, `nutrition_map.json`, `densidad_alimentos.csv` y `nutrition_wide_densidad.csv`. La validación kcal frente a macros sigue en 316/323 coherentes (los 5 alcoholes y las 2 aguas explicados), y `revision_tecnica.csv` mantiene 48 filas, ahora con los ids corregidos.

**Lectura práctica:** el 90 % de acierto es aceptable para estimar nutrientes desde una foto, pero el 10 % de error se concentra en las filas de confianza baja. Para uso clínico o de investigación, `revision_tecnica.csv` es la lista que hay que revisar con un especialista antes de confiar en esas clases.

## Densidades: cobertura de fuentes (v4)

Objetivo: que la mayor parte de las 323 densidades venga de una medición publicada y no de una estimación. Orden de prioridad aplicado en `scripts/densidad.py`:

| Prioridad | Fuente | Clases |
|---|---|---|
| 1 | Medida de volumen de USDA/FNDDS (taza, cucharada, fl oz) | 203 |
| 2 | Tabla 4.2 *Density of Selected Foods*, *Engineering Properties of Foods* (p. 153) | 23 |
| 3 | FAO/INFOODS Density Database v2 (entrada concreta) | 33 |
| 4 | Otras tablas publicadas (USDA AMS para la patata, Engineering ToolBox) y proxy USDA (crema de frutos secos) | 4 |
| 5 | Referencia física de categoría (huevo, nata) | 2 |
| 6 | **Cálculo geométrico** (masa USDA / volumen de un sólido de dimensiones típicas) | **43** |
| 7 | Cálculo de mezcla sobre la receta | 15 |
| | **Total** | **323** |

**Valores aplicados desde la tabla 4.2:** carnes 1,055 g/cm³ (la tabla publica ρ = 1076 − 1,37·x_f para 5–20 % de grasa, es decir 1,05–1,07), pescado magro 1,055, manzana 0,85 (rango 0,775–0,925), pera 1,00 y queso 1,08–1,15 (rango 1,08–1,23; el extremo bajo para queso fresco y mozzarella). Las 11 frutas y hortalizas compactas sin valor por especie ya no usan 0,95: se calculan geométricamente (ver abajo).

**Correcciones de forma:** no se acepta una medida USDA cuando mide otra forma física que la clase (manzana entera frente a 1 cup en láminas, bloque de queso frente a rallado, hogaza frente a trozos sueltos, filete frente a pescado desmenuzado, loncha apilada frente a dados, pechuga entera frente a pollo picado). Están codificadas en la lista `NO_USDA` con su justificación y afectan a 23 clases.

**Las 43 clases sin densidad publicada** se completan con un cálculo geométrico, no con una estimación de categoría:

- 11 frutas/hortalizas compactas sin densidad por especie (alcachofa, pepinillo, pepino, rábano, ajo, piña, higo, caqui, kiwi, naranja, hinojo).
- 2 bayas a granel (arándanos, frambuesas).
- 30 platos compuestos o productos sin tabla de densidad: pizza (4), hamburguesa y hamburguesa vegetal, pancake, crepe, croissant (2), tarta (2), brownie, falafel, hojaldre, rollito de primavera, torrija, mousse, praliné, chocolate negro, biscote, bechamel, beicon, carne picada desmenuzada (3), queso blando de cabra (2), col lombarda y cecina.

Método: `ρ = m / V`. La masa `m` es la porción USDA de `nutrition_map.json`; si USDA no da porción, se usa una masa típica indicada en la tabla. El volumen `V` se calcula con la fórmula de un sólido nombrado (elipsoide, esfera, cilindro, prisma, cuña de pizza, cono o taza) y dimensiones comerciales o de porción típicas. **Las dimensiones no se midieron sobre la foto**: son tamaños típicos, y la incertidumbre estimada es ±15–20 %. Por eso el resultado es una densidad **calculada, no una medición**.

Las 43 están marcadas con `estado = calculada (geometría)`, `confianza = baja`, `estimada = no` y un `motivo` que empieza por `cálculo geométrico, NO medición` y detalla masa, forma, dimensiones y volumen. La tabla completa (idx, masa y origen, forma, V y ρ) está en `README.md`, sección «Densidades calculadas geométricamente (43)». Las 15 recetas se separan como `calculada (receta)`, porque su densidad sale de una fórmula explícita sobre ingredientes.

Los 43 valores quedaron entre 0,259 (croissant) y 1,164 g/cm³ (praliné). Se comprobaron contra el rango físico esperado (0,25–1,20) y contra los valores FAO de alimentos equivalentes; ninguno quedó fuera.
