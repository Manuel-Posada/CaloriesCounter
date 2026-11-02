"""Backend de CaloriesCounter (Django) en Modal, sin GPU.

Deploy:   modal deploy modal_app.py
Migrar:   modal run modal_app.py::migrate
Logs:     modal app logs caloriescounter-api

El secreto `caloriescounter-backend` tiene que existir antes de desplegar
(DATABASE_URL de Neon, claves de R2, Gemini, etc.).
"""
import subprocess
import sys
from pathlib import Path

import modal

HERE = Path(__file__).parent

app = modal.App("caloriescounter-api")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .env({"DJANGO_SETTINGS_MODULE": "config.settings", "DJANGO_DEBUG": "False"})
    # `copy=True` permite encadenar más pasos de build (collectstatic) después.
    .add_local_dir(str(HERE / "config"), "/app/config", copy=True)
    .add_local_dir(str(HERE / "core"), "/app/core", copy=True)
    .add_local_file(str(HERE / "manage.py"), "/app/manage.py", copy=True)
    .workdir("/app")
    .run_commands(
        # Credenciales falsas solo para poder importar settings durante el build;
        # las reales llegan por el secreto en tiempo de ejecución.
        "DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput"
    )
)

secrets = [modal.Secret.from_name("caloriescounter-backend")]


@app.function(image=image, secrets=secrets, timeout=600)
def migrate() -> None:
    """Aplica migraciones contra la base de datos configurada en DATABASE_URL."""
    subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd="/app", check=True)
    print("migraciones aplicadas")


@app.function(image=image, secrets=secrets, timeout=300)
def db_check() -> None:
    """Comprueba desde el contenedor que la base de datos responde."""
    sys.path.insert(0, "/app")
    import django

    django.setup()
    from django.conf import settings

    from core.models import FoodLog, User

    db = settings.DATABASES["default"]
    print(f"DB: {db['NAME']} @ {db['HOST']}")
    print(f"usuarios={User.objects.count()} foodlogs={FoodLog.objects.count()}")
    print(f"modelo gemini={settings.GEMINI_MODEL} r2={bool(settings.R2_ACCOUNT_ID)}")


@app.function(
    image=image,
    secrets=secrets,
    cpu=1.0,
    memory=1024,
    timeout=300,
    scaledown_window=300,
)
@modal.wsgi_app()
def django():
    sys.path.insert(0, "/app")
    from config.wsgi import application

    return application
