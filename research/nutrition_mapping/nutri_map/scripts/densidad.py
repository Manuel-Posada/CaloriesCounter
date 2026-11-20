import json, re, statistics
from pathlib import Path
import pandas as pd

OUT = Path(__file__).resolve().parents[1]
M = json.loads((OUT / "nutrition_map.json").read_text(encoding="utf-8"))
DEC = pd.read_csv(OUT / "decisiones_resumen.csv", dtype=str).fillna("")

# Unidades de volumen. Las líquidas tienen prioridad: en FNDDS muchas porciones
# traen "1 cup (8 fl oz)" y la cantidad fiable es la de fl oz.
LIQUID = [(r"\bfl\.?\s*oz\b", 29.5735), (r"\bml\b|\bmilliliters?\b", 1.0), (r"\bliters?\b|\blitres?\b", 1000.0)]
SOLID = [(r"\bcups?\b", 236.588), (r"\btbsp\b|\btablespoons?\b", 14.7868),
         (r"\btsp\b|\bteaspoons?\b", 4.92892), (r"\bpints?\b", 473.176), (r"\bquarts?\b", 946.353),
         (r"\bgallons?\b", 3785.41)]
NUM = r"(\d+(?:\.\d+)?|\d+/\d+|\d+\s+\d+/\d+)"
CONTAINER = r"\b(bottle|can|carton|box|pouch|package|packet|jar|container)\b"
# Medidas de una forma distinta a la del alimento tal como se sirve, o envases
# sin volumen explícito: no sirven para densidad aparente del plato.
SKIP_FORM = r"with ice|\bice\b|yield"
SKIP_CUP = r"ice cream\s+cup|espresso\s+cup|coffee\s+cup|tea\s+cup"
BULK = r"chopped|sliced|diced|shredded|grated|mashed|pureed|cut|crumbled|minced|slices|pieces|cubed|julienne|strips|rings|halves|balls|cubes"


def to_num(s):
    s = s.strip()
    if "/" in s:
        parts = s.split()
        if len(parts) == 2:
            a, b = parts[1].split("/")
            return float(parts[0]) + float(a) / float(b)
        a, b = s.split("/")
        return float(a) / float(b)
    return float(s)


def _pairs(txt, units):
    out = []
    for rx, ml in units:
        for m in re.finditer(NUM + r"\s*(?:[a-zA-Z.]+\s+){0,3}(?:" + rx + r")", txt, re.I):
            try:
                qty = to_num(m.group(1))
            except (ValueError, ZeroDivisionError):
                continue
            if qty > 0:
                out.append((qty, ml))
    return out


def usda_volume_density(portions):
    """Densidad a partir de medidas de volumen de USDA/FNDDS.

    La cantidad puede venir en `amount` o escrita en el texto de la porción
    (FNDDS suele traer amount=null y "1 cup" en description). Se descartan
    medidas de otra forma (fundido, rallado, picado) y envases sin volumen.
    """
    cands = []
    for p in portions or []:
        gw = p.get("gram_weight")
        txt = " ".join(str(x or "") for x in (p.get("modifier"), p.get("description"), p.get("unit")))
        low = txt.lower().strip()
        if not gw or re.search(SKIP_FORM, low):
            continue
        explicit = re.search(r"fl\.?\s*oz|\bml\b|\bmilliliters?\b|\bliters?\b|\blitres?\b", low)
        if re.search(CONTAINER, low) and not explicit:
            continue
        if re.search(SKIP_CUP, low) and not explicit:
            continue
        pairs = _pairs(low, LIQUID) or _pairs(low, SOLID)
        if not pairs and p.get("amount"):
            # "1 tbsp"/"1 cup" sin número en el texto: la unidad está en modifier
            for rx, ml in SOLID + LIQUID:
                if re.search(rx, low):
                    pairs = [(float(p["amount"]), ml)]
                    break
        for qty, ml in pairs:
            d = gw / (qty * ml)
            if 0.02 <= d <= 3.0:
                cands.append((d, bool(re.search(BULK, low)), low))
                break
    if not cands:
        return None
    plain = [c for c in cands if not c[1]]
    use = plain or cands
    return round(statistics.median(c[0] for c in use), 3), bool(plain), "; ".join(f"{c[2]}={c[0]:.2f}" for c in use[:3])


# Medidas USDA recuperadas que NO se usan porque la porción mide otra forma
# física del alimento (fruta entera vs. rodajas, bloque vs. rallado, etc.).
NO_USDA = {
    39: "manzana entera: la medida USDA es 1 cup en láminas (0,53), no la pieza entera",
    57: "naranja entera: la medida USDA es 1 cup en gajos (0,76), no la pieza entera",
    105: "pan de molde: 1 cup son trozos sueltos (0,17); la rebanada tiene ~0,29",
    106: "pan tostado: 1 cup son trozos sueltos (0,17); la rebanada tiene ~0,29",
    113: "pan en hogaza: 1 cup son trozos sueltos (0,17); la hogaza tiene ~0,29",
    119: "rebanada de meatloaf: 1 cup son dados sueltos (0,59); la rebanada es ~1,0",
    124: "filete de pescado: 1 cup es pescado desmenuzado (0,57); el filete es ~1,05",
    177: "salmón ahumado en lonchas: 1 cup son lonchas sueltas (0,57); la loncha es ~1,0",
    205: "patata entera: 1 cup son dados (0,68); se mantiene la referencia FAO de patata cocida",
    259: "pan sin gluten: 1 cup son trozos sueltos (0,17); la rebanada tiene ~0,29",
    302: "muesli crujiente: la entrada USDA es cereal inflado (0,15), no muesli en grumos",
    309: "jamón en lonchas: 1 cup son dados sueltos (0,57); la loncha apilada es ~1,05",
    254: "pan de molde: 1 cup son dados/migas (0,15-0,19); la rebanada tiene ~0,29",
    261: "pan blanco: 1 cup son dados/migas (0,15-0,19); la rebanada tiene ~0,29",
    82: "queso fresco en bloque: 1 cup es queso desmenuzado (0,52), no el bloque",
    83: "gruyère en bloque: 1 cup es rallado o en dados (0,46-0,56), no el bloque",
    85: "mozzarella en bloque: 1 cup es rallado (0,47), no la pieza",
    289: "queso azul en bloque: 1 cup es desmenuzado (0,57), no la pieza",
    116: "pechuga entera: 1 cup es pollo picado (0,59), no la pieza",
    315: "pera entera: 1 cup son dados o láminas (0,59-0,68), no la pieza",
}


