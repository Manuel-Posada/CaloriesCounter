"""Reconstruye `FoodLog.items` en análisis guardados antes de que existiera el detalle.

Solo puede hacerlo si el análisis conserva los contornos (la foto sigue en R2) y los totales son
creíbles: de cada contorno se conocen el nombre y sus kcal, así que el peso sale de la tabla
nutricional y el volumen de la densidad. Los análisis con cifras absurdas se omiten.
"""
from django.core.management.base import BaseCommand

from core import food_items, nutrition
from core.models import FoodLog

MAX_KCAL = 5000.0
MAX_VOLUME_CM3 = 3000.0


class Command(BaseCommand):
    help = "Reconstruye el detalle por alimento de análisis antiguos a partir de sus contornos."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="No guarda nada, solo informa.")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Repara también análisis con totales fuera de rango (p. ej. fotos antiguas mal medidas).",
        )

    def handle(self, *args, **opts):
        reparados = omitidos = 0
        for log in FoodLog.objects.filter(items=[]).order_by("id"):
            if not log.contornos:
                omitidos += 1
                continue
            outside_range = log.calorias_totales > MAX_KCAL or log.volumen_estimado > MAX_VOLUME_CM3
            if outside_range and not opts["force"]:
                self.stdout.write(f"  #{log.pk}: totales fuera de rango, se omite")
                omitidos += 1
                continue
            if outside_range:
                self.stdout.write(f"  #{log.pk}: totales fuera de rango, se repara por --force")

            items = []
            for contorno in log.contornos:
                entry = nutrition.by_name(contorno.get("nombre", ""))
                if entry is None:
                    continue
                kcal = float(contorno.get("kcal") or 0)
                por_100g = entry["por_100g"]
                if kcal <= 0 or por_100g["calorias_kcal"] <= 0:
                    continue
                peso = kcal / por_100g["calorias_kcal"] * 100
                densidad = entry["densidad_g_cm3"] or 1.0
                items.append(
                    {
                        "idx": entry["idx"],
                        "nombre": entry["nombre"],
                        "nombre_es": entry["nombre_es"],
                        # La confianza del clasificador no se guardaba: se deja desconocida.
                        "confianza": None,
                        "volumen_cm3": round(peso / densidad, 2),
                        "densidad_g_cm3": densidad,
                        "densidad_asumida": False,
                        "por_100g": por_100g,
                        "peso_g": round(peso, 2),
                        "peso_manual": False,
                        "editado": True,
                        "clase_editada": False,
                        "poligono": contorno.get("poligono") or [],
                        "centroide": contorno.get("centroide"),
                    }
                )

            if not items:
                omitidos += 1
                continue

            self.stdout.write(
                f"  #{log.pk}: {len(items)} alimentos, "
                f"{round(sum(i['peso_g'] for i in items), 1)} g (antes {log.calorias_totales} kcal)"
            )
            if not opts["dry_run"]:
                log.items = items
                food_items.recalc(log)
                log.save(
                    update_fields=[
                        "items", "volumen_estimado", "calorias_totales", "macronutrientes",
                        "clases_detectadas", "contornos", "confianza",
                    ]
                )
            reparados += 1

        etiqueta = "se repararían" if opts["dry_run"] else "reparados"
        self.stdout.write(
            self.style.SUCCESS(f"{reparados} {etiqueta}; {omitidos} omitidos (sin contornos o dudosos)")
        )
