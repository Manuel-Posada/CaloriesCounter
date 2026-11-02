from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import FoodLog
from core.r2 import get_r2_client


class Command(BaseCommand):
    help = "Elimina de Cloudflare R2 las imágenes de FoodLog con más de N horas (72 por defecto). El registro en BD se conserva."

    def add_arguments(self, parser):
        parser.add_argument("--hours", type=int, default=settings.R2_RETENTION_HOURS)
        parser.add_argument("--dry-run", action="store_true", help="Solo lista, no borra.")

    def handle(self, *args, **opts):
        cutoff = timezone.now() - timedelta(hours=opts["hours"])
        qs = FoodLog.objects.filter(
            fecha_hora__lt=cutoff, imagen_eliminada_en__isnull=True
        ).exclude(id_imagen_r2="")

        client = get_r2_client()
        deleted = failed = 0

        for log in qs.iterator():
            if opts["dry_run"]:
                self.stdout.write(f"[dry-run] {log.id_imagen_r2}")
                continue
            try:
                # delete_object es idempotente: no falla si la clave ya no existe.
                client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=log.id_imagen_r2)
            except (ClientError, BotoCoreError) as exc:
                failed += 1
                self.stderr.write(f"Error borrando {log.id_imagen_r2}: {exc}")
                continue
            FoodLog.objects.filter(pk=log.pk).update(
                imagen_eliminada_en=timezone.now(), contornos=[]
            )
            deleted += 1

        self.stdout.write(self.style.SUCCESS(f"Eliminadas: {deleted} | Fallidas: {failed}"))

