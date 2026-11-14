from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.contrib.postgres.fields import ArrayField
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_google_user(self, email, google_sub, **extra):
        user = self.model(email=self.normalize_email(email), google_sub=google_sub, **extra)
        user.set_unusable_password()  # Password login disabled
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        # Only for accessing /admin; end users sign in exclusively with Google.
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractUser):
    """User identified by email; end users authenticate only with Google."""

    username = None
    email = models.EmailField(unique=True)
    google_sub = models.CharField(
        "Google subject ID", max_length=255, unique=True, null=True, blank=True
    )
    picture_url = models.URLField(blank=True)

    # UI preferences synced across user devices.
    locale = models.CharField(
        max_length=5, choices=[("es", "Español"), ("en", "English")], default="es"
    )
    theme = models.CharField(
        max_length=10,
        choices=[("system", "Sistema"), ("light", "Claro"), ("dark", "Oscuro")],
        default="system",
    )
    accent = models.CharField(
        max_length=10,
        choices=[
            ("green", "Verde"),
            ("blue", "Azul"),
            ("orange", "Naranja"),
            ("pink", "Rosa"),
            ("violet", "Violeta"),
        ],
        default="green",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class FoodLog(models.Model):
    usuario = models.ForeignKey(User, on_delete=models.CASCADE, related_name="food_logs")
    id_imagen_r2 = models.CharField(max_length=512, help_text="Object key en R2")
    fecha_hora = models.DateTimeField(auto_now_add=True, db_index=True)
    clases_detectadas = ArrayField(models.IntegerField(), default=list)
    volumen_estimado = models.FloatField(help_text="cm³")
    calorias_totales = models.FloatField(help_text="kcal")
    macronutrientes = models.JSONField(default=dict)  # {"proteinas_g":..,"carbohidratos_g":..,"grasas_g":..}
    # Editable per-food breakdown: what the user can correct (class and grams).
    # [{idx, nombre, nombre_es, volumen_cm3, densidad_g_cm3, por_100g, peso_g, peso_manual,
    #   poligono, centroide}]. The totals above are always the sum of this list.
    items = models.JSONField(default=list, blank=True)
    # Plate diameter used to set scale and its source (plate/prior/raw).
    plate_diameter_cm = models.FloatField(default=26.0)
    escala_origen = models.CharField(max_length=10, default="raw")
    # Pipeline warnings saved with the analysis (previously only in the POST response),
    # so the history detail view shows the same warnings as a fresh result.
    advertencias = models.JSONField(default=list, blank=True)
    # Confidence level computed from scale, camera tilt, and classifier score.
    confianza = models.JSONField(default=dict, blank=True)
    consejo_nutricional = models.TextField(blank=True)
    # Estimated camera tilt from vertical in degrees, computed by the pipeline
    # from the support plane. NULL = could not be determined (never defaults to 0).
    angulo_camara_deg = models.FloatField(null=True, blank=True)
    # Contours of each food item on the photo: [{nombre, kcal, poligono, centroide}].
    # Only valid while the image exists in R2 (72 h); cleared when the image is deleted.
    contornos = models.JSONField(default=list, blank=True)
    # Timestamp when the image was deleted from R2 (the database record is kept).
    imagen_eliminada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-fecha_hora"]
        indexes = [models.Index(fields=["usuario", "-fecha_hora"])]

    def __str__(self):
        return f"FoodLog {self.pk} - {self.usuario_id}"

