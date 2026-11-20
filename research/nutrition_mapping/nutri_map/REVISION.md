# Nutritional Mapping Review Report (323 Classes)

## Summary

- **Coverage:** 323 of 323 classes with a final decision.
  - 235 `ok` (DeepSeek draft accepted).
  - 73 `cambiar` (another USDA ID is used).
  - 15 `receta` (composite dish calculated with `recetas.csv`).
- **USDA entries:** 308 classes. **Recipes:** 15 classes.
- **DeepSeek V4 Pro draft:** 88 of 323 rows (27%) changed upon review (15 recipes, 73 ID changes). In 6 rows the draft was empty.
- **Confidence of review decisions:** 176 high, 124 medium, 23 low.
- **Rows for second technical review:** 48 (see `revision_tecnica.csv`).
- **Densities:** 323/323 with a value. 203 USDA volume measures, 60 from published tables, 2 physical references, 43 by geometric calculation, and 15 by recipe. None pending weighing; the 43 geometric values are not measurements (see section "Densities: Source Coverage").
- **Error measurement:** measured on the 20-row batch manually verified by the authors: **2 errors in 20 (10%; 95% CI: 2.8%–30.1%)**. Both were corrected and the rest of the table was recalculated.

## Model and Process

- **Scope note:** the review of all 323 rows (across seven batches) and the verification of the 20-row sample were performed manually by the authors against USDA FoodData Central sources, following the approved criteria below. They do not constitute an independent external audit.
- One model (DeepSeek V4 Pro, `deepseek-v4-pro`, `temperature=0`) proposed USDA candidates for all 323 classes. No response was invalid.
- The authors manually reviewed all 323 rows across seven batches against the USDA candidates and the approved criteria:
  1. Map to the state in which it is consumed (cooked for vegetables and meats eaten cooked; raw for salads and fruit).
  2. If the class says "unsalted" or "without dressing", respect it.
  3. Composite dishes: standard recipe per 100 g of ready-to-eat dish, with a typical portion.
  4. Generic categories: typical preparation as consumed.
  5. Between two valid candidates, choose the more generic one.
- Validation: kcal against 4·protein + 4·(carbohydrates − fiber) + 2·fiber + 9·fat.

## Errors Found and Corrected

1. **Search missing the correct entry** (beetroot): a query with the original class name was added and the entry was corrected manually.
2. **Composite dish accepted automatically** (salad with avocado, 54 kcal vs. ~20 kcal from the recipe): now no row is accepted without review.
3. **Incorrect state** (raw instead of as consumed): 71 changes across meats, fish, pastas, rices, legumes, and vegetables.
4. **Incomplete Foundation entries** (missing protein, fat, or carbohydrates): grapefruit, raisins, bread, mayonnaise, and salami/sausage. Replaced with SR Legacy entries (6 rows).
5. **Recipe energy bug:** ingredients that only report Atwater energy (957/958) counted as 0 kcal. Birchermuesli came out −20% and mushroom sauce −132%. Fixed.
6. **Decision inconsistency:** 7 rows marked `ok` pointed to an ID different from the draft (the system would have taken the draft). Converted into explicit changes.
7. **Brand names:** DiGiorno was replaced by generic pizza. Nutella/Caotina and Coca-Cola were translated into generic categories.
8. **Glucose drink** (0.12 g of carbohydrates in the USDA entry): moved to a recipe (sugar + water).
9. **Two state/category errors detected in the 20-row verification:** `spring_roll_fried` used the unfried version (112 kcal) and `bread_grain` used dry raw grain (371 kcal). Corrected to 172105 (214 kcal) and 168013 (265 kcal).

## Coherence Validation: kcal vs. Macronutrients

- **316 of 323** satisfy coherence (±15% tolerance).
- **5 wines, beer, and Aperol:** expected difference, because the Atwater formula does not include alcohol (7 kcal/g). Not data errors.
- **2 water entries:** 0 kcal, correct.

## Rows for Second Technical Review (48)

Full details in `revision_tecnica.csv`. Criteria: low confidence, recipes, proxies or approximations, and explained incoherences.

**Low confidence (23):**