# Valores medidos en tablas publicadas, aplicados a una clase concreta.
# Cada entrada: idx -> (densidad, tipo, fuente, confianza)
# Fuente principal: tabla 4.2 "Density of Selected Foods" de Engineering Properties
# of Foods (3.a ed., p. 153), que recoge densidades verdaderas (no a granel).
T42 = "referencia tabulada: tabla 4.2 de Engineering Properties of Foods"
PUB = {}

# --- carnes y pescados compactos (filete, loncha, pieza) ---
# Tabla 4.2: carnes 74-84 % de agua, beef rho = 1076 - 1,37*x_f (kg/m3) -> 1,05-1,07;
# pescado magro 1,055 y pescado graso 0,93. Se usa 1,055 para la pieza compacta.
for i in (117, 118, 119, 121, 198, 228, 294, 309, 317):
    PUB[i] = (1.055, "sólido", T42 + ": carnes 74-84 % agua, 1,05-1,07 g/cm3", "media")
for i in (124, 125, 126, 177):
    PUB[i] = (1.055, "sólido", T42 + ": pescado, 1,055 g/cm3 (magro)", "media")

# --- fruta y queso ---
# Tabla 4.2: manzanas 775-925 kg/m3 (20 C); peras 1000 kg/m3; queso 1080-1230 kg/m3.
PUB[39] = (0.85, "sólido", T42 + ": manzana 775-925 kg/m3, punto medio", "media")
PUB[315] = (1.00, "sólido", T42 + ": peras 1000 kg/m3", "media")
for i in (86, 290, 291):
    PUB[i] = (1.15, "sólido", T42 + ": queso 1080-1230 kg/m3", "media")
PUB[83] = (1.15, "sólido", T42 + ": queso 1080-1230 kg/m3", "media")
PUB[289] = (1.15, "sólido", T42 + ": queso 1080-1230 kg/m3", "media")
PUB[82] = (1.08, "sólido", T42 + ": queso 1080-1230 kg/m3, extremo bajo (queso fresco)", "media")
PUB[85] = (1.08, "sólido", T42 + ": queso 1080-1230 kg/m3, extremo bajo (mozzarella)", "media")
PUB[116] = (1.055, "sólido", T42 + ": carnes 74-84 % agua, 1,05-1,07 g/cm3", "media")

# --- frutos secos y semillas (FAO/INFOODS, tabla 2) ---
for i in (71, 73):
    PUB[i] = (0.63, "aparente (a granel)", "FAO/INFOODS Density DB v2: Nuts", "media")
PUB[66] = (0.62, "aparente (a granel)", "FAO/INFOODS Density DB v2: Sunflower, seed (proxy de semillas peladas)", "media")
PUB[183] = (1.082, "sólido", "referencia tabulada: USDA (FNDDS), mantequilla de cacahuete 1,082 g/cm3 (proxy de crema de frutos secos)", "media")

# Patata entera: USDA AMS publica la prueba de peso especifico de la patata
# (tabla de conversion con valores ~1,06), que es la densidad de la pieza.
PUB[206] = (1.06, "sólido", "referencia tabulada: USDA AMS, peso especifico de la patata (~1,06)", "media")

# --- panes y bolleria salada (FAO/INFOODS: pan 0,29; pan blanco 0,42; panecillo blando 0,18) ---
for i in (104, 105, 106, 107, 108, 109, 111, 112, 113, 182, 254, 255, 256, 258, 259, 260, 261, 262, 263):
    PUB[i] = (0.29, "aparente (a granel)", "FAO/INFOODS Density DB v2: Bread / Bread, white, sliced, prepacked", "media")

# Valores de la base FAO/INFOODS Density Database v2.0 (tabla 2), aplicados a la clase concreta.
FAO = {
    11: (0.68, "Stew, vegetable"),
    65: (0.62, "Sunflower, seed"),
    70: (0.46, "Almonds"),
    75: (0.646, "Pistachio, raw, without shell"),
    77: (0.65, "Olives, green, with stone"),
    98: (0.59, "Pasta/ noodles, boiled"),
    99: (0.59, "Pasta/ noodles, boiled"),
    100: (0.59, "Pasta/ noodles, boiled"),
    101: (0.59, "Pasta/ noodles, boiled"),
    131: (1.26, "Nutella"),
    134: (0.415, "Cake"),
    137: (0.415, "Cake"),
    138: (0.415, "Cake"),
    145: (1.03, "Tea, ready-to-drink, LIPTON BRISK iced tea"),
    167: (1.04, "Lasagna"),
    187: (1.054, "Bean soup"),
    188: (1.04, "Lasagna"),
    193: (0.415, "Cake"),
    196: (0.63, "Nuts"),
    205: (0.59, "Potato, english, boiled"),
    240: (1.10, "Salad dressing"),
    264: (0.59, "Pasta/ noodles, boiled"),
    265: (0.59, "Pasta/ noodles, boiled"),
    266: (0.59, "Pasta/ noodles, boiled"),
    267: (0.59, "Pasta/ noodles, boiled"),
    268: (0.59, "Pasta/ noodles, boiled"),
    275: (0.77, "Prawns, whole, boiled, without shell"),
    283: (0.51, "Sweet pepper, raw, cubes"),
    298: (0.99, "Soup, vegetable"),
    299: (1.09, "Soup, thick (squash, potato)"),
}

