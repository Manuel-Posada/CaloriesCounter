from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import FoodLog, User
from .r2 import get_r2_client, r2_configured, user_prefix

ALLOWED_CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MACRO_KEYS = {"proteinas_g", "carbohidratos_g", "grasas_g"}


class ProfileSerializer(serializers.ModelSerializer):
    """Perfil del usuario autenticado: lo que pinta el menú de cuenta y la página de perfil."""

    class Meta:
        model = User
        fields = ["email", "first_name", "last_name", "picture_url", "is_staff"]
        # Solo el nombre se puede editar; el email y el avatar los manda Google.
        read_only_fields = ["email", "picture_url", "is_staff"]


class GoogleLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField()


class PresignRequestSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=list(ALLOWED_CONTENT_TYPES))


class FoodLogCreateSerializer(serializers.Serializer):
    """Entrada del POST: la imagen ya subida a R2 y opciones de inferencia."""

    id_imagen_r2 = serializers.CharField(max_length=512)
    pipeline = serializers.ChoiceField(choices=["A", "B"], default="B")
    fov_deg = serializers.FloatField(required=False, min_value=10, max_value=170)
    # Focal equivalente en 35 mm del EXIF original (p. ej. 26 en la cámara principal de un móvil).
    f35_mm = serializers.FloatField(required=False, min_value=5, max_value=300)

    def validate_id_imagen_r2(self, value):
        if not value.startswith(user_prefix(self.context["request"].user.pk)):
            raise serializers.ValidationError("La clave de imagen no pertenece al usuario.")
        return value


class FoodLogSerializer(serializers.ModelSerializer):
    imagen_url = serializers.SerializerMethodField()
    clases_detectadas = serializers.ListField(child=serializers.IntegerField(min_value=0))
    volumen_estimado = serializers.FloatField(min_value=0)
    calorias_totales = serializers.FloatField(min_value=0)

    class Meta:
        model = FoodLog
        fields = [
            "id",
            "id_imagen_r2",
            "imagen_url",
            "fecha_hora",
            "clases_detectadas",
            "volumen_estimado",
            "calorias_totales",
            "macronutrientes",
            "consejo_nutricional",
            "angulo_camara_deg",
            "contornos",
            "imagen_eliminada_en",
        ]
        read_only_fields = ["id", "fecha_hora", "imagen_eliminada_en"]

    def get_imagen_url(self, obj):
        """URL prefirmada de lectura (1 h) mientras la imagen siga en R2; None si ya expiró."""
        expired = obj.fecha_hora < timezone.now() - timedelta(hours=settings.R2_RETENTION_HOURS)
        if obj.imagen_eliminada_en or expired or not r2_configured():
            return None
        return get_r2_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET_NAME, "Key": obj.id_imagen_r2},
            ExpiresIn=3600,
        )

    def validate_id_imagen_r2(self, value):
        user = self.context["request"].user
        if not value.startswith(user_prefix(user.pk)):
            raise serializers.ValidationError("La clave de imagen no pertenece al usuario.")
        return value

    def validate_macronutrientes(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Debe ser un objeto JSON.")
        missing = MACRO_KEYS - value.keys()
        if missing:
            raise serializers.ValidationError(f"Faltan claves: {sorted(missing)}")
        if not all(isinstance(value[k], (int, float)) and value[k] >= 0 for k in MACRO_KEYS):
            raise serializers.ValidationError("Los macros deben ser números >= 0.")
        return value

