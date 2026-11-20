import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "nutri_map"
DEC_DIR = Path(__file__).resolve().parents[1] / "decisiones"

import pandas as pd
Q = pd.read_csv(OUT / "review_queue.csv", dtype=str).fillna("")
Q["idx_i"] = Q["idx"].astype(int)

dec = {}
for f in sorted(DEC_DIR.glob("lote*.txt")):
    for ln in f.read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        idx, d, final, conf, nota = ln.split("|", 4)
        if not conf and "|" in nota:
            conf, nota = nota.split("|", 1)
        dec[int(idx)] = dict(decision=d, final=final, conf=conf, nota=nota)

missing = sorted(set(Q["idx_i"]) - set(dec))
extra = sorted(set(dec) - set(Q["idx_i"]))
print("decisions:", len(dec), "| missing:", missing, "| extra:", extra)

# 'ok' rows use the draft; warn if the written id does not match
for i, d in dec.items():
    row = Q[Q["idx_i"] == i].iloc[0]
    if d["decision"] == "ok" and d["final"] and d["final"] != row["usda_draft"]:
        print("ok converted to cambiar (id differs from draft):", i, d["final"], row["usda_draft"])
        d["decision"] = "cambiar"
    if d["decision"] == "ok" and not row["usda_draft"] and not d["final"]:
        print("WARNING ok without draft:", i)
    if d["decision"] not in ("ok", "cambiar", "sin_match", "receta"):
        print("WARNING unknown decision:", i, d["decision"])
    if d["decision"] == "cambiar" and not d["final"]:
        print("WARNING cambiar without id:", i)

Q["decision"] = Q["idx_i"].map(lambda i: dec[i]["decision"] if i in dec else "")
Q["final_usda"] = Q["idx_i"].map(lambda i: dec[i]["final"] if i in dec and dec[i]["decision"] == "cambiar" else "")
Q["nota"] = Q["idx_i"].map(lambda i: f"[{dec[i]['conf']}] {dec[i]['nota']}" if i in dec else "")
Q.drop(columns=["idx_i"]).to_csv(OUT / "review_queue_done.csv", index=False, encoding="utf-8-sig")

conf_rows = [dict(idx=i, clase=Q.loc[Q["idx_i"] == i, "clase"].iloc[0], decision=d["decision"], final_usda=d["final"],
                  confianza=d["conf"], nota=d["nota"]) for i, d in sorted(dec.items())]
pd.DataFrame(conf_rows).to_csv(OUT / "decisiones_resumen.csv", index=False, encoding="utf-8-sig")