# Referencias de tabla para clases que USDA no mide en volumen.
REF = {
    "butter": (0.911, "Engineering ToolBox: mantequilla"),
    "mayonnaise": (0.910, "Engineering ToolBox: mayonesa"),
    "oil": (0.920, "Engineering ToolBox: aceite vegetal"),
    "cashew": (0.560, "Engineering ToolBox: anacardos"),
    "peanut": (0.650, "Engineering ToolBox: cacahuetes sin cáscara"),
    "coconut": (0.335, "Engineering ToolBox: coco rallado (320-352 kg/m3)"),
    "oats": (0.420, "Engineering ToolBox: avena"),
    "flakes": (0.420, "Engineering ToolBox: avena en copos"),
    "beets": (0.760, "Engineering ToolBox: remolacha entera"),
    "beetroot": (0.760, "Engineering ToolBox: remolacha entera"),
    "bread": (0.290, "FAO/INFOODS Density DB v2: pan blanco en rebanadas"),
    "breadcrumbs": (0.450, "FAO/INFOODS Density DB v2: pan rallado"),
    "biscuit": (0.470, "FAO/INFOODS Density DB v2: galletas (0,41-0,53)"),
    "cookie": (0.470, "FAO/INFOODS Density DB v2: galletas (0,41-0,53)"),
    "muesli": (0.370, "FAO/INFOODS Density DB v2: muesli con frutas y frutos secos"),
    "rice": (0.750, "FAO/INFOODS Density DB v2: arroz (cáscara retirada, en seco)"),
    "honey": (1.420, "Referencia de física alimentaria: miel"),
}

IDX_REF = {231: "butter", 278: "mayonnaise", 72: "cashew", 226: "peanut", 74: "coconut", 307: "flakes",
           25: "beets", 114: "breadcrumbs", 236: "biscuit", 142: "cookie", 143: "cookie", 302: "muesli", 303: "muesli",
           285: "honey", 254: "bread", 261: "bread", 262: "bread"}

# Cálculo geométrico para las clases sin medición publicada de densidad.
# rho = masa de la porción (USDA) / volumen de un sólido de dimensiones típicas.
# Las dimensiones son tamaños comerciales o de porción estándar, NO medidos sobre
# la foto: el resultado es una densidad calculada, no una medida.
#   forma: esfera (d), elipsoide (L, A, H), cilindro/disco (d, h), prisma (a, b, c),
#          cuña de pizza (D, grosor, n_porciones), cono (r, h), taza (V = 236,6 cm3)
GEOM = {
    # fruta y hortaliza de una pieza
    15: (128, "elipsoide", (8.0, 8.0, 8.5), "1 alcachofa mediana USDA"),
    19: (40.4, "cilindro", (2.8, 8.0), "1 pepinillo USDA"),
    20: (300, "cilindro", (4.4, 21.0), "1 pepino típico"),
    24: (10, "esfera", (2.7,), "1 rábano típico"),
    32: (50, "elipsoide", (5.0, 5.0, 4.5), "1 cabeza de ajo típica"),
    38: (1200, "cilindro", (10.0, 22.0), "1 piña mediana, diámetro medio"),
    46: (50, "elipsoide", (5.7, 4.5, 4.0), "1 higo mediano USDA (2 1/4\")"),
    50: (168, "elipsoide", (7.2, 7.2, 6.2), "1 caqui; masa USDA 168 g (la medida 2 1/2\" no cuadra con ese peso)"),
    52: (75, "elipsoide", (6.5, 4.7, 4.7), "1 kiwi típico (la porción USDA de 140 g es un fruto grande)"),
    57: (154, "esfera", (7.2,), "1 naranja USDA"),
    306: (230, "elipsoide", (8.0, 8.0, 7.0), "1 bulbo de hinojo típico (sin tallos)"),
    # bayas servidas en taza
    48: (148, "taza", (), "1 taza de arándanos USDA"),
    49: (123, "taza", (), "1 taza de frambuesas USDA"),
    # platos y productos
    110: (65, "prisma", (10.0, 10.0, 1.5), "1 rebanada USDA"),
    115: (10, "prisma", (7.5, 4.5, 1.0), "1 biscote USDA"),
    120: (28, "prisma", (10.0, 4.0, 1.0), "10 lonchas finas USDA (0,1 cm cada una)"),
    128: (39, "esfera", (4.0,), "1 pieza USDA"),
    130: (162, "prisma", (18.0, 8.0, 1.0), "1 tableta USDA"),
    133: (50, "prisma", (5.0, 5.0, 3.5), "1 brownie mediano USDA"),
    135: (65, "disco", (24.0, 0.25), "1 crepe USDA"),
    136: (125, "disco", (11.0, 3.0), "1 tarta USDA"),
    140: (125, "disco", (11.0, 3.0), "1 tarta USDA"),
    141: (57, "elipsoide", (12.0, 7.0, 5.0), "1 croissant USDA"),
    159: (17, "esfera", (3.6,), "1 falafel USDA"),
    160: (11, "prisma", (8.0, 3.0, 1.5), "1 pastelito USDA"),
    164: (68, "prisma", (10.0, 3.5, 3.5), "1 rollito USDA"),
    172: (100, "cilindro", (7.0, 4.5), "1 ración típica"),
    210: (57, "elipsoide", (12.0, 7.0, 5.0), "1 croissant mediano USDA"),
    214: (108, "cuña", (30.0, 1.4, 8), "1 trozo mediano USDA (pizza 12\")"),
    215: (103, "cuña", (30.0, 1.6, 8), "1 trozo USDA (pizza 12\")"),
    216: (69, "cuña", (30.0, 1.0, 8), "1 trozo USDA (pizza fina 12\")"),
    217: (103, "cuña", (30.0, 1.6, 8), "1 trozo USDA (pizza 12\")"),
    218: (145, "cilindro", (10.0, 4.5), "1 hamburguesa USDA"),
    219: (160, "cilindro", (10.5, 4.5), "1 hamburguesa vegetal USDA"),
    225: (50, "disco", (12.0, 0.9), "1 tortita mediana USDA"),
    274: (60, "cilindro", (5.5, 2.5), "1 cucharón USDA"),
    281: (11.5, "prisma", (14.0, 4.0, 0.3), "1 loncha USDA"),
    282: (85, "cono", (5.0, 4.0), "1 ración USDA en montón"),
    292: (28.35, "cilindro", (4.0, 2.5), "1 onza USDA"),
    293: (28.35, "cilindro", (4.0, 2.5), "1 onza USDA"),
    312: (85, "cono", (5.0, 4.0), "1 ración USDA en montón"),
    316: (85, "cono", (5.0, 4.0), "1 ración USDA en montón"),
    320: (85, "taza", (), "1 taza de col en tiras USDA"),
}


