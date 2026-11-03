import logging
import time
import uuid

from botocore.exceptions import ClientError
from django.conf import settings
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from . import food_items, nutrition, services
from .models import FoodLog, User
from .r2 import R2NotConfigured, get_r2_client, user_prefix
from .serializers import (
    ALLOWED_CONTENT_TYPES,
    FoodLogCreateSerializer,
    FoodLogDetailSerializer,
    FoodLogEditSerializer,
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
        consejo = services.get_nutrition_advice(
            inference, locale, user_name=services.pick_name(request.user.first_name)
        )
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
        items = food_items.items_from_inference(inference["alimentos"])
        escala = inference.get("escala") or {}

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
                "items": items,
                "escala_origen": escala.get("origen", "raw"),
                "plate_diameter_cm": escala.get("plate_diameter_cm", 26.0),
            }
        )
        ser.is_valid(raise_exception=True)
        ser.save(usuario=request.user)

        # Avisos y confianza se guardan con el análisis para que el detalle del historial los
        # muestre igual que el resultado recién calculado.
        registro = ser.instance
        registro.advertencias = inference.get("advertencias", [])
        food_items.attach_confidence(registro)
        registro.save(update_fields=["advertencias", "confianza"])

        return Response(
            {
                **ser.data,
                "alimentos": food_items.alimentos_from_items(items),
                "advertencias": registro.advertencias,
            },
            status=status.HTTP_201_CREATED,
        )


class FoodLogDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET: detalle de un análisis (con alimentos). PATCH: correcciones. DELETE: borrarlo."""

    serializer_class = FoodLogDetailSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_queryset(self):
        return FoodLog.objects.filter(usuario=self.request.user)

    def perform_destroy(self, instance):
        # El registro se borra igual aunque R2 falle: la foto caduca sola a las 72 h.
        key = instance.id_imagen_r2
        instance.delete()
        if not key:
            return
        try:
            get_r2_client().delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)
        except (R2NotConfigured, ClientError) as exc:
            log.warning("food-log: no se pudo borrar %s de R2: %s", key, exc)

    def patch(self, request, *args, **kwargs):
        obj = self.get_object()
        inp = FoodLogEditSerializer(data=request.data)
        inp.is_valid(raise_exception=True)
        data = inp.validated_data

        try:
            if data.get("plate_diameter_cm") is not None:
                if obj.escala_origen != "plate":
                    return Response(
                        {"detail": "Este análisis no usó el plato como referencia de escala."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                food_items.apply_plate_diameter(obj, data["plate_diameter_cm"])
            if data.get("items"):
                food_items.apply_edits(obj, data["items"])
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        update_fields = [
            "items", "volumen_estimado", "calorias_totales", "macronutrientes",
            "clases_detectadas", "contornos", "plate_diameter_cm", "confianza",
        ]
        # El consejo habla del plato, así que al corregirlo se vuelve a pedir (si Gemini falla,
        # se conserva el anterior en lugar de dejar la ficha sin texto).
        locale = (request.headers.get("Accept-Language") or "es")[:2].lower()
        consejo = services.get_nutrition_advice(
            food_items.inference_like(obj),
            locale,
            user_name=services.pick_name(request.user.first_name),
            timeout_s=6,
        )
        if consejo:
            obj.consejo_nutricional = consejo
            update_fields.append("consejo_nutricional")

        obj.save(update_fields=update_fields)
        return Response(self.get_serializer(obj).data)

class FoodCatalogView(APIView):
    """GET: catálogo de alimentos para corregir una detección (búsqueda por nombre)."""

    def get(self, request):
        query = request.query_params.get("q", "")
        limit = min(int(request.query_params.get("limit", 20) or 20), 50)
        return Response({"resultados": nutrition.search(query, limit)})