RECETAS = [
    # idx, clase, ingredient, fdc, grams per 100 g of finished dish, porcion_g, note
    (8, "rosti_n_s", "Potatoes boiled in skin flesh without salt", "170438", 85, 150, "Rosti: patata cocida + aceite; porcion tipica estimada"),
    (8, "rosti_n_s", "Canola oil", "172336", 15, 150, "Aceite para freir"),
    (10, "coleslaw_chopped_without_sauce", "Cabbage raw", "169975", 85, 100, "Col cruda sin aderezo"),
    (10, "coleslaw_chopped_without_sauce", "Carrots raw", "170393", 15, 100, "Zanahoria cruda sin aderezo"),
    (12, "mixed_salad_chopped_without_sauce", "Lettuce green leaf raw", "169249", 50, 100, "Ensalada sin aderezo"),
    (12, "mixed_salad_chopped_without_sauce", "Tomatoes red ripe raw", "170457", 30, 100, "Ensalada sin aderezo"),
    (12, "mixed_salad_chopped_without_sauce", "Carrots raw", "170393", 10, 100, "Ensalada sin aderezo"),
    (12, "mixed_salad_chopped_without_sauce", "Cucumber with peel raw", "168409", 10, 100, "Ensalada sin aderezo"),
    (150, "bolognaise_sauce", "Tomato products canned sauce", "170054", 60, 150, "Salsa de tomate"),
    (150, "bolognaise_sauce", "Beef ground cooked 85/15", "174034", 30, 150, "Carne picada cocida"),
    (150, "bolognaise_sauce", "Onions raw", "170000", 5, 150, "Cebolla"),
    (150, "bolognaise_sauce", "Carrots raw", "170393", 5, 150, "Zanahoria"),
    (165, "ham_croissant_ch", "Croissant", "2707678", 70, 90, "Croissant"),
    (165, "ham_croissant_ch", "Ham sliced regular", "173864", 30, 90, "Jamon cocido"),
    (166, "salt_cake_ch_vegetables_filled", "Wheat flour white bleached", "168894", 30, 100, "Masa"),
    (166, "salt_cake_ch_vegetables_filled", "Egg whole raw", "748967", 20, 100, "Huevo"),
    (166, "salt_cake_ch_vegetables_filled", "Milk whole", "171265", 25, 100, "Leche"),
    (166, "salt_cake_ch_vegetables_filled", "Cheese gouda", "171241", 10, 100, "Queso"),
    (166, "salt_cake_ch_vegetables_filled", "Squash summer zucchini cooked", "169292", 10, 100, "Verdura"),
    (166, "salt_cake_ch_vegetables_filled", "Butter salted", "173410", 5, 100, "Mantequilla"),
    (181, "birchermuesli_prepared_no_sugar_added", "Cereals oats regular and quick dry", "173904", 25, 150, "Avena"),
    (181, "birchermuesli_prepared_no_sugar_added", "Yogurt plain whole milk", "171284", 50, 150, "Yogur"),
    (181, "birchermuesli_prepared_no_sugar_added", "Apples raw", "2709215", 15, 150, "Manzana rallada"),
    (181, "birchermuesli_prepared_no_sugar_added", "Hazelnuts raw", "2515375", 5, 150, "Avellanas"),
    (181, "birchermuesli_prepared_no_sugar_added", "Milk whole", "171265", 5, 150, "Leche"),
    (189, "french_pizza_from_alsace_baked", "Wheat flour white bleached", "168894", 40, 200, "Masa"),
    (189, "french_pizza_from_alsace_baked", "Cream sour cultured", "171257", 20, 200, "Creme fraiche (aprox. nata agria)"),
    (189, "french_pizza_from_alsace_baked", "Onions raw", "170000", 15, 200, "Cebolla"),
    (189, "french_pizza_from_alsace_baked", "Bacon cooked", "168322", 10, 200, "Bacon"),
    (189, "french_pizza_from_alsace_baked", "Mozzarella whole milk", "170845", 15, 200, "Queso"),
    (191, "porridge_prepared_with_partially_skimmed_milk", "Oats cooked with water without salt", "173905", 60, 250, "Avena cocida"),
    (191, "porridge_prepared_with_partially_skimmed_milk", "Milk lowfat 1%", "170872", 40, 250, "Leche semidesnatada"),
    (200, "risotto", "Rice white long grain cooked", "168878", 60, 250, "Arroz cocido"),
    (200, "risotto", "Mushrooms white raw", "169251", 20, 250, "Champinones"),
    (200, "risotto", "Cheese parmesan hard", "170848", 5, 250, "Parmesano"),
    (200, "risotto", "Butter salted", "173410", 5, 250, "Mantequilla"),
    (200, "risotto", "Soup chicken broth ready-to-serve", "174536", 10, 250, "Caldo"),
    (247, "pie_apricot", "Pie crust baked frozen", "175025", 35, 120, "Masa de tarta"),
    (247, "pie_apricot", "Apricots raw", "171697", 40, 120, "Albaricoque"),
    (247, "pie_apricot", "Sugars granulated", "169655", 15, 120, "Azucar"),
    (247, "pie_apricot", "Egg whole raw", "748967", 10, 120, "Huevo"),
    (248, "pie_plum_baked_with_cake_dough", "Pie crust baked frozen", "175025", 35, 120, "Masa de tarta"),
    (248, "pie_plum_baked_with_cake_dough", "Plums raw", "169949", 45, 120, "Ciruela"),
    (248, "pie_plum_baked_with_cake_dough", "Sugars granulated", "169655", 15, 120, "Azucar"),
    (248, "pie_plum_baked_with_cake_dough", "Egg whole raw", "748967", 5, 120, "Huevo"),
    (251, "mixed_milk_beverage", "Milk whole", "171265", 60, 200, "Leche"),
    (251, "mixed_milk_beverage", "Soymilk unsweetened", "175215", 20, 200, "Bebida de soja"),
    (251, "mixed_milk_beverage", "Oat milk unsweetened refrigerated", "2257046", 20, 200, "Bebida de avena"),
    (272, "sauce_mushroom", "Cream heavy", "2346386", 40, 80, "Nata"),
    (272, "sauce_mushroom", "Mushrooms white raw", "169251", 30, 80, "Champinones"),
    (272, "sauce_mushroom", "Butter salted", "173410", 10, 80, "Mantequilla"),
    (272, "sauce_mushroom", "Wheat flour white bleached", "168894", 5, 80, "Harina"),
    (272, "sauce_mushroom", "Milk whole", "171265", 15, 80, "Leche"),
    (178, "glucose_drink_50g", "Sugars granulated", "169655", 25, 200, "Glucosa aproximada con azucar"),
    (178, "glucose_drink_50g", "Water bottled generic", "174158", 75, 200, "Agua"),
]
sums = {}
for r in RECETAS:
    sums[r[0]] = sums.get(r[0], 0) + r[4]
bad = {k: v for k, v in sums.items() if v != 100}
print("recipes:", len(sums), "| sum != 100:", bad)
recetas_ids = {r[0] for r in RECETAS}
rec_expected = {i for i, d in dec.items() if d["decision"] == "receta"}
print("recipe in decisions without recipe row:", sorted(rec_expected - recetas_ids), "| rows without recipe decision:", sorted(recetas_ids - rec_expected))

with open(ROOT / "recetas.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["idx", "clase", "ingrediente", "fdc_id", "gramos_100g_plato", "porcion_g", "nota"])
    for r in RECETAS:
        w.writerow(r)
print("OK")
