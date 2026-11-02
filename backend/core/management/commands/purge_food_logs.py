from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import FoodLog
from core.r2 import get_r2_client, r2_configured


class Command(BaseCommand):
    help = (
        "Borra los FoodLog con más de N días (30 por defecto) junto con su imagen de R2 si "
        "todavía existía. Las imágenes sueltas las limpia antes `cleanup_r2_images`."
    )

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=settings.FOOD_LOG_RETENTION_DAYS)
        parser.add_argument("--dry-run", action="store_true", help="Solo lista, no borra.")

    def handle(self, *args, **opts):
        cutoff = timezone.now() - timedelta(days=opts["days"])
        qs = FoodLog.objects.filter(fecha_hora__lt=cutoff)

        if opts["dry_run"]:
            for log in qs.iterator():
                self.stdout.write(f"[dry-run] {log.pk} {log.fecha_hora:%Y-%m-%d} {log.id_imagen_r2}")
            self.stdout.write(self.style.WARNING(f"A borrar: {qs.count()}"))
            return

        # Sólo se intenta borrar en R2 si el objeto debería seguir vivo; si `cleanup_r2_images`
        # ya pasó, la clave no existe y `delete_object` es idempotente igualmente.
        can_delete_objects = r2_configured()
        client = get_r2_client() if can_delete_objects else None

        deleted = failed = 0
        failed_ids: set[int] = set()
        # Por lotes: borrar filas mientras se recorre el mismo queryset con un cursor del
        # servidor es frágil. Las que fallen por R2 se excluyen para no reintentarlas en bucle.
        while True:
            batch = list(qs.exclude(pk__in=failed_ids)[:200])
            if not batch:
                break
            for log in batch:
                if client and not log.imagen_eliminada_en and log.id_imagen_r2:
                    try:
                        client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=log.id_imagen_r2)
                    except (ClientError, BotoCoreError) as exc:
                        failed += 1
                        failed_ids.add(log.pk)
                        self.stderr.write(f"Error borrando {log.id_imagen_r2}: {exc}")
                        continue
                log.delete()
                deleted += 1

        self.stdout.write(self.style.SUCCESS(f"Eliminados: {deleted} | Fallidos: {failed}"))
