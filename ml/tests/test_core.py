import numpy as np
import pytest
from pipeline.nutrition import NutritionTable
from pipeline.overlay import mask_centroid, mask_to_polygon
from pipeline.volume import camera_tilt_deg, estimate_volume_cm3, resolve_focal_px

# ---------------- nutrición ----------------

CSV = """idx,name,densidad,kcal_100g,Protein (g),"Carbohydrate, by difference (g)",Total lipid (fat) (g)
0,arroz,0.85,130,2.7,28,0.3
1,pollo,1.05,165,31,0,3.6
2,mystery,,100,10,10,10
"""


@pytest.fixture
def table(tmp_path):
    p = tmp_path / "n.csv"
    p.write_text(CSV, encoding="utf-8")
    return NutritionTable.load(p, expected_classes=3)


def test_mass_and_nutrition_formulas(table):
    r = table.compute(0, volume_cm3=200.0)
    assert r["peso_g"] == pytest.approx(200 * 0.85)  # gramos = volumen * densidad
    assert r["calorias_kcal"] == pytest.approx(170 / 100 * 130)  # (g/100) * valor_100g
    assert r["proteinas_g"] == pytest.approx(1.7 * 2.7)
    assert r["carbohidratos_g"] == pytest.approx(1.7 * 28)
    assert r["grasas_g"] == pytest.approx(1.7 * 0.3)


def test_per_100g_values_come_from_the_table(table):
    """El detalle que consulta el usuario son los valores del CSV, sin escalar."""
    r = table.compute(0, volume_cm3=200.0)
    assert r["por_100g"] == {
        "calorias_kcal": 130,
        "proteinas_g": 2.7,
        "carbohidratos_g": 28,
        "grasas_g": 0.3,
    }


def test_missing_density_is_flagged(table):
    r = table.compute(2, 100.0)
    assert r["densidad_asumida"] and r["peso_g"] == pytest.approx(100.0)


def test_class_count_is_enforced(tmp_path):
    p = tmp_path / "n.csv"
    p.write_text(CSV, encoding="utf-8")
    with pytest.raises(ValueError):
        NutritionTable.load(p)  # espera 323


def test_real_csv_has_323_named_classes():
    """El CSV del repo debe cargar 323 clases y con nombres reales (columna `clase`)."""
    import pathlib

    csv = pathlib.Path(__file__).resolve().parent.parent / "data" / "nutrition_wide_densidad.csv"
    table = NutritionTable.load(csv)
    assert len(table) == 323
    first = table.get(0)
    assert first.name and not first.name.startswith("class_")
    assert first.kcal_100g > 0


# ---------------- volumen ----------------

F = 500.0
H = W = 400


def _scene(depth_fn):
    v, u = np.mgrid[0:H, 0:W].astype(np.float64)
    nx, ny = (u - (W - 1) / 2) / F, (v - (H - 1) / 2) / F
    return depth_fn(nx, ny)


def test_box_on_flat_table():
    # Mesa a 50 cm; caja de 10x10x5 cm centrada -> tapa a 45 cm.
    def depth(nx, ny):
        z = np.full(nx.shape, 0.50)
        top = (np.abs(nx * 45) <= 5) & (np.abs(ny * 45) <= 5)
        z[top] = 0.45
        return z

    d = _scene(depth)
    mask = d < 0.49
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.volume_cm3 == pytest.approx(500.0, rel=0.05)
    assert res.plane_source == "ring"


def test_tilted_empty_table_has_near_zero_volume():
    # Plano inclinado 25° sin objeto: la máscara cae sobre el plano.
    th = np.radians(25)
    n = np.array([0, -np.sin(th), -np.cos(th)])  # orientada hacia la cámara
    d_plane = -55.0  # n·P = d_plane  (cm)

    def depth(nx, ny):
        denom = n[0] * nx + n[1] * ny + n[2]
        return (d_plane / denom) / 100.0

    d = _scene(depth)
    mask = np.zeros((H, W), bool)
    mask[150:250, 150:250] = True
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.volume_cm3 < 20.0  # vs. ~100 cm² * h si el plano estuviera mal ajustado


def test_food_filling_frame_does_not_crash():
    d = np.full((H, W), 0.5)
    mask = np.ones((H, W), bool)
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.plane_source == "fallback" and res.volume_cm3 >= 0


def test_focal_resolution_priority():
    assert resolve_focal_px(400, 300, fov_deg=90) == pytest.approx(200.0)
    exif = resolve_focal_px(400, 300, f35_mm=26)
    assert exif == pytest.approx(26 * 500 / 43.27)
    assert resolve_focal_px(400, 300, fov_deg=90, f35_mm=26) == pytest.approx(200.0)


# ---------------- inclinación de cámara ----------------


def test_camera_tilt_helper():
    assert camera_tilt_deg((0.0, 0.0, 1.0)) == pytest.approx(0.0)
    assert camera_tilt_deg((0.0, 0.0, -1.0)) == pytest.approx(0.0)  # el signo no importa
    th = np.radians(25)
    assert camera_tilt_deg((0.0, -np.sin(th), -np.cos(th))) == pytest.approx(25.0)
    assert camera_tilt_deg((0.0, 0.0, 0.0)) == 0.0  # degenerado: no revienta


