from django.contrib import admin

from .models import FoodLog, User

admin.site.register(User)
admin.site.register(FoodLog)