def geom_volumen(forma, d):
    if forma == "esfera":
        return 3.141592653589793 / 6 * d[0] ** 3
    if forma == "elipsoide":
        return 3.141592653589793 / 6 * d[0] * d[1] * d[2]
    if forma in ("cilindro", "disco"):
        return 3.141592653589793 / 4 * d[0] ** 2 * d[1]
    if forma == "prisma":
        return d[0] * d[1] * d[2]
    if forma == "cuña":
        return (3.141592653589793 / 4 * d[0] ** 2 * d[1]) / d[2]
    if forma == "cono":
        return 3.141592653589793 / 3 * d[0] ** 2 * d[1]
    if forma == "taza":
        return 236.588
    raise ValueError(forma)


def geom_dim_txt(forma, d):
    if forma == "esfera":
        return f"esfera d={d[0]:.1f} cm"
    if forma == "elipsoide":
        return f"elipsoide {d[0]:.1f}x{d[1]:.1f}x{d[2]:.1f} cm"
    if forma == "cilindro":
        return f"cilindro d={d[0]:.1f} cm, h={d[1]:.1f} cm"
    if forma == "disco":
        return f"disco d={d[0]:.1f} cm, grosor {d[1]:.2f} cm"
    if forma == "prisma":
        return f"prisma {d[0]:.1f}x{d[1]:.1f}x{d[2]:.2f} cm"
    if forma == "cuña":
        return f"cuña de pizza D={d[0]:.1f} cm, grosor {d[1]:.1f} cm, 1/{d[2]}"
    if forma == "cono":
        return f"montón cónico r={d[0]:.1f} cm, h={d[1]:.1f} cm"
    return "taza (236,6 cm3)"

# Clases que siguen siendo estimación: no hay medición publicada de su densidad
# en la forma en que se sirven.
MOTIVO = {
    48: "arándanos sueltos apilados: no se localizó densidad a granel publicada",
    49: "frambuesas sueltas apiladas: no se localizó densidad a granel publicada",
    110: "torrija (pan empapado y frito): plato compuesto sin densidad publicada",
    115: "biscote: FAO no tiene entrada; galletas (0,41-0,53) y pan (0,29) no son la misma forma",
    120: "cecina: la tabla 4.2 solo cubre carne fresca (74-84 % agua), no carne seca",
    128: "praliné: dulce de azúcar y frutos secos sin densidad publicada",
    130: "chocolate negro: sin densidad publicada en las tablas consultadas",
    133: "brownie: repostería compuesta sin densidad publicada",
    135: "crepe: plato compuesto sin densidad publicada",
    136: "tarta de fruta: masa + fruta, sin densidad publicada",
    140: "tarta: masa + relleno, sin densidad publicada",
    141: "croissant relleno: bollería laminada sin densidad publicada",
    159: "falafel: fritura de legumbre sin densidad publicada",
    160: "hojaldre: masa laminada cruda sin densidad publicada",
    164: "rollito de primavera frito: sin densidad publicada",
    172: "mousse de chocolate: postre aireado sin densidad publicada",
    210: "croissant: bollería laminada sin densidad publicada",
    214: "pizza: plato compuesto sin densidad publicada",
    215: "pizza: plato compuesto sin densidad publicada",
    216: "pizza: plato compuesto sin densidad publicada",
    217: "pizza: plato compuesto sin densidad publicada",
    218: "hamburguesa completa (pan + carne): sin densidad publicada",
    219: "hamburguesa vegetal con pan: sin densidad publicada",
    225: "tortita (pancake): plato compuesto sin densidad publicada",
    274: "salsa bechamel: FAO solo tabula salsa de soja y sopas",
    281: "beicon frito en lonchas apiladas: sin densidad publicada",
    282: "carne picada desmenuzada en montón: la tabla 4.2 mide la pieza compacta, no el montón",
    292: "queso blando de cabra: la tabla 4.2 solo da quesos de 1,08-1,23 g/cm3",
    293: "queso blando de cabra: la tabla 4.2 solo da quesos de 1,08-1,23 g/cm3",
    312: "carne picada desmenuzada en montón: la tabla 4.2 mide la pieza compacta, no el montón",
    316: "carne picada desmenuzada en montón: la tabla 4.2 mide la pieza compacta, no el montón",
    320: "col lombarda cruda en tiras: sin densidad publicada",
}


