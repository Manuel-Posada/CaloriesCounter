from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from . import food_items
from .models import FoodLog, User
from .r2 import get_r2_client, r2_configured, user_prefix

ALLOWED_CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MACRO_KEYS = {"proteinas_g", "carbohidratos_g", "grasas_g"}


class ProfileSerializer(serializers.ModelSerializer):
    """Perfil del usuario autenticado: lo que pinta el menú de cuenta y la página de perfil."""

    class Meta:
        model = User
        fields = [
            "email",
            "first_name",
            "last_name",
            "picture_url",
            "is_staff",
            "locale",
            "theme",
            "accent",
        ]
        # El nombre y las preferencias se pueden editar; el email y el avatar los manda Google.
        read_only_fields = ["email", "picture_url", "is_staff"]


class GoogleLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField()


class PresignRequestSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=list(ALLOWED_CONTENT_TYPES))


class FoodLogCreateSerializer(serializers.Serializer):
    """Entrada del POST: la imagen ya subida a R2 y opciones de inferencia."""

    id_imagen_r2 = serializers.CharField(max_length=512)
    pipeline = serializers.ChoiceField(choices=["A", "B"], default="B")
    depth_model = serializers.ChoiceField(choices=["small", "large"], default="small")
    fov_deg = serializers.FloatField(required=False, min_value=10, max_value=170)
    # Focal equivalente en 35 mm del EXIF original (p. ej. 26 en la cámara principal de un móvil).
    f35_mm = serializers.FloatField(required=False, min_value=5, max_value=300)

    def validate_id_imagen_r2(self, value):
        if not value.startswith(user_prefix(self.context["request"].user.pk)):
            raise serializers.ValidationError("La clave de imagen no pertenece al usuario.")
        return value


class FoodLogEditSerializer(serializers.Serializer):
    """Body del PATCH: correcciones del usuario sobre un análisis ya guardado."""

    items = serializers.ListField(child=serializers.DictField(), required=False)
    plate_diameter_cm = serializers.FloatField(required=False, min_value=15, max_value=40)

    def validate_items(self, value):
        for edit in value:
            if "index" not in edit:
                raise serializers.ValidationError("Cada corrección necesita 'index'.")
            if "idx" not in edit and "peso_g" not in edit:
                raise serializers.ValidationError(
                    "Cada corrección necesita 'idx' (alimento) o 'peso_g' (gramos)."
                )
        return value


class FoodLogSerializer(serializers.ModelSerializer):
    imagen_url = serializers.SerializerMethodField()
    clases_detectadas = serializers.ListField(child=serializers.IntegerField(min_value=0))
    volumen_estimado = serializers.FloatField(min_value=0)
    calorias_totales = serializers.FloatField(min_value=0)
    peso_total = serializers.SerializerMethodField()
    editable = serializers.SerializerMethodField()
    # Entrada del POST (detalle calculado por el pipeline); no se devuelve en las respuestas.
    items = serializers.JSONField(write_only=True, required=False)
    advertencias = serializers.ListField(child=serializers.JSONField(), required=False)
    confianza = serializers.JSONField(required=False)

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
            "peso_total",
            "macronutrientes",
            "consejo_nutricional",
            "angulo_camara_deg",
            "contornos",
            "plate_diameter_cm",
            "escala_origen",
            "items",
            "advertencias",
            "confianza",
            "editable",
            "imagen_eliminada_en",
        ]
        read_only_fields = ["id", "fecha_hora", "imagen_eliminada_en"]

    def get_peso_total(self, obj):
        return round(sum(float(i.get("peso_g") or 0) for i in obj.items or []), 2)

    def get_editable(self, obj):
        return bool(obj.items)

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


class FoodLogDetailSerializer(FoodLogSerializer):
    """Detalle de un análisis: añade la lista de alimentos (con su tabla nutricional)."""

    alimentos = serializers.SerializerMethodField()

    class Meta(FoodLogSerializer.Meta):
        fields = [*FoodLogSerializer.Meta.fields, "alimentos"]

    def get_alimentos(self, obj):
        return food_items.alimentos_from_items(obj.items)

