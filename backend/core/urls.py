from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("auth/google/", views.GoogleLoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("me/", views.MeView.as_view()),
    path("uploads/presign/", views.PresignedUploadView.as_view()),
    path("food-logs/", views.FoodLogListCreateView.as_view()),
]

