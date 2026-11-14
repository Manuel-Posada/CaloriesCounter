from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.r2 import R2NotConfigured, get_r2_client

# The browser uploads the photo directly to R2 with a presigned URL, so the bucket
# must allow PUT/GET from the app origins.
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
    help = "Apply (or show) the R2 bucket CORS policy, required for browser photo uploads."

    def add_arguments(self, parser):
        parser.add_argument("--show", action="store_true", help="Only show the current policy.")

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
            self.style.SUCCESS(f"CORS applied to bucket {settings.R2_BUCKET_NAME} "
                               f"({len(CORS_RULES['CORSRules'][0]['AllowedOrigins'])} origins)")
        )