def test_flat_table_reports_zero_tilt():
    def depth(nx, ny):
        z = np.full(nx.shape, 0.50)
        top = (np.abs(nx * 45) <= 5) & (np.abs(ny * 45) <= 5)
        z[top] = 0.45
        return z

    d = _scene(depth)
    mask = d < 0.49
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.plane_source == "ring"
    assert res.plane_normal is not None
    assert camera_tilt_deg(res.plane_normal) == pytest.approx(0.0, abs=2.0)


def test_tilted_table_recovers_inclination():
    th = np.radians(25)
    n = np.array([0, -np.sin(th), -np.cos(th)])
    d_plane = -55.0

    def depth(nx, ny):
        return (d_plane / (n[0] * nx + n[1] * ny + n[2])) / 100.0

    d = _scene(depth)
    mask = np.zeros((H, W), bool)
    mask[150:250, 150:250] = True
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.plane_source == "ring"
    assert res.plane_normal is not None
    assert camera_tilt_deg(res.plane_normal) == pytest.approx(25.0, abs=2.0)


def test_fallback_has_no_plane_normal():
    """Sin plano fiable no se reporta ángulo: `null`, nunca un 0° inventado."""
    d = np.full((H, W), 0.5)
    mask = np.ones((H, W), bool)
    res = estimate_volume_cm3(d, mask, mask, F)
    assert res.plane_source == "fallback"
    assert res.plane_normal is None


# ---------------- contornos para la foto ----------------


def test_polygon_is_normalized_and_simplified():
    mask = np.zeros((100, 200), bool)
    mask[20:80, 50:150] = True  # rectángulo 50..149 x 20..79

    poly = mask_to_polygon(mask)
    assert 4 <= len(poly) <= 6  # un rectángulo simplificado
    xs, ys = zip(*poly, strict=True)
    assert all(0.0 <= x <= 1.0 for x in xs) and all(0.0 <= y <= 1.0 for y in ys)
    # Centros de píxel: 50 -> 50.5/200 = 0.2525 y 149 -> 149.5/200 = 0.7475.
    assert min(xs) == pytest.approx(0.2525, abs=0.002)
    assert max(xs) == pytest.approx(0.7475, abs=0.002)
    assert min(ys) == pytest.approx(0.205, abs=0.002)
    assert max(ys) == pytest.approx(0.795, abs=0.002)


def test_polygon_is_capped():
    # Círculo "ruidoso": muchos vértices antes de simplificar.
    yy, xx = np.mgrid[0:400, 0:400]
    mask = (xx - 200) ** 2 + (yy - 200) ** 2 <= 150**2
    mask ^= ((xx + yy) % 7 == 0) & mask  # dientes en el borde

    poly = mask_to_polygon(mask, max_points=24)
    assert 3 <= len(poly) <= 24


def test_polygon_and_centroid_of_empty_mask():
    assert mask_to_polygon(np.zeros((10, 10), bool)) == []
    assert mask_centroid(np.zeros((10, 10), bool)) is None


def test_centroid_is_normalized():
    mask = np.zeros((100, 200), bool)
    mask[40:60, 90:110] = True  # media de índices (99.5, 49.5) -> centro del píxel (0.5, 0.5)
    assert mask_centroid(mask) == pytest.approx((0.5, 0.5), abs=1e-4)


# ---------------- runner y selector de depth_model ----------------


def test_food_pipeline_depth_model_selection():
    from unittest.mock import MagicMock

    from PIL import Image
    from pipeline.runner import FoodPipeline
    from pipeline.types import Segment

    mock_depth_small = MagicMock()
    mock_depth_small.predict.return_value = np.full((100, 100), 0.5, dtype=np.float32)

    mock_depth_large = MagicMock()
    mock_depth_large.predict.return_value = np.full((100, 100), 0.4, dtype=np.float32)

    dummy_mask = np.zeros((100, 100), dtype=bool)
    dummy_mask[30:70, 30:70] = True

    mock_strategy = MagicMock()
    mock_strategy.side_effect = lambda img: [
        Segment(mask=dummy_mask, score=0.95, class_idx=0)
    ]

    mock_nutrition = MagicMock()
    mock_nutrition.compute.return_value = {
        "clase": "arroz",
        "peso_g": 50.0,
        "calorias_kcal": 65.0,
        "proteinas_g": 1.5,
        "carbohidratos_g": 14.0,
        "grasas_g": 0.2,
        "densidad_asumida": False,
        "por_100g": {"calorias_kcal": 130, "proteinas_g": 2.7, "carbohidratos_g": 28, "grasas_g": 0.3},
    }

    pipe = FoodPipeline(
        strategies={"A": mock_strategy},
        depth={"small": mock_depth_small, "large": mock_depth_large},
        nutrition=mock_nutrition,
    )

    img = Image.new("RGB", (100, 100), color="white")

    # Ejecutar con depth_model="small"
    res_small = pipe.run(img, mode="A", depth_model="small")
    assert mock_depth_small.predict.called
    assert not mock_depth_large.predict.called
    assert "alimentos" in res_small

    # Ejecutar con depth_model="large"
    res_large = pipe.run(img, mode="A", depth_model="large")
    assert mock_depth_large.predict.called
    assert "alimentos" in res_large


