from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.r2 import R2NotConfigured, get_r2_client

# El navegador sube la foto directamente a R2 con una URL prefirmada, así que el bucket
# necesita permitir PUT/GET desde los orígenes de la app.
CORS_RULES = {
    "CORSRules": [
        {
            "AllowedOrigins": [
                "https://caloriescounter.app",
                "https://www.caloriescounter.app",
                "https://caloriescounter-*.vercel.app",
                "http://localhost:4200",
                "http://127.0.0.1:4200",
            ],
            "AllowedMethods": ["GET", "PUT", "HEAD"],
            "AllowedHeaders": ["*"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3600,
        }
    ]
}


class Command(BaseCommand):
    help = "Aplica (o muestra) la política CORS del bucket R2, necesaria para subir fotos desde el navegador."

    def add_arguments(self, parser):
        parser.add_argument("--show", action="store_true", help="Solo muestra la política actual.")

    def handle(self, *args, **opts):
        try:
            client = get_r2_client()
        except R2NotConfigured as exc:
            raise CommandError(str(exc)) from exc

        if opts["show"]:
            self.stdout.write(str(client.get_bucket_cors(Bucket=settings.R2_BUCKET_NAME)["CORSRules"]))
            return

        client.put_bucket_cors(Bucket=settings.R2_BUCKET_NAME, CORSConfiguration=CORS_RULES)
        self.stdout.write(
            self.style.SUCCESS(f"CORS aplicado al bucket {settings.R2_BUCKET_NAME} "
                               f"({len(CORS_RULES['CORSRules'][0]['AllowedOrigins'])} orígenes)")
        )
