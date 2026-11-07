# Mapeo nutricional de las 323 clases (Calorie Counter)

Este mapeo asigna a cada clase del dataset (`classes.json`) un alimento de la base **USDA FoodData Central**, con todos sus nutrientes por 100 g, su **densidad** (g por cm³) y, cuando aplica, su composición por **receta** (platos compuestos).

Con él se puede pasar de lo que se ve en la foto (volumen en cm³ o porciones) a **gramos, calorías y macronutrientes**.

Estado: mapeo completo (323/323 clases) y verificado sobre un lote de 20 filas (18/20 correctas, 2 errores corregidos). Las 323 clases tienen densidad: 203 medidas de volumen USDA, 60 de tablas publicadas, 2 referencias físicas, 43 calculadas geométricamente y 15 calculadas por receta. **Ninguna queda pendiente de pesar**; las 43 geométricas están marcadas y tienen una incertidumbre de ±15–20 % (ver [sección 3](#3-densidad-g-por-cm³)). Pendiente: revisión técnica de 48 filas de nutrientes.

---

## 1. Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| **`nutrition_wide_densidad.csv`** | **Tabla lista para usar:** `nutrition_wide.csv` + densidad, cm³ por 100 g y estado de la densidad en las mismas filas. |
| **`nutrition_wide.csv`** | Tabla principal: una fila por clase, nutrientes en columnas (por 100 g). |
| **`nutrition_long.csv`** | La misma información en formato largo (clase, fdc_id, nutriente, unidad, cantidad). |
| **`nutrient_dictionary.csv`** | Diccionario de nutrientes: número USDA, nombre, unidad y nombre de columna. |
| **`nutrition_map.json`** | Todo por clase: alimento USDA, nutrientes, porciones caseras (`portions`) e ingredientes de las recetas. |
| **`densidad_alimentos.csv`** | Densidad (g/cm³) de cada clase, su tipo, fuente y confianza. |
| **`densidad_cambios.csv`** | Auditoría de la revisión de densidades: valor anterior, valor nuevo, diferencia y fuente de las 168 clases que cambiaron. |
| **`densidad_alimentos_v1.csv`** | Versión anterior de la tabla de densidades, conservada para comparar. |
| **`recetas.csv`** (en `Utilidades/`) | Ingredientes y gramos de los 15 platos compuestos (por 100 g de plato listo). |
| **`review_queue_done.csv`** | Decisión final por clase (`ok`, `cambiar`, `receta`), id de USDA y nota con confianza. |
| **`decisiones_resumen.csv`** | Lo mismo en formato resumido: decisión, id, confianza y motivo. |
| **`revision_tecnica.csv`** | Las 48 filas que recomiendo revisar con un especialista (motivo incluido). |
| **`validacion_coherencia.csv`** | Comprobación de que kcal ≈ 4·proteína + 4·carbohidratos + 9·grasa por clase. |
| **`REVISION.md`** | Informe de la revisión: criterios, errores encontrados y corregidos, límites. |
| **`review_queue.csv`** | Cola generada por el pipeline (propuesta de DeepSeek, antes de mi revisión). |
| **`mapping_draft.csv`**, **`usda_cache.jsonl`**, **`llm_cache.jsonl`** | Borrador inicial y caché de llamadas (USDA y LLM). Permiten reproducir sin volver a llamar a las APIs. |
| **`decisiones/`** | Registro de cada decisión (`lote01.txt` … `lote07.txt`): `clase`, `decisión`, `id`, `confianza`, `motivo`. |
| **`scripts/`** | Herramientas para regenerar tablas, densidades, validaciones y la lista de revisión. |

### Columnas principales

**`nutrition_wide.csv`** (una fila por clase):

- `idx`, `clase`: identificador y nombre de la clase en `classes.json`.
- `status_final`, `reviewed`, `flags`: estado de la revisión y alertas.
- `fdc_id`, `fdc_description`, `fdc_data_type`: alimento USDA usado. `fdc_data_type` puede ser `SR Legacy`, `Foundation`, `Survey (FNDDS)` o `receta`.
- `kcal_100g`: energía por 100 g.
- Nutrientes por 100 g, en columnas con el formato `Nombre (unidad)`. Los más usados:
  - `Energy (kcal)` (en recetas se calcula sumando ingredientes)
  - `Protein (g)`
  - `Total lipid (fat) (g)`
  - `Carbohydrate, by difference (g)`
  - `Fiber, total dietary (g)`
  - `Sugars, Total (g)`
  - `Sodium, Na (mg)`
  - `Fatty acids, total saturated (g)`
- Vacío = ese nutriente no se midió para esa entrada (ver [limitaciones](#calidad-y-limitaciones)).

**`densidad_alimentos.csv`**:

| Columna | Significado |
|---|---|
| `idx`, `clase`, `fdc_id` | Para cruzar con las tablas de nutrientes. |
| `descripcion` | Alimento USDA usado. |
| `densidad` | **g por cm³** (numéricamente igual a g/mL). |
| `cm3_por_100g` | cm³ que ocupan 100 g (= 100 / densidad). |
| `tipo` | `aparente (a granel)`: alimento en montón, con aire entre trozos. `sólido`: pieza compacta. `geometría (sólido)`: valor calculado a partir de una forma geométrica. `líquido`. `mezcla (receta)`. |
| `fuente` | De dónde sale el valor (ver [sección 3](#3-densidad-g-por-cm³)). |
| `estado` | `medida USDA`, `tabla publicada`, `referencia de categoría`, `calculada (geometría)`, `calculada (receta)` o `ESTIMADA - pendiente de pesar`. |
| `estimada` | **`SÍ`** solo si el valor es una estimación pendiente de confirmar pesando. En esta versión vale `no` en las 323: las 43 geométricas **no son mediciones**, sino cálculos, y se identifican por `estado = calculada (geometría)`. |
| `confianza` | `alta`, `media` o `baja`. Las 43 geométricas son `baja`. |
| `motivo` | En las 43 geométricas: método, masa, forma y dimensiones, empezando por `cálculo geométrico, NO medición`. En el resto, vacío. |
| `nota` | Detalle (p. ej. medidas USDA usadas o ingredientes de la receta). |

**`recetas.csv`**: `idx`, `clase`, `ingrediente`, `fdc_id`, `gramos_100g_plato`, `porcion_g`, `nota`. Los gramos de cada receta suman 100 g.

---

## 2. Cómo usar el mapeo

### 2.1 Pasar de volumen a gramos

```
gramos = volumen (cm³) × densidad (g/cm³)
```

**Ejemplo (judía verde, `idx` 1):** densidad 0,528 g/cm³.

- 1 taza USDA = 236,6 cm³ → 236,6 × 0,528 = **125 g**. Coincide con el peso de la taza que publica USDA (125 g), así que el valor es consistente.

### 2.2 Pasar de gramos a calorías y macros

Con la fila de la clase en `nutrition_wide.csv`:

```
kcal       = gramos / 100 × Energy (kcal)
proteína   = gramos / 100 × Protein (g)
carbohidr. = gramos / 100 × Carbohydrate, by difference (g)
grasa      = gramos / 100 × Total lipid (fat) (g)
```

**Ejemplo (judía verde, 125 g):**

| Nutriente | Por 100 g | En 125 g |
|---|---|---|
| Energía | 35 kcal | 43,8 kcal |
| Proteína | 1,89 g | 2,4 g |
| Carbohidratos | 7,88 g | 9,9 g |
| Grasa | 0,28 g | 0,35 g |

### 2.3 Flujo completo (foto → resultado)

1. El modelo de visión identifica la clase y estima el volumen aparente (cm³) de cada alimento.
2. Busca la clase en `nutrition_wide_densidad.csv`, multiplica el volumen por `densidad_g_cm3` y obtiene los gramos.
3. Con la misma fila, multiplica los gramos / 100 por `kcal_100g` y por cada nutriente.
4. Si el volumen es de una porción en cucharas o tazas, usa `nutrition_map.json` (`portions`) o las medidas de USDA como alternativa.

Si prefieres tablas separadas, `nutrition_wide.csv` y `densidad_alimentos.csv` se cruzan por `idx`.

### 2.4 Platos compuestos

Los 15 platos con `fdc_data_type = receta` (rösti, coleslaw, ensalada, bolognesa, risotto, tartas…) tienen sus nutrientes calculados sumando sus ingredientes por gramos. Ver [sección 4](#4-platos-compuestos-recetas).

---

## 3. Densidad (g por cm³)

### Qué mide

La densidad del mapeo es la masa del alimento por unidad de **volumen aparente**, es decir, incluyendo el aire entre trozos cuando el alimento está en montón (arroz cocido, ensalada, nueces, copos). Para piezas compactas (manzana, carne, queso) es densidad sólida.

Esto importa porque una foto mide volumen aparente. Por eso la densidad que usamos es la que corresponde a cómo se ve el alimento en el plato.

### De dónde sale cada valor

Se aplica en este orden:

1. **Medida de volumen de USDA** (`fuente`: *USDA: medida de volumen de la entrada*), **203 clases**. USDA da el peso de una taza o cucharada de ese alimento. Dividimos el peso entre el volumen (taza = 236,6 cm³; cucharada = 14,8 cm³; cucharadita = 4,9 cm³, etc.). Si hay varias, usamos la mediana, prefiriendo las medidas sin troceado. Se descartan las que dan rendimientos (`yield`), las que miden otra forma física (fruta entera frente a 1 cup en láminas, bloque frente a rallado) o valores fuera de rango (0,08–1,6 g/cm³). Ejemplo descartado: crema de avellana con 2,50 g/cm³, claramente un error de la base.
2. **Entrada concreta de FAO/INFOODS** (`fuente`: *FAO/INFOODS Density DB v2*), **33 clases**: pasta cocida 0,59; pastel 0,415; lasaña 1,04; sopa 0,99 y sopa espesa 1,09; patata cocida 0,59; almendras 0,46; pistachos 0,646; gambas cocidas 0,77; pimiento en dados 0,51; aceitunas 0,65; pan 0,29 y pan blanco 0,42; entre otras.
3. **Tabla 4.2 de *Engineering Properties of Foods*** (`fuente`: *referencia tabulada: tabla 4.2*), **23 clases**: carnes 1,055 (rango publicado 1,05–1,07 para 74–84 % de agua), pescado magro 1,055, manzana 0,85 (rango 0,775–0,925), pera 1,00 y queso 1,08–1,15 (rango 1,08–1,23).
4. **Otras tablas publicadas**, **4 clases**: patata entera 1,06 (peso específico USDA AMS), remolacha 0,76 y anacardos 0,56 (Engineering ToolBox) y crema de frutos secos 1,082 (medida USDA de mantequilla de cacahuete, usada como proxy).
5. **Referencia física de una categoría** (`fuente`: *referencia* o *física*), **2 clases**: huevo entero 1,03 y nata 0,99.
6. **Cálculo geométrico** (`fuente`: *cálculo geométrico*, estado `calculada (geometría)`), **43 clases**: no hay densidad publicada en la forma en que se sirven. Se calcula `ρ = masa / volumen`, con la masa de la porción USDA (o una masa típica si USDA no la da) y el volumen de un sólido con dimensiones comerciales o de porción típicas: elipsoide, esfera, cilindro, prisma, cuña de pizza, cono o taza. **Las dimensiones no se midieron sobre la foto**; son tamaños típicos. Incertidumbre estimada: ±15–20 %. Ver la [tabla completa](#densidades-calculadas-geométricamente-43).
7. **Recetas** (`fuente`: *fórmula de mezcla sobre ingredientes*), **15 platos**: densidad de la mezcla con la fórmula `ρ = 100 / Σ(gᵢ / ρᵢ)`, a partir de la densidad de cada ingrediente. Se marcan como *calculada (receta)*.

### Contraste con FAO y con la tabla 4.2

Las densidades de receta se calculan con densidades de ingredientes que salen de USDA, FAO o la tabla 4.2. Los 43 valores geométricos se comprobaron contra el rango físico esperado (0,25–1,20 g/cm³) y contra los valores de FAO para alimentos equivalentes; todos quedaron dentro. La revisión también corrigió errores de clasificación por palabras: `blueberries` caía en “queso azul”, `pineapple` en “frutos secos” (por *pine*), `potato_salad` en “hojas verdes”, `pasta_in_butterfly_form_farfalle` en “mantequilla” (por *butterfly*), `quiche` en “queso” y `salad_lambs_ear` en “cordero”. Los 168 cambios están en `densidad_cambios.csv`, con el valor anterior y el nuevo.

### Resumen de fuentes

| Estado | Clases | Confianza |
|---|---|---|
| Medida de volumen USDA | 203 | alta o media según la medida |
| Tabla 4.2 de *Engineering Properties of Foods* (carnes, pescado, manzana, pera, queso) | 23 | media |
| FAO/INFOODS (pan, pasta, pastel, sopas, frutos secos, semillas, gambas, pimiento, aceitunas…) | 33 | media |
| Otras tablas publicadas (USDA AMS, Engineering ToolBox, proxy USDA) | 4 | media |
| Referencia de categoría (huevo, nata) | 2 | media |
| Cálculo geométrico (43) | 43 | baja |
| Calculada por receta | 15 | baja |
| **Total** | **323** | |

Las 43 geométricas están marcadas con `estado = calculada (geometría)`, `estimada = no` y un `motivo` que empieza por `cálculo geométrico, NO medición`. **`estimada = no` no significa que sean medidas**: significa que no son estimaciones pendientes de pesar. Para saber si un valor es una medición, hay que mirar `estado` (`medida USDA` o `tabla publicada`) y `fuente`.

Confianza total: 173 alta, 92 media, 58 baja.

### Densidades calculadas geométricamente (43)

Para estas 43 clases no hay una densidad publicada de la forma en que se sirven: fruta entera, hortalizas, quesos blandos y platos compuestos. La medida de volumen USDA no existe o mide otra forma física (fruta entera frente a rodajas, bloque frente a rallado, pechuga entera frente a troceada). Por eso se calculó:

```
ρ = masa de la porción / volumen del sólido
```

- **Masa:** la porción USDA que aparece en `nutrition_map.json` (columna «masa y origen»). Si USDA no da porción, se usa una masa típica, indicada en la tabla.
- **Volumen:** fórmula de un sólido nombrado (elipsoide, esfera, cilindro, prisma, cuña de pizza, cono o taza) con dimensiones comerciales o de porción típicas.
- **Las dimensiones no se midieron sobre la foto:** son tamaños típicos. El resultado es una densidad **calculada**, no una medición. Incertidumbre estimada: **±15–20 %**.
- Para una taza se usa 236,6 cm³. Para la pizza, 30 cm (12") cortada en 8 trozos; el grosor depende del tipo (fina 1,0 cm, con vegetales 1,4 cm, con jamón 1,6 cm). Para la carne desmenuzada, un montón cónico de 10 cm de diámetro y 4 cm de alto. En el caqui y el kiwi se usó un tamaño típico coherente con la masa (168 g y 75 g): la medida USDA de 2 1/2" del caqui no cuadra con 168 g, y la porción USDA de 140 g del kiwi corresponde a un fruto grande.
- Rango de los 43 valores: **0,259** (croissant) a **1,164** (praliné).

| idx | clase | masa y origen | forma y dimensiones | V (cm³) | ρ (g/cm³) |
|---:|---|---|---|---:|---:|
| 15 | `artichoke` | 128 g — 1 alcachofa mediana USDA | elipsoide 8,0 × 8,0 × 8,5 cm | 284,8 | **0,449** |
| 19 | `cucumber_pickled_ch` | 40,4 g — 1 pepinillo USDA | cilindro d=2,8 cm, h=8,0 cm | 49,3 | **0,820** |
| 20 | `cucumber` | 300 g — 1 pepino típico | cilindro d=4,4 cm, h=21,0 cm | 319,3 | **0,940** |
| 24 | `red_radish` | 10 g — 1 rábano típico | esfera d=2,7 cm | 10,3 | **0,970** |
| 32 | `garlic` | 50 g — 1 cabeza de ajo típica | elipsoide 5,0 × 5,0 × 4,5 cm | 58,9 | **0,849** |
| 38 | `pineapple` | 1200 g — 1 piña mediana, diámetro medio | cilindro d=10,0 cm, h=22,0 cm | 1727,9 | **0,694** |
| 46 | `figs` | 50 g — 1 higo mediano USDA (2 1/4") | elipsoide 5,7 × 4,5 × 4,0 cm | 53,7 | **0,931** |
| 48 | `blueberries` | 148 g — 1 taza de arándanos USDA | taza (236,6 cm³) | 236,6 | **0,626** |
| 49 | `raspberries` | 123 g — 1 taza de frambuesas USDA | taza (236,6 cm³) | 236,6 | **0,520** |
| 50 | `kaki` | 168 g — 1 caqui; masa USDA 168 g (la medida 2 1/2" no cuadra con ese peso) | elipsoide 7,2 × 7,2 × 6,2 cm | 168,3 | **0,998** |
| 52 | `kiwi` | 75 g — 1 kiwi típico (la porción USDA de 140 g es un fruto grande) | elipsoide 6,5 × 4,7 × 4,7 cm | 75,2 | **0,998** |
| 57 | `orange` | 154 g — 1 naranja USDA | esfera d=7,2 cm | 195,4 | **0,788** |
| 110 | `white_bread_with_butter_eggs_and_milk` | 65 g — 1 rebanada USDA | prisma 10,0 × 10,0 × 1,50 cm | 150,0 | **0,433** |
| 115 | `rusk_wholemeal` | 10 g — 1 biscote USDA | prisma 7,5 × 4,5 × 1,00 cm | 33,8 | **0,296** |
| 120 | `dried_meat_n_s` | 28 g — 10 lonchas finas USDA (0,1 cm cada una) | prisma 10,0 × 4,0 × 1,00 cm | 40,0 | **0,700** |
| 128 | `praline_n_s` | 39 g — 1 pieza USDA | esfera d=4,0 cm | 33,5 | **1,164** |
| 130 | `dark_chocolate` | 162 g — 1 tableta USDA | prisma 18,0 × 8,0 × 1,00 cm | 144,0 | **1,125** |
| 133 | `brownie` | 50 g — 1 brownie mediano USDA | prisma 5,0 × 5,0 × 3,50 cm | 87,5 | **0,571** |
| 135 | `crepe_with_flour_plain` | 65 g — 1 crepe USDA | disco d=24,0 cm, grosor 0,25 cm | 113,1 | **0,575** |
| 136 | `fruit_tart` | 125 g — 1 tarta USDA | disco d=11,0 cm, grosor 3,00 cm | 285,1 | **0,438** |
| 140 | `tart_n_s` | 125 g — 1 tarta USDA | disco d=11,0 cm, grosor 3,00 cm | 285,1 | **0,438** |
| 141 | `croissant_with_chocolate_filling` | 57 g — 1 croissant USDA | elipsoide 12,0 × 7,0 × 5,0 cm | 219,9 | **0,259** |
| 159 | `falafel_balls` | 17 g — 1 falafel USDA | esfera d=3,6 cm | 24,4 | **0,696** |
| 160 | `savoury_pastry_stick` | 11 g — 1 pastelito USDA | prisma 8,0 × 3,0 × 1,50 cm | 36,0 | **0,306** |
| 164 | `spring_roll_fried` | 68 g — 1 rollito USDA | prisma 10,0 × 3,5 × 3,50 cm | 122,5 | **0,555** |
| 172 | `chocolate_mousse` | 100 g — 1 ración típica | cilindro d=7,0 cm, h=4,5 cm | 173,2 | **0,577** |
| 210 | `croissant` | 57 g — 1 croissant mediano USDA | elipsoide 12,0 × 7,0 × 5,0 cm | 219,9 | **0,259** |
| 214 | `pizza_with_vegetables_baked` | 108 g — 1 trozo mediano USDA (pizza 12") | cuña de pizza D=30,0 cm, grosor 1,4 cm, 1/8 | 123,7 | **0,873** |
| 215 | `pizza_with_ham_with_mushrooms_baked` | 103 g — 1 trozo USDA (pizza 12") | cuña de pizza D=30,0 cm, grosor 1,6 cm, 1/8 | 141,4 | **0,729** |
| 216 | `pizza_margherita_baked` | 69 g — 1 trozo USDA (pizza fina 12") | cuña de pizza D=30,0 cm, grosor 1,0 cm, 1/8 | 88,4 | **0,781** |
| 217 | `pizza_with_ham_baked` | 103 g — 1 trozo USDA (pizza 12") | cuña de pizza D=30,0 cm, grosor 1,6 cm, 1/8 | 141,4 | **0,729** |
| 218 | `hamburger` | 145 g — 1 hamburguesa USDA | cilindro d=10,0 cm, h=4,5 cm | 353,4 | **0,410** |
| 219 | `veggie_burger` | 160 g — 1 hamburguesa vegetal USDA | cilindro d=10,5 cm, h=4,5 cm | 389,7 | **0,411** |
| 225 | `pancake` | 50 g — 1 tortita mediana USDA | disco d=12,0 cm, grosor 0,90 cm | 101,8 | **0,491** |
| 274 | `sauce_cream` | 60 g — 1 cucharón USDA | cilindro d=5,5 cm, h=2,5 cm | 59,4 | **1,010** |
| 281 | `bacon` | 11,5 g — 1 loncha USDA | prisma 14,0 × 4,0 × 0,30 cm | 16,8 | **0,685** |
| 282 | `beef_n_s` | 85 g — 1 ración USDA en montón | montón cónico r=5,0 cm, h=4,0 cm | 104,7 | **0,812** |
| 292 | `soft_cheese` | 28,35 g — 1 onza USDA | cilindro d=4,0 cm, h=2,5 cm | 31,4 | **0,902** |
| 293 | `goat_cheese_soft` | 28,35 g — 1 onza USDA | cilindro d=4,0 cm, h=2,5 cm | 31,4 | **0,902** |
| 306 | `fennel` | 230 g — 1 bulbo de hinojo típico (sin tallos) | elipsoide 8,0 × 8,0 × 7,0 cm | 234,6 | **0,981** |
| 312 | `meat_n_s` | 85 g — 1 ración USDA en montón | montón cónico r=5,0 cm, h=4,0 cm | 104,7 | **0,812** |
| 316 | `pork_n_s` | 85 g — 1 ración USDA en montón | montón cónico r=5,0 cm, h=4,0 cm | 104,7 | **0,812** |
| 320 | `red_cabbage_raw` | 85 g — 1 taza de col en tiras USDA | taza (236,6 cm³) | 236,6 | **0,359** |

Si se pesa o mide una porción real, se sustituye el valor y se anota en `fuente` y `estado` como `medición propia` (hay que añadir ese caso en `scripts/densidad.py`).

### Cómo mejorar la densidad

Ya no hay densidades pendientes de pesar: las 323 tienen valor. Las 43 geométricas son las que más se benefician de una **medición propia**, porque sus dimensiones son típicas y no se midieron sobre la foto. Basta pesar una porción real (o medir el volumen con agua/vaso graduado) y sustituir el valor; se anota en `fuente` y `estado` como `medición propia`. Las 265 clases con fuente publicada o física (203 USDA + 60 de tablas + 2 referencias) no necesitan pesarse salvo comprobación. Las 15 recetas se pueden afinar pesando el plato terminado.

---

## 4. Platos compuestos (recetas)

Los platos sin entrada fiel en USDA (rösti, bolognesa, risotto, coleslaw, ensaladas, tartas, bebida de glucosa…) se calculan con `recetas.csv`:

- Cada fila es un ingrediente con su id de USDA y sus **gramos por 100 g de plato listo** (ya cocido, como se come).
- Los gramos de cada receta suman 100 g.
- Nutrientes: suma ponderada de cada nutriente por los gramos de cada ingrediente.
- Un nutriente que un ingrediente no reporta cuenta como 0. Esto es correcto para azúcares en un aceite, pero puede **subestimar vitaminas y minerales** si el dato falta de verdad.
- Energía: si un ingrediente solo trae energía Atwater (957/958), se usa como energía normal (kcal).
- Porción típica (`porcion_g`): estimada, no medida.

Para cambiar una receta: edita `Utilidades/recetas.csv` (o la lista `RECETAS` en `scripts/merge.py`) y regenera (ver [sección 6](#6-cómo-cambiar-una-decisión-o-una-receta)).

---

## 5. Criterios del mapeo

Aplicados a todas las clases:

1. **Estado en que se consume.** Verduras, carnes, pescados, pastas, arroces y legumbres se mapean cocidos. Ensaladas y fruta, crudos. (Ejemplo: `chicken_breast` → pollo cocido asado, no crudo.)
2. **Lo que dice la clase.** "Sin sal" y "sin aderezo" se respetan.
3. **Compuestos.** Receta estándar por 100 g de plato listo.
4. **Genéricos.** Si la clase no indica preparación, se usa la preparación típica de consumo.
5. **Entre dos candidatos válidos, el más genérico** (sin marca, sin variedad rara).
6. **Sin marcas.** Se sustituyen por categorías genéricas (p. ej. DiGiorno → pizza genérica).
7. **Entradas completas.** Se descartan entradas de USDA con macronutrientes incompletos (p. ej. toronja Foundation sin proteína ni grasa).

Estos criterios están aplicados en `REVISION.md`.

---

## 6. Cómo reproducir o modificar

### 6.1 Requisitos

- Python 3.10 o superior.
- En `Utilidades/`: `pip install -r requirements.txt` (requests, numpy, pandas, tqdm, jupyter).
- Dos claves en un archivo `.env` en la carpeta raíz del proyecto (no en el cuaderno, ni en Git):
  - `USDA_API_KEY`: gratuita en https://api.data.gov/signup/.
  - `OPENCODE_API_KEY`: plan OpenCode Go.

### 6.2 Regenerar el mapeo completo

```
cd Utilidades
python scripts/run_cuadernillo.py        (o abrir 01_mapeo_nutricional.ipynb y ejecutar todo)
```

Las llamadas a USDA y al LLM se guardan en caché (`usda_cache.jsonl`, `llm_cache.jsonl`). Volver a ejecutar sin cambios no gasta cuota.

Para una prueba de 15 clases: `set NUTRI_LIMIT=15` antes de ejecutar `run_cuadernillo.py`.

### 6.3 Las herramientas de `scripts/`

| Script | Qué hace |
|---|---|
| `run_cuadernillo.py` | Ejecuta el cuadernillo sin abrir Jupyter. |
| `buscar_usda.py` | Busca entradas de USDA por texto. Recibe un archivo JSON con una lista de consultas y muestra los candidatos con su id. |
| `merge.py` | Une las decisiones de `decisiones/lote*.txt`, valida y genera `review_queue_done.csv`, `decisiones_resumen.csv` y `recetas.csv`. |
| `densidad.py` | Calcula `densidad_alimentos.csv` con el método de la [sección 3](#3-densidad-g-por-cm³). |
| `unir_densidad.py` | Genera `nutrition_wide_densidad.csv` uniendo nutrientes y densidad por `idx`. |
| `verificacion_20.py` | Arma `verificacion_20.csv`: 20 clases para contrastar a mano (10 de confianza baja y 10 recetas). |
| `validar.py` | Calcula `validacion_coherencia.csv` (kcal frente a macronutrientes). |
| `revision_tecnica.py` | Genera `revision_tecnica.csv` con las filas que necesitan revisión. |

### 6.4 Cómo cambiar una decisión o una receta

1. Edita la línea de la clase en el lote correspondiente (`decisiones/lote0X.txt`), con el formato `idx|decision|id|confianza|motivo`:
   - `ok`: usa el borrador de DeepSeek.
   - `cambiar`: usa el id que pongas.
   - `receta`: usa `recetas.csv`.
2. Si cambias una receta, edita `recetas.csv` (los gramos deben sumar 100).
3. Ejecuta, en este orden:
   ```
   python scripts/merge.py
   python scripts/run_cuadernillo.py
   python scripts/densidad.py
   python scripts/unir_densidad.py
   python scripts/validar.py
   python scripts/revision_tecnica.py
   ```
4. Actualiza `REVISION.md` si la decisión cambia el criterio.

---

## 7. Calidad y limitaciones

### Qué está verificado

- **Coherencia energética:** 316 de 323 clases cumplen kcal ≈ 4·P + 4·C + 9·G (±15 %) con corrección por fibra. Las 7 restantes tienen explicación: vino, cerveza y Aperol (el alcohol no está en la fórmula de Atwater) y agua (0 kcal).
- **Recetas:** todas suman 100 g.
- **Decisiones:** las 323 tienen decisión. Ninguna quedó pendiente.
- **Tasa de error medida:** 2 errores en 20 filas verificadas (10 %; IC 95 %: 2,8 %–30,1 %). Los dos se corrigieron (`spring_roll_fried` y `bread_grain`).

### Qué no está verificado

- **Densidades calculadas geométricamente:** 43 filas con `estado = calculada (geometría)`. **No son mediciones.** La masa sale de una porción USDA o de una masa típica y las dimensiones son tamaños comerciales o de porción, no medidos sobre la foto; la incertidumbre estimada es ±15–20 %. Cada fila lleva en `motivo` la masa, la forma y las dimensiones usadas. Las otras 15 densidades son cálculos de receta (`calculada (receta)`).
- **Decisiones:** no están verificadas contra fuentes externas. Dependen de las descripciones de USDA y del criterio de `REVISION.md`. La verificación de 20 filas dio un 10 % de error, concentrado en las filas de confianza baja.
- **Revisión técnica pendiente:** 48 filas en `revision_tecnica.csv`. Incluyen 23 de confianza baja, 15 recetas, 21 proxies o aproximaciones y 5 casos de coherencia explicados.

### Limitaciones conocidas

- **Entradas Foundation con pocos nutrientes** (entre 11 y 58 por entrada). Para ~20 clases faltan vitaminas y minerales. Energía y macronutrientes están validados.
- **Recetas con nutrientes rellenados con 0** (entre 10 y 328 datos por receta). Afecta sobre todo a vitaminas y minerales.
- **Proxies:** clases sin equivalente exacto en USDA (p. ej. `aperitif` → ponche alcohólico, `halloumi` → paneer). Están marcadas en `revision_tecnica.csv`.
- **Densidad de sólidos en volumen aparente:** para piezas (p. ej. una manzana), el volumen de la foto incluye poco aire. En las 43 clases geométricas se usó la forma de un sólido compacto, así que la densidad es sólida, no a granel; si el alimento está en montón, el volumen de la foto es mayor y el peso se sobreestima. Esto se corrige pesando o midiendo una porción real.
- **Geometría idealizada:** las dimensiones típicas no describen exactamente la pieza fotografiada (un croissant no es un elipsoide perfecto, una pizza no es un cilindro exacto). El error esperado es ±15–20 %, suficiente para estimar calorías, no para pesar con precisión.
- **Alcohol:** la energía de bebidas alcohólicas en `Energy (kcal)` viene de USDA. La fórmula de Atwater no lo incluye; no es un error del mapeo.

---

## 8. Fuentes y créditos

- **USDA FoodData Central**: nutrientes, entradas y medidas caseras (https://fdc.nal.usda.gov).
- **FAO/INFOODS Density Database v2**: 33 densidades aplicadas a clases concretas (pan y panecillos, pasta, pastel, lasaña, sopas, patata, frutos secos, semillas, gambas, pimiento, aceitunas…) y contraste de los valores geométricos.
- ***Engineering Properties of Foods*, tabla 4.2 (Density of Selected Foods, p. 153)**: carnes 1,05–1,07, pescado 1,055, manzana 0,775–0,925, queso 1,08–1,23 y banda 0,775–1,00 para frutas y hortalizas.
- **USDA AMS**: prueba de peso específico de la patata (~1,06) para la patata entera.
- **Engineering ToolBox** (Food Products – Bulk Densities): remolacha entera, anacardos y referencias de mantequilla, mayonesa, cacahuetes y coco.
- **Cálculo geométrico** (43 clases): `ρ = m / V` con masas de porciones USDA y volúmenes de sólidos de dimensiones típicas. No es una fuente de densidad medida; el método y cada suposición están en `densidad_alimentos.csv` (`motivo`, `nota`).
- **DeepSeek V4 Pro** (vía OpenCode Go): propuesta inicial de candidatos. Todas las decisiones finales están revisadas (ver `REVISION.md`).
- **Revisión y criterios**: ver `REVISION.md` y `decisiones/`.

---

## 9. Historial

| Fecha | Cambio |
|---|---|
| 2026-10-27 | Mapeo inicial con DeepSeek V4 Pro (323 clases). |
| 2026-10-28 | Revisión de las 323 filas. 88 cambios respecto al borrador. Recetas (15). Informe `REVISION.md`. |
| 2026-10-28 | Densidades (g/cm³) para las 323 clases, fuentes y confianza. Este README. |
| 2026-10-28 | Densidades v2: 30 clases con entrada FAO/INFOODS, categorías calibradas con FAO, 120 correcciones (27 suben, 93 bajan) y auditoría en `densidad_cambios.csv`. |
| 2026-10-28 | Tabla combinada `nutrition_wide_densidad.csv` (nutrientes + densidad por clase). |
| 2026-10-28 | `verificacion_20.csv`: lote de 20 clases para el control manual del usuario. |
| 2026-10-28 | Verificación del lote: 18/20 correctas, 2 errores corregidos (`spring_roll_fried` → 172105, `bread_grain` → 168013) y tablas regeneradas. |
| 2026-10-28 | Densidades v3: 203 filas con medida USDA recuperada (parser de porciones), 60 con tabla publicada (tabla 4.2, FAO, USDA AMS) y 43 sin fuente, con motivo explícito; 158 cambios auditados. |
| 2026-10-28 | Densidades v4: las 43 clases sin fuente se completan con cálculo geométrico (masa USDA / volumen de un sólido de dimensiones típicas). 323/323 con densidad, 0 pendientes de pesar, 168 cambios auditados. Tabla completa y advertencia de método en la [sección 3](#densidades-calculadas-geométricamente-43). |