def norm(s):
    s = str(s or "").lower().replace("_", " ")
    s = re.sub(r"\b(no|without|sin)\s+(added\s+)?(dressing|sauce|salt|sugar)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def cat_density(desc, cls=""):
    """Densidad aparente de un alimento tal como se sirve. Devuelve (g/cm3, tipo, fuente, confianza)."""
    s = norm(desc) or norm(cls)
    def R(d, tipo, fuente="estimación por categoría", conf="baja"):
        return d, tipo, fuente, conf

    # --- platos preparados (antes que los ingredientes que contienen) ---
    if re.search(r"\bsoup\b", s):
        if re.search(r"thick|pumpkin|squash|potato|cream", s):
            return R(1.09, "aparente (a granel)", "estimación por categoría (FAO: sopa espesa)")
        return R(0.99, "aparente (a granel)", "estimación por categoría (FAO: sopa)")
    if re.search(r"lasagn", s): return R(1.04, "aparente (a granel)", "estimación por categoría (FAO: lasaña)")
    if re.search(r"ratatouille", s): return R(0.70, "aparente (a granel)", "estimación por categoría (FAO: guiso de verduras)")
    if re.search(r"\bstew\b|goulash", s): return R(1.0, "aparente (a granel)", "estimación por categoría (FAO: guiso)")
    if re.search(r"chili", s): return R(1.0, "aparente (a granel)", "estimación por categoría (guiso con carne)")
    if re.search(r"curry sauce", s): return R(1.02, "líquido")
    if re.search(r"curry", s): return R(1.0, "aparente (a granel)", "estimación por categoría (plato con salsa)")
    if re.search(r"spring roll|egg roll|rice paper", s): return R(0.80, "aparente (a granel)")
    if re.search(r"pizza", s): return R(0.65, "aparente (a granel)", "estimación por categoría (pizza en porciones)")
    if re.search(r"hamburger|\bburger\b", s): return R(0.60, "aparente (a granel)", "estimación por categoría (bocadillo/burger)")
    if re.search(r"falafel", s): return R(0.70, "aparente (a granel)")
    if re.search(r"sushi", s): return R(0.95, "sólido")
    if re.search(r"tabbouleh|taboule", s): return R(0.75, "aparente (a granel)")
    if re.search(r"potato salad", s): return R(0.85, "aparente (a granel)")
    if re.search(r"greek salad|caprese|mozzarella.*tomato|tomato.*mozzarella", s): return R(0.88, "aparente (a granel)")
    if re.search(r"fruit salad", s): return R(0.85, "aparente (a granel)")
    if re.search(r"guacamole|tzatziki", s): return R(1.0, "pasta")
    if re.search(r"hummus", s): return R(1.05, "pasta")
    if re.search(r"mousse", s): return R(0.90, "aparente (a granel)", "estimación por categoría (postre aireado)")
    if re.search(r"tiramisu|cheesecake", s): return R(0.95, "aparente (a granel)")
    if re.search(r"quiche", s): return R(0.55, "aparente (a granel)")
    if re.search(r"french toast", s): return R(0.55, "aparente (a granel)")
    if re.search(r"meat loaf|meatloaf", s): return R(1.0, "sólido")
    if re.search(r"gnocchi", s): return R(1.0, "sólido")
    if re.search(r"fries|french fried|fried potatoes", s): return R(0.50, "aparente (a granel)", "estimación por categoría (patatas fritas)")
    if re.search(r"potato.*baked|baked potato", s): return R(0.95, "sólido")

    # --- salsas y untables ---
    if re.search(r"gravy", s): return R(1.02, "líquido")
    if re.search(r"pesto", s): return R(1.05, "pasta")
    if re.search(r"curry sauce", s): return R(1.02, "líquido")
    if re.search(r"\bsauce\b|\bsalsa\b", s): return R(1.02, "líquido")
    if re.search(r"dressing|vinaigrette", s): return R(1.10, "líquido", "estimación por categoría (FAO: aliño)")
    if re.search(r"coulis|topping", s): return R(1.10, "líquido")
    if re.search(r"jam|marmalade|preserve|syrup|\bhoney\b", s):
        return R(1.33, "sólido", "estimación por categoría (FAO: confitura/sirope)")

    # --- bebidas ---
    if re.search(r"\bwater\b|\bagua\b", s): return R(1.00, "líquido", "física: agua", "alta")
    if re.search(r"ice cream|helado", s): return R(0.55, "aparente (a granel)", "referencia: helado (aireado)", "media")
    if re.search(r"\bcream\b|\bcrema\b|\bnata\b|\bheavy\b", s) and not re.search(r"cream cheese", s):
        return R(0.99, "líquido", "referencia: nata", "media")
    if re.search(r"\bmilk\b|\bleche\b|kefir|yogh?urt|yaourt", s):
        return R(1.03, "líquido", "referencia: leche/yogur", "media")
    if re.search(r"\bjuice\b|\bzumo\b|\bcola\b|soft drink|\bsoda\b", s):
        return R(1.04, "líquido", "referencia: zumo/refresco", "media")
    if re.search(r"\bwine\b|\bvino\b", s): return R(0.99, "líquido", "referencia: vino", "media")
    if re.search(r"\bbeer\b|cerveza", s): return R(1.01, "líquido", "referencia: cerveza", "media")
    if re.search(r"liqueur|spirit|aperitif|amaretto|brandy", s): return R(1.05, "líquido", "referencia: licor", "media")
    if re.search(r"coffee|\bcafe\b|espresso|ristretto|\btea\b|cappuccino|latte|macchiato|smoothie|\bdrink\b|punch|beverage", s):
        return R(1.00, "líquido")

    # --- bollería y cereales ---
    if re.search(r"rusk|crouton|crispbread", s): return R(0.30, "aparente (a granel)", "estimación por categoría (pan tostado)")
    if re.search(r"\bbread\b|baguette|bagel|\bpita\b|naan|focaccia|\btoast\b|brioche|pretzel|\broll\b|tortilla|fajita", s):
        return R(0.29, "aparente (a granel)", "estimación por categoría (FAO: pan en rebanadas)")
    if re.search(r"cracker", s): return R(0.40, "aparente (a granel)")
    if re.search(r"\bchips\b|crisps|puffed snack|popcorn", s): return R(0.20, "aparente (a granel)", "estimación por categoría (snack aireado)")
    if re.search(r"brownie", s): return R(0.65, "aparente (a granel)")
    if re.search(r"\bcake\b|cupcake|muffin", s): return R(0.415, "aparente (a granel)", "estimación por categoría (FAO: pastel)")
    if re.search(r"pancake|crepe|omelet", s): return R(0.65, "aparente (a granel)")
    if re.search(r"pastry|croissant|\btart\b|\bpie\b|puff", s): return R(0.45, "aparente (a granel)")
    if re.search(r"chocolate|candy|praline|nougat", s): return R(1.30, "sólido", "referencia: chocolate")
    if re.search(r"pasta|noodle|spaghetti|macaroni|penne|farfalle|linguini|tagliatelle|spaetzle", s):
        if re.search(r"cooked|boiled", s) or not re.search(r"raw|dry", s):
            return R(0.59, "aparente (a granel)", "estimación por categoría (FAO: pasta cocida)")
        return R(0.60, "aparente (a granel)")
    if re.search(r"\brice\b", s):
        if re.search(r"cooked|boiled", s): return R(0.73, "aparente (a granel)", "estimación por categoría (FAO: arroz cocido)")
        return R(0.85, "aparente (a granel)")
    if re.search(r"\bgrain\b|khorasan", s): return R(0.75, "aparente (a granel)")
    if re.search(r"porridge|oatmeal", s): return R(0.95, "aparente (a granel)")
    if re.search(r"\boat|flakes|muesli|cereal|granola|crunch", s):
        return R(0.42, "aparente (a granel)", "referencia: avena/cereales", "media")
    if re.search(r"lentil|chickpea|\bbeans?\b|\bpeas?\b|soybean", s):
        return R(0.75 if re.search(r"cooked|boiled", s) else 0.80, "aparente (a granel)")

    # --- lácteos y huevo ---
    if re.search(r"fondue", s): return R(1.05, "sólido")
    if re.search(r"cheese|queso|emmental|gruyere|tomme|raclette|halloumi|parmesan|mozzarella|feta|paneer|gouda|monterey|cottage|curd", s):
        if re.search(r"parmesan|gruyere|emmental|raclette|tomme|gouda|swiss|monterey|halloumi|paneer|hard", s):
            return R(1.15, "sólido", "estimación por categoría (queso duro)")
        if re.search(r"cottage|curd|ricotta|feta|mozzarella|goat|soft|brie|camembert", s):
            return R(1.02, "sólido", "estimación por categoría (queso blando)")
        return R(1.10, "sólido", "estimación por categoría (queso)")
    if re.search(r"\begg\b|huevo", s):
        if re.search(r"boiled|hard|cooked", s): return R(0.60, "aparente (a granel)", "estimación por categoría (FAO: huevo cocido)")
        return R(1.03, "sólido", "referencia: huevo entero", "media")

    # --- carne, pescado, embutidos ---
    if re.search(r"shrimp|prawn", s): return R(0.77, "aparente (a granel)", "estimación por categoría (FAO: gambas cocidas)")
    if re.search(r"bacon", s): return R(0.60, "aparente (a granel)")
    if re.search(r"dried meat|jerky", s): return R(1.10, "sólido")
    if re.search(r"sausage|salami|cervelat|thuringer|\bham\b|jamon", s): return R(1.05, "sólido")
    if re.search(r"smoked salmon", s): return R(1.00, "sólido")
    if re.search(r"fish|salmon|tuna|cod|pollock|trout", s): return R(1.05, "sólido")
    if re.search(r"nugget", s): return R(0.75, "aparente (a granel)")
    if re.search(r"meat|chicken|beef|pork|veal|\blamb\b|turkey|game|deer|ostrich|emu|cordon bleu", s):
        return R(0.95, "sólido")

    # --- frutos secos y semillas ---
    if re.search(r"peanut butter|almond butter|nut butter|cashew butter", s): return R(1.10, "sólido")
    if re.search(r"almond", s): return R(0.46, "aparente (a granel)", "estimación por categoría (FAO: almendras)")
    if re.search(r"peanut", s): return R(0.69, "aparente (a granel)", "estimación por categoría (FAO: cacahuetes)")
    if re.search(r"pistachio", s): return R(0.65, "aparente (a granel)", "estimación por categoría (FAO: pistachos)")
    if re.search(r"walnut|hazelnut|cashew|pecan|macadamia|\bnuts?\b", s):
        return R(0.63, "aparente (a granel)", "estimación por categoría (FAO: frutos secos)")
    if re.search(r"seed|sunflower|sesame|pumpkin", s):
        return R(0.62, "aparente (a granel)", "estimación por categoría (FAO: semillas)")

    # --- frutas ---
    if re.search(r"olive", s): return R(0.65, "aparente (a granel)", "estimación por categoría (FAO: aceitunas)")
    if re.search(r"pineapple", s): return R(0.85, "sólido")
    if re.search(r"apple|pear", s): return R(0.85, "sólido")
    if re.search(r"orange|mandarin|tangerine|grapefruit|lemon|citrus", s): return R(0.92, "sólido")
    if re.search(r"blueberr", s): return R(0.65, "aparente (a granel)")
    if re.search(r"berr|raspberr|strawberr|cherr", s): return R(0.60, "aparente (a granel)")
    if re.search(r"\bfig", s): return R(0.90, "sólido")
    if re.search(r"raisin|date|prune|dried", s): return R(0.60, "aparente (a granel)")
    if re.search(r"banana|mango|peach|apricot|nectarine|plum|kiwi|persimmon|kaki|grape|avocado|pomegranate|melon|watermelon", s):
        return R(0.95, "sólido")
    if re.search(r"fruit", s): return R(0.90, "sólido")

    # --- verduras ---
    if re.search(r"artichoke", s): return R(0.75, "sólido")
    if re.search(r"pickl", s): return R(0.90, "sólido")
    if re.search(r"lettuce|salad|spinach|chicory|rocket|arugula|chard|basil|parsley|lamb.?s ear|m[aâ]che|greens|\bleaf\b", s):
        return R(0.12, "aparente (a granel)", "estimación por categoría (FAO: hojas crudas)")
    if re.search(r"cabbage|coleslaw|kohlrabi", s): return R(0.40, "aparente (a granel)")
    if re.search(r"potato|patata", s): return R(0.59, "aparente (a granel)", "estimación por categoría (FAO: patata cocida)")
    if re.search(r"carrot", s): return R(0.55, "aparente (a granel)", "estimación por categoría (FAO: zanahoria troceada)")
    if re.search(r"cauliflower|broccoli|brussel", s): return R(0.45, "aparente (a granel)", "estimación por categoría (FAO: coliflor cocida)")
    if re.search(r"green bean|\bpeas?\b", s): return R(0.55, "aparente (a granel)", "estimación por categoría (FAO: judías/guisantes)")
    if re.search(r"pepper|chili", s): return R(0.51, "aparente (a granel)", "estimación por categoría (FAO: pimiento en dados)")
    if re.search(r"onion|leek|shallot", s): return R(0.50, "aparente (a granel)", "estimación por categoría (FAO: cebolla troceada)")
    if re.search(r"corn", s): return R(0.73, "aparente (a granel)", "estimación por categoría (FAO: maíz cocido)")
    if re.search(r"mushroom", s): return R(0.60, "aparente (a granel)")
    if re.search(r"tomato|cucumber|radish|garlic|fennel|zucchini|eggplant|aubergine|squash|pumpkin|asparagus|beet|celeriac|turnip|vegetable", s):
        return R(0.95, "sólido")
    return R(1.00, "sólido", "estimación por defecto")


def ing_density(name):
    """Densidad para la fórmula de mezcla de recetas (valores de ingrediente, sin aire entre piezas)."""
    s = norm(name)
    if re.search(r"\bwater\b|agua", s): return 1.00
    if re.search(r"oil|aceite", s): return 0.92
    if re.search(r"butter|mantequilla", s): return 0.911
    if re.search(r"\bcream\b|nata", s): return 0.99
    if re.search(r"milk|leche|soy|oat milk|yogur|yoghurt", s): return 1.03
    if re.search(r"parmesan|gouda|cheese|queso", s): return 1.15 if re.search(r"parmesan|gouda|hard", s) else 1.10
    if re.search(r"\begg\b|huevo", s): return 1.03
    if re.search(r"flour|harina", s): return 0.55
    if re.search(r"tomato.*sauce|sauce.*tomato|tomato products|tomato puree", s): return 1.03
    if re.search(r"beef|pork|chicken|meat|turkey", s): return 0.95
    if re.search(r"sugar|azucar|azúcar", s): return 1.59
    if re.search(r"croissant", s): return 0.45
    if re.search(r"pie crust|pasta de tarta|masa", s): return 0.45
    if re.search(r"potato|patata", s): return 0.90
    if re.search(r"cabbage|col\b", s): return 0.40
    if re.search(r"carrot|zanahoria", s): return 0.80
    if re.search(r"lettuce|lechuga|ensalada", s): return 0.12
    if re.search(r"tomato|tomate", s): return 0.95
    if re.search(r"cucumber|pepino", s): return 0.96
    if re.search(r"oats|avena", s):
        return 0.90 if re.search(r"cooked|boiled|cocid", s) else 0.42
    if re.search(r"apple|manzana", s): return 0.85
    if re.search(r"hazelnut|avellana", s): return 0.60
    if re.search(r"rice|arroz", s): return 0.73
    if re.search(r"mushroom|champi", s): return 0.90
    if re.search(r"broth|caldo", s): return 1.00
    if re.search(r"apricot|albaricoque|plum|ciruela", s): return 0.95
    if re.search(r"zucchini|calabac", s): return 0.95
    if re.search(r"onion|cebolla", s): return 0.50
    if re.search(r"\bham\b|jamon|jamón", s): return 1.05
    if re.search(r"bacon", s): return 0.60
    return 0.90


rows = []
for m in M:
    idx = int(m["idx"]); clase = m["clase"]
    if m.get("fdc_data_type") == "receta":
        ings = m.get("ingredientes", [])
        den = [(ing["g"], ing_density(ing["nombre"])) for ing in ings]
        tot = sum(g for g, _ in den) or 100
        inv = sum((g / d) for g, d in den if d)
        rho = round(tot / inv, 3) if inv else None
        rows.append(dict(idx=idx, clase=clase, fdc_id="RECETA", descripcion=f"Receta ({len(ings)} ingredientes)",
                         densidad=rho, tipo="mezcla (receta)", fuente="fórmula de mezcla sobre ingredientes",
                         confianza="baja", nota="; ".join(f"{i['nombre']} {i['g']:.0f} g" for i in ings)))
        continue
    desc = m.get("fdc_description", "")
    vol = usda_volume_density(m.get("portions"))
    descartada = ""
    if vol and idx in NO_USDA:
        descartada = f"medida USDA {vol[0]} g/cm3 descartada: {NO_USDA[idx]}; "
        vol = None
    if vol and not (0.08 <= vol[0] <= 1.6):
        descartada = f"medida USDA {vol[0]} g/cm3 descartada (fuera de rango); "
        vol = None
    if vol:
        d, plain, detalle = vol
        rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=d,
                         tipo="aparente (a granel, medida USDA)", fuente="USDA: medida de volumen de la entrada",
                         confianza="alta" if plain else "media", nota=descartada + detalle))
        continue
    if idx in PUB:
        d, tipo, fuente, conf = PUB[idx]
        rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=d,
                         tipo=tipo, fuente=fuente, confianza=conf, nota=descartada))
        continue
    if idx in FAO:
        d, entry = FAO[idx]
        rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=d,
                         tipo="aparente (a granel)", fuente=f"FAO/INFOODS Density DB v2: {entry}",
                         confianza="media", nota=""))
        continue
    if idx in IDX_REF:
        key = IDX_REF[idx]
        d, fuente = REF[key]
        rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=d,
                         tipo="aparente (a granel)", fuente=f"referencia tabulada: {fuente}", confianza="media", nota=""))
        continue
    if idx in GEOM:
        masa, forma, dims, origen_masa = GEOM[idx]
        vol = geom_volumen(forma, dims)
        rho = round(masa / vol, 3)
        detalle = f"masa {masa:g} g ({origen_masa}); {geom_dim_txt(forma, dims)} -> V={vol:.1f} cm3; rho={rho:.3f}"
        razon = MOTIVO.get(idx)
        motivo_geom = "cálculo geométrico, NO medición. " + ((razon + " | ") if razon else "") + detalle
        rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=rho,
                         tipo="geometría (sólido)",
                         fuente="cálculo geométrico: masa de la porción / volumen de un sólido de dimensiones típicas",
                         confianza="baja",
                         motivo=motivo_geom,
                         nota=detalle))
        continue
    d, tipo, fuente, conf = cat_density(desc, clase)
    rows.append(dict(idx=idx, clase=clase, fdc_id=m["fdc_id"], descripcion=desc, densidad=d, tipo=tipo,
                     fuente=fuente, confianza=conf, nota=""))

