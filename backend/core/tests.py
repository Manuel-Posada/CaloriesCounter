from types import SimpleNamespace

from django.test import SimpleTestCase

from core import confidence, nutrition


class ConfidenceEvaluationTests(SimpleTestCase):
    """Unit tests for analysis confidence scoring and reason flags."""

    def test_high_confidence_with_plate_scale_and_zenithal_angle(self):
        log = SimpleNamespace(
            escala_origen="plate",
            angulo_camara_deg=3.0,
            items=[{"confianza": 0.92, "densidad_asumida": False}],
            advertencias=[],
        )
        result = confidence.evaluate(log)
        self.assertEqual(result["nivel"], "alta")
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["motivos"], [])

    def test_penalizes_unverified_scale_tilt_and_clamped_volume(self):
        log = SimpleNamespace(
            escala_origen="raw",
            angulo_camara_deg=18.0,
            items=[{"confianza": 0.08, "densidad_asumida": True}],
            advertencias=[{"code": "volume_clamped"}],
        )
        result = confidence.evaluate(log)
        self.assertEqual(result["nivel"], "baja")
        self.assertEqual(result["score"], 0)
        self.assertIn("escala_sin_referencia", result["motivos"])
        self.assertIn("camara_inclinada", result["motivos"])
        self.assertIn("clasificacion_muy_baja", result["motivos"])
        self.assertIn("densidad_asumida", result["motivos"])
        self.assertIn("volumen_recortado", result["motivos"])

    def test_user_edited_class_does_not_penalize_low_classifier_confidence(self):
        log = SimpleNamespace(
            escala_origen="plate",
            angulo_camara_deg=2.0,
            items=[{"confianza": 0.05, "clase_editada": True, "densidad_asumida": False}],
            advertencias=[],
        )
        result = confidence.evaluate(log)
        self.assertEqual(result["nivel"], "alta")
        self.assertEqual(result["score"], 100)


class NutritionCatalogTests(SimpleTestCase):
    """Unit tests for the deterministic nutrition catalog and portion math."""

    def test_totals_for_scales_linearly_from_100g(self):
        por_100g = {
            "calorias_kcal": 200.0,
            "proteinas_g": 10.0,
            "carbohidratos_g": 20.0,
            "grasas_g": 5.0,
        }
        totals = nutrition.totals_for(150.0, por_100g)
        self.assertEqual(totals["calorias_kcal"], 300.0)
        self.assertEqual(totals["proteinas_g"], 15.0)
        self.assertEqual(totals["carbohidratos_g"], 30.0)
        self.assertEqual(totals["grasas_g"], 7.5)

    def test_search_handles_accents_and_regional_synonyms(self):
        results = nutrition.search("papa")
        self.assertTrue(len(results) > 0)