| idx | Class | Decision | id | Reason |
|---|---|---|---|---|
| 13 | leaf_spinach | ok | 168462 | Ambiguous class: raw or cooked |
| 35 | shoots_n_s | ok | 169210 | Bamboo shoots; state and use unclear |
| 94 | grits_polenta_maize_flour | ok | 169697 | Polenta: only dry version available |
| 103 | bread_fruit | ok | 171714 | Breadfruit, normally cooked |
| 126 | tuna | cambiar | 172006 | Generic cooked tuna; yellowfin as approximation |
| 146 | aperitif_with_alcohol (Aperol spritz) | cambiar | 2710674 | No Aperol entry; alcoholic punch |
| 164 | spring_roll_fried | cambiar | 172105 | Corrected: fried roll proxy (vegetable egg roll); no fried spring roll in USDA |
| 166 | salt_cake_ch_vegetables_filled | receta | — | Savory tart: approximate IDs and proportions |
| 181 | birchermuesli | receta | — | Muesli and yogurt proportions |
| 189 | french_pizza_from_alsace | receta | — | Tarte flambée: approximate dough and topping |
| 191 | porridge (semi-skimmed milk) | receta | — | Oats/milk ratio |
| 198 | ham_raw | ok | 168222 | Cured raw ham; raw leg entry |
| 215 | pizza_with_ham_with_mushrooms | cambiar | 172095 | Generic meat-topping pizza |
| 228 | cordon_bleu | ok | 2706418 | Veal entry; original is usually pork |
| 239 | salad_lambs_ear | ok | 2709789 | Proxy: raw lettuce |
| 240 | balsamic_salad_dressing | ok | 2710195 | Proxy: generic dressing, not balsamic |
| 247 | pie_apricot | receta | — | Pastry + apricot + sugar |
| 248 | pie_plum | receta | — | Pastry + plum + sugar |
| 251 | mixed_milk_beverage | receta | — | Blend of milk, soy, and oat |
| 258 | bread_grain | cambiar | 168013 | Corrected: multigrain bread; previously dry raw grain |
| 272 | sauce_mushroom | receta | — | Cream + mushrooms + butter |
| 302 | crunch_muesli | ok | 2708447 | Crunchy cereal as approximation |
| 312 | meat_n_s | cambiar | 174034 | Generic meat: cooked ground beef |

**Recipes (15):** all need proportion validation. See also zero-filled nutrients below.

**Proxies and approximations (21 in total, some already listed above):** in `revision_tecnica.csv`.

## Known Limitations

- **Foundation entries with few nutrients:** between 11 and 58 nutrients per entry. Some vitamins and minerals will be missing in roughly 20 classes. Energy and macronutrients are validated.
- **Recipes with zero-filled nutrients:** if an ingredient does not report a nutrient, it counts as 0. This primarily affects vitamins and minerals. Per recipe: between 10 and 328 filled values (see execution log).
- **State criterion:** the 71 ID changes depend on the "as-consumed state" rule. If that rule does not fit your use case, those rows should be reviewed.
- **Decisions not verified against external sources:** they rely on USDA descriptions and the authors' criteria. The 20-row verification yielded 2 errors; both were corrected, but the rest still rests on the review criteria and USDA descriptions rather than an external check.
- **Limited statistical audit:** the measured error rate is 10% (2/20), with a confidence interval of 2.8% to 30.1%. This is a small sample: it is useful for detecting the type of error, not for guaranteeing exact accuracy.

## Files

| File | Contents |
|---|---|
| `review_queue_done.csv` | Final decisions for the notebook |
| `decisiones_resumen.csv` | Decision, ID, confidence, and note per class |
| `revision_tecnica.csv` | The 48 rows for second review |
| `recetas.csv` | The 15 composite dishes with ingredients and grams |
| `validacion_coherencia.csv` | Validation of kcal against macronutrients |
| `nutrition_wide.csv`, `nutrition_long.csv`, `nutrient_dictionary.csv`, `nutrition_map.json` | Final nutrient tables |

## Verification of the 20-Row Batch (Sampling)

Batch in `verificacion_20.csv`: 10 low-confidence rows (pure USDA mapping) and 10 recipes, manually verified by the authors, with the columns `tu_veredicto_OK_o_ERROR` and `comentario`. The nutrient and density columns in that CSV are a snapshot of the **state prior** to the corrections; the current values are in `nutrition_wide_densidad.csv`.

- **Overall result:** 18 / 20 correct (90% accuracy), 2 / 20 errors (**10% error rate**; 95% Wilson CI: 2.8%–30.1%).
- **By stratum:** low confidence 2/10 errors (20%; 95% CI: 5.7%–51.0%); recipes and high/medium-confidence rows 0/10 errors (95% CI: 0%–27.8%).
- **Pattern:** both errors are of the same type—**wrong food state or category**—and both were flagged as low confidence. No errors appeared in recipes, high confidence, or medium confidence.

**Errors detected and corrected:**

| idx | Class | Before | After | Effect |
|---|---|---|---|---|
| 164 | `spring_roll_fried` | 2708704, **unfried** rice-paper roll (112 kcal) | 172105, fried vegetable egg roll (214 kcal) | +91% energy; was a severe underestimation |
| 258 | `bread_grain` | 2710830, **raw dry** Khorasan grain (371 kcal) | 168013, multigrain bread (265 kcal) | −29% energy; was grain, not bread |

For 164, no fried spring roll exists in USDA: the closest measured fried roll (vegetable egg roll) was used and noted as a proxy. For 258, the class is a bread (`bread-grain`), not a whole cereal grain; multigrain bread was used, which is the generic entry for that category.