D = pd.DataFrame(rows).sort_values("idx")
D["cm3_por_100g"] = (100 / D["densidad"]).round(1)

def estado(f):
    if f.startswith("USDA"): return "medida USDA"
    if f.startswith("referencia tabulada") or f.startswith("FAO/INFOODS"): return "tabla publicada"
    if f.startswith("cálculo geométrico"): return "calculada (geometría)"
    if f.startswith("referencia") or f.startswith("física"): return "referencia de categoría"
    if f.startswith("fórmula"): return "calculada (receta)"
    return "ESTIMADA - pendiente de pesar"


D["estado"] = D["fuente"].map(estado)
baja = (D["confianza"] == "baja") & ~D["estado"].isin(
    ["medida USDA", "tabla publicada", "calculada (receta)", "calculada (geometría)"])
D.loc[baja, "estado"] = "ESTIMADA - pendiente de pesar"
D["estimada"] = (D["estado"] == "ESTIMADA - pendiente de pesar").map({True: "SÍ", False: "no"})

# Motivos de las clases sin medición publicada de su densidad en la forma en que
# se sirven (diccionario MOTIVO, definido arriba).

D["motivo"] = D["motivo"].fillna("") if "motivo" in D else ""
for i, txt in MOTIVO.items():
    D.loc[(D["idx"] == i) & (D["estimada"] == "SÍ"), "motivo"] = txt
