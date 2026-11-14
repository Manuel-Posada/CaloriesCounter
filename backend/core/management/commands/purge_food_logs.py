from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import FoodLog
from core.r2 import get_r2_client, r2_configured


class Command(BaseCommand):
    help = (
        "Delete FoodLog records older than N days (30 by default) along with their R2 image "
        "if it still exists. Orphan images are cleaned earlier by `cleanup_r2_images`."
    )

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=settings.FOOD_LOG_RETENTION_DAYS)
        parser.add_argument("--dry-run", action="store_true", help="List only, do not delete.")

    def handle(self, *args, **opts):
        cutoff = timezone.now() - timedelta(days=opts["days"])
        qs = FoodLog.objects.filter(fecha_hora__lt=cutoff)

        if opts["dry_run"]:
            for log in qs.iterator():
                self.stdout.write(f"[dry-run] {log.pk} {log.fecha_hora:%Y-%m-%d} {log.id_imagen_r2}")
            self.stdout.write(self.style.WARNING(f"To delete: {qs.count()}"))
            return

        # Only attempt R2 deletion if the object should still exist; if `cleanup_r2_images`
        # already ran, the key is gone and `delete_object` is idempotent anyway.
        can_delete_objects = r2_configured()
        client = get_r2_client() if can_delete_objects else None

        deleted = failed = 0
        failed_ids: set[int] = set()
        # Batching: deleting rows while iterating the same queryset with a server-side cursor
        # is fragile. Rows whose R2 deletion fails are excluded to avoid retrying them in a loop.
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
                        self.stderr.write(f"Error deleting {log.id_imagen_r2}: {exc}")
                        continue
                log.delete()
                deleted += 1

        self.stdout.write(self.style.SUCCESS(f"Deleted: {deleted} | Failed: {failed}"))
