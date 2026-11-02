from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.contrib.postgres.fields import ArrayField
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_google_user(self, email, google_sub, **extra):
        user = self.model(email=self.normalize_email(email), google_sub=google_sub, **extra)
        user.set_unusable_password()  # Login por contraseña imposible
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        # Solo para acceder al /admin; los usuarios finales entran únicamente con Google.
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractUser):
    """Usuario identificado por email; los usuarios finales se autentican solo con Google."""

    username = None
    email = models.EmailField(unique=True)
    google_sub = models.CharField(
        "Google subject ID", max_length=255, unique=True, null=True, blank=True
    )
    picture_url = models.URLField(blank=True)

    # Preferencias de interfaz, para que sigan al usuario entre dispositivos.
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
    # Detalle editable por alimento: lo que el usuario puede corregir (clase y gramos).
    # [{idx, nombre, nombre_es, volumen_cm3, densidad_g_cm3, por_100g, peso_g, peso_manual,
    #   poligono, centroide}]. Los totales de arriba siempre son la suma de esto.
    items = models.JSONField(default=list, blank=True)
    # Diámetro del plato con el que se fijó la escala y de dónde salió (plate/prior/raw).
    plate_diameter_cm = models.FloatField(default=26.0)
    escala_origen = models.CharField(max_length=10, default="raw")
    # Avisos del pipeline guardados con el análisis (antes solo vivían en la respuesta del POST):
    # así el detalle del historial muestra los mismos avisos que el resultado recién hecho.
    advertencias = models.JSONField(default=list, blank=True)
    # Nivel de confianza calculado a partir de la escala, la inclinación y el clasificador.
    confianza = models.JSONField(default=dict, blank=True)
    consejo_nutricional = models.TextField(blank=True)
    # Inclinación estimada de la cámara respecto a la vertical, en grados, calculada por el
    # pipeline a partir del plano de apoyo. NULL = no se pudo determinar (nunca 0 por defecto).
    angulo_camara_deg = models.FloatField(null=True, blank=True)
    # Contornos de cada alimento sobre la foto: [{nombre, kcal, poligono, centroide}].
    # Solo sirven mientras exista la imagen en R2 (72 h); se vacían al borrarla.
    contornos = models.JSONField(default=list, blank=True)
    # Marca cuándo se borró la imagen de R2 (el registro se conserva).
    imagen_eliminada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-fecha_hora"]
        indexes = [models.Index(fields=["usuario", "-fecha_hora"])]

    def __str__(self):
        return f"FoodLog {self.pk} - {self.usuario_id}"

