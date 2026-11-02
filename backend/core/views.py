import logging
import time
import uuid

from django.conf import settings
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from . import services
from .models import FoodLog, User
from .r2 import R2NotConfigured, get_r2_client, user_prefix
from .serializers import (
    ALLOWED_CONTENT_TYPES,
    FoodLogCreateSerializer,
    FoodLogSerializer,
    GoogleLoginSerializer,
    PresignRequestSerializer,
    ProfileSerializer,
)

log = logging.getLogger(__name__)


class HealthView(APIView):
    """Sonda de disponibilidad (sin autenticación)."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"status": "ok"})


class GoogleLoginView(APIView):
    """Intercambia un ID token de Google por un par JWT. Único método de login."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        ser = GoogleLoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if not settings.GOOGLE_OAUTH_CLIENT_ID:
            return Response(
                {"detail": "Login con Google no configurado en el servidor (GOOGLE_OAUTH_CLIENT_ID)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            info = google_id_token.verify_oauth2_token(
                ser.validated_data["id_token"],
                g_requests.Request(),
                settings.GOOGLE_OAUTH_CLIENT_ID,
            )
        except ValueError:
            return Response({"detail": "Token de Google inválido."}, status=status.HTTP_401_UNAUTHORIZED)

        if not info.get("email_verified"):
            return Response({"detail": "Email de Google no verificado."}, status=status.HTTP_401_UNAUTHORIZED)

        user = User.objects.filter(google_sub=info["sub"]).first()
        if user is None:
            user = User.objects.create_google_user(
                email=info["email"],
                google_sub=info["sub"],
                first_name=info.get("given_name", ""),
                last_name=info.get("family_name", ""),
                picture_url=info.get("picture", ""),
            )
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh)})


class MeView(generics.RetrieveUpdateAPIView):
    """Perfil del usuario autenticado: avatar, nombre, email y si es administrador.

    `PATCH` permite cambiar solo el nombre y los apellidos.
    """

    serializer_class = ProfileSerializer

    def get_object(self):
        return self.request.user


class PresignedUploadView(APIView):
    """Devuelve una URL PUT prefirmada para subir la imagen directo a R2."""

    def post(self, request):
        ser = PresignRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        content_type = ser.validated_data["content_type"]

        key = f"{user_prefix(request.user.pk)}{uuid.uuid4().hex}.{ALLOWED_CONTENT_TYPES[content_type]}"
        try:
            url = get_r2_client().generate_presigned_url(
                "put_object",
                Params={"Bucket": settings.R2_BUCKET_NAME, "Key": key, "ContentType": content_type},
                ExpiresIn=settings.R2_PRESIGN_EXPIRES,
            )
        except R2NotConfigured as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(
            {
                "upload_url": url,
                "id_imagen_r2": key,
                "method": "PUT",
                "headers": {"Content-Type": content_type},
                "expires_in": settings.R2_PRESIGN_EXPIRES,
            }
        )


class FoodLogListCreateView(generics.ListCreateAPIView):
    """GET: historial del usuario. POST: inferencia (Modal) + consejo (Gemini) + registro."""

    serializer_class = FoodLogSerializer

    def get_queryset(self):
        return FoodLog.objects.filter(usuario=self.request.user)

    def create(self, request, *args, **kwargs):
        inp = FoodLogCreateSerializer(data=request.data, context={"request": request})
        inp.is_valid(raise_exception=True)
        data = inp.validated_data

        t0 = time.perf_counter()
        try:
            image_bytes, content_type = services.download_image_from_r2(data["id_imagen_r2"])
            t1 = time.perf_counter()
            inference = services.run_inference(
                image_bytes, content_type, data["pipeline"], data.get("fov_deg"), data.get("f35_mm")
            )
            t2 = time.perf_counter()
        except services.ServiceError as exc:
            log.warning("food-log: fallo en %.1fs: %s", time.perf_counter() - t0, exc)
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        if not inference.get("alimentos"):
            return Response(
                {"detail": "No se detectaron alimentos en la imagen."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        totales = inference["totales"]
        # El consejo se genera en el idioma que pide el navegador (es por defecto).
        locale = (request.headers.get("Accept-Language") or "es")[:2].lower()
        consejo = services.get_nutrition_advice(inference, locale)
        t3 = time.perf_counter()
        log.info(
            "food-log: r2=%.1fs modal=%.1fs gemini=%.1fs total=%.1fs",
            t1 - t0,
            t2 - t1,
            t3 - t2,
            t3 - t0,
        )

        # Contornos de cada zona para poder pintarlas en el historial mientras exista la
        # imagen en R2 (72 h). Se vacían al borrar la foto en `cleanup_r2_images`.
        contornos = [
            {
                "nombre": a["nombre"],
                "kcal": a["nutricion"]["calorias_kcal"],
                "poligono": a["poligono"],
                "centroide": a.get("centroide"),
            }
            for a in inference["alimentos"]
            if a.get("poligono")
        ]

        ser = self.get_serializer(
            data={
                "id_imagen_r2": data["id_imagen_r2"],
                "clases_detectadas": totales["clases_detectadas"],
                "volumen_estimado": totales["volumen_cm3"],
                "calorias_totales": totales["calorias_kcal"],
                "macronutrientes": {
                    "proteinas_g": totales["proteinas_g"],
                    "carbohidratos_g": totales["carbohidratos_g"],
                    "grasas_g": totales["grasas_g"],
                },
                "consejo_nutricional": consejo,
                "angulo_camara_deg": inference.get("angulo_camara_deg"),
                "contornos": contornos,
            }
        )
        ser.is_valid(raise_exception=True)
        ser.save(usuario=request.user)

        return Response(
            {**ser.data, "alimentos": inference["alimentos"], "advertencias": inference.get("advertencias", [])},
            status=status.HTTP_201_CREATED,
        )

