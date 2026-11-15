from core.views import HealthView
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health", HealthView.as_view()),
    path("health/", HealthView.as_view()),
    path("api/", include("core.urls")),
]