**Borderline cases that turned out correct:**

- `idx 103` (`bread_fruit`): **OK**. "Breadfruit" is the fruit (*Artocarpus altilis*), not wheat bread.
- `idx 126` (`tuna`): **OK**. Cooked yellowfin tuna as a valid proxy for the generic class.
- `idx 239` (`salad_lambs_ear`): **OK**. Raw lettuce as a leafy-green proxy.
- `idx 215` (`pizza_with_ham_with_mushrooms`): **OK**. Generic meat pizza.

**Effect on the tables:** `review_queue_done.csv`, `nutrition_wide.csv`, `nutrition_long.csv`, `nutrition_map.json`, `densidad_alimentos.csv`, and `nutrition_wide_densidad.csv` were regenerated. The kcal vs. macros validation remains at 316/323 coherent (the 5 alcoholic beverages and 2 waters explained), and `revision_tecnica.csv` keeps 48 rows, now with the corrected IDs.

**Practical takeaway:** 90% accuracy is acceptable for estimating nutrients from a photo, but the 10% error rate is concentrated in the low-confidence rows. For clinical or research use, `revision_tecnica.csv` is the list to review with a specialist before relying on those classes.

## Densities: Source Coverage (v4)

Goal: ensure most of the 323 densities come from a published measurement rather than an estimate. Priority order applied in `scripts/densidad.py`:

| Priority | Source | Classes |
|---|---|---|
| 1 | USDA/FNDDS volume measure (cup, tablespoon, fl oz) | 203 |
| 2 | Table 4.2 *Density of Selected Foods*, *Engineering Properties of Foods* (p. 153) | 23 |
| 3 | FAO/INFOODS Density Database v2 (specific entry) | 33 |
| 4 | Other published tables (USDA AMS for potato, Engineering ToolBox) and USDA proxy (nut butter) | 4 |
| 5 | Category physical reference (egg, cream) | 2 |
| 6 | **Geometric calculation** (USDA mass / volume of a solid with typical dimensions) | **43** |
| 7 | Mixture calculation over the recipe | 15 |
| | **Total** | **323** |

**Values applied from Table 4.2:** meats 1.055 g/cm³ (the table publishes ρ = 1076 − 1.37·x_f for 5–20% fat, i.e., 1.05–1.07), lean fish 1.055, apple 0.85 (range 0.775–0.925), pear 1.00, and cheese 1.08–1.15 (range 1.08–1.23; the lower end for fresh cheese and mozzarella). The 11 compact fruits and vegetables without a per-species value no longer use 0.95: they are calculated geometrically (see below).

**Form corrections:** a USDA measure is not accepted when it measures a different physical form from the class (whole apple vs. 1 cup sliced, cheese block vs. shredded, loaf vs. loose pieces, fillet vs. flaked fish, stacked slice vs. diced, whole breast vs. chopped chicken). These are encoded in the `NO_USDA` list with their justification and affect 23 classes.

**The 43 classes without a published density** are completed with a geometric calculation, not a category estimate:

- 11 compact fruits/vegetables without a per-species density (artichoke, pickled cucumber, cucumber, radish, garlic, pineapple, fig, persimmon, kiwi, orange, fennel).
- 2 bulk berries (blueberries, raspberries).
- 30 composite dishes or products without a density table: pizza (4), hamburger and veggie burger, pancake, crepe, croissant (2), tart (2), brownie, falafel, pastry stick, spring roll, bread/toast (`white_bread_with_butter_eggs_and_milk`), mousse, praline, dark chocolate, rusk, cream sauce, bacon, mounded/shredded meat (3), soft goat cheese (2), red cabbage, and dried meat.

Method: `ρ = m / V`. The mass `m` is the USDA portion from `nutrition_map.json`; if USDA does not provide a portion, a typical mass noted in the table is used. The volume `V` is computed using the formula for a named solid (ellipsoid, sphere, cylinder, prism, pizza wedge, cone, or cup) and typical commercial or serving dimensions. **Dimensions were not measured from the photo**: they are typical sizes, and the estimated uncertainty is ±15–20%. Therefore, the result is a **calculated density, not a measurement**.

All 43 are flagged with `estado = calculada (geometría)`, `confianza = baja`, `estimada = no`, and a `motivo` starting with `cálculo geométrico, NO medición` detailing mass, shape, dimensions, and volume. The full table (idx, mass and origin, shape, V, and ρ) is in `README.md`, section "Geometrically Calculated Densities (43)". The 15 recipes are separated as `calculada (receta)`, because their density comes from an explicit formula over ingredients.

The 43 values fell between 0.259 (croissant) and 1.164 g/cm³ (praline). They were checked against the expected physical range (0.25–1.20) and against FAO values for equivalent foods; none fell outside.
