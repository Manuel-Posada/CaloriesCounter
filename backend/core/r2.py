import boto3
from botocore.config import Config
from django.conf import settings


class R2NotConfigured(Exception):
    """Faltan credenciales de Cloudflare R2 en la configuración."""


def r2_configured() -> bool:
    return all(
        [
            settings.R2_ACCOUNT_ID,
            settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY,
            settings.R2_BUCKET_NAME,
        ]
    )


def get_r2_client():
    if not r2_configured():
        raise R2NotConfigured(
            "Cloudflare R2 no está configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME)."
        )
    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def user_prefix(user_id) -> str:
    return f"uploads/{user_id}/"