D.to_csv(OUT / "densidad_alimentos.csv", index=False, encoding="utf-8-sig")

# diff contra la versión anterior, para auditar cada cambio
v1 = OUT / "densidad_alimentos_v1.csv"
if v1.exists():
    V = pd.read_csv(v1, dtype=str)
    V["idx"] = V["idx"].astype(int)
    C = V[["idx", "clase", "densidad", "fuente", "confianza"]].merge(
        D[["idx", "densidad", "fuente", "confianza", "estado"]], on="idx", suffixes=("_antes", "_despues"))
    C["cambio"] = C["densidad_antes"].astype(float).round(3) != C["densidad_despues"].astype(float).round(3)
    C = C[C["cambio"]].copy()
    C["delta"] = (C["densidad_despues"].astype(float) - C["densidad_antes"].astype(float)).round(3)
    C[["idx", "clase", "densidad_antes", "densidad_despues", "delta", "fuente_antes", "fuente_despues", "estado"]].to_csv(
        OUT / "densidad_cambios.csv", index=False, encoding="utf-8-sig")
    print("cambios respecto a v1:", len(C), "| suben:", int((C["delta"] > 0).sum()), "| bajan:", int((C["delta"] < 0).sum()))

print("filas:", len(D), "| sin densidad:", D["densidad"].isna().sum())
print(D["estado"].value_counts().to_string())
print(D["confianza"].value_counts().to_string())
print("rango:", D["densidad"].min(), "-", D["densidad"].max())
print(D[["idx", "clase", "densidad", "fuente", "confianza"]].head(15).to_string(index=False))
