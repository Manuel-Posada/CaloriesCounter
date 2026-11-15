"""Reconstruct `FoodLog.items` for analyses saved before per-item detail existed.

Only possible if the analysis still has contours (the photo is still in R2) and totals
are plausible: each contour has a name and kcal, so weight comes from the nutrition
table and volume from density. Analyses with implausible figures are skipped.
"""
from django.core.management.base import BaseCommand

from core import food_items, nutrition
from core.models import FoodLog

MAX_KCAL = 5000.0
MAX_VOLUME_CM3 = 3000.0


class Command(BaseCommand):
    help = "Reconstruct per-food breakdown for legacy analyses from their contours."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Do not save anything, only report.")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Also repair analyses with out-of-range totals (e.g. legacy mismeasured photos).",
        )

    def handle(self, *args, **opts):
        reparados = omitidos = 0
        for log in FoodLog.objects.filter(items=[]).order_by("id"):
            if not log.contornos:
                omitidos += 1
                continue
            outside_range = log.calorias_totales > MAX_KCAL or log.volumen_estimado > MAX_VOLUME_CM3
            if outside_range and not opts["force"]:
                self.stdout.write(f"  #{log.pk}: totals out of range, skipping")
                omitidos += 1
                continue
            if outside_range:
                self.stdout.write(f"  #{log.pk}: totals out of range, repairing via --force")

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
                        # Classifier confidence was not saved: leave unknown.
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
                f"  #{log.pk}: {len(items)} items, "
                f"{round(sum(i['peso_g'] for i in items), 1)} g (previously {log.calorias_totales} kcal)"
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

        label = "would be repaired" if opts["dry_run"] else "repaired"
        self.stdout.write(
            self.style.SUCCESS(f"{reparados} {label}; {omitidos} skipped (no contours or questionable)")
        )
