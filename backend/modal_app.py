"""CaloriesCounter backend (Django) on Modal, CPU-only.

Deploy:   modal deploy modal_app.py
Migrate:  modal run modal_app.py::migrate
Logs:     modal app logs caloriescounter-api

The `caloriescounter-backend` secret must exist before deploying
(Neon DATABASE_URL, R2 keys, Gemini, etc.).
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
    # `copy=True` allows chaining more build steps (collectstatic) afterward.
    .add_local_dir(str(HERE / "config"), "/app/config", copy=True)
    .add_local_dir(str(HERE / "core"), "/app/core", copy=True)
    .add_local_file(str(HERE / "manage.py"), "/app/manage.py", copy=True)
    .workdir("/app")
    .run_commands(
        # Dummy secret just to allow importing settings during build;
        # the real one is injected via the Modal secret at runtime.
        "DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput"
    )
)

secrets = [modal.Secret.from_name("caloriescounter-backend")]


@app.function(image=image, secrets=secrets, timeout=600)
def migrate() -> None:
    """Apply migrations against the database configured in DATABASE_URL."""
    subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd="/app", check=True)
    print("migrations applied")


@app.function(image=image, secrets=secrets, timeout=300)
def db_check() -> None:
    """Verify from inside the container that the database responds."""
    sys.path.insert(0, "/app")
    import django

    django.setup()
    from core.models import FoodLog, User
    from django.conf import settings

    db = settings.DATABASES["default"]
    print(f"DB: {db['NAME']} @ {db['HOST']}")
    print(f"users={User.objects.count()} foodlogs={FoodLog.objects.count()}")
    print(f"gemini_model={settings.GEMINI_MODEL} r2={bool(settings.R2_ACCOUNT_ID)}")


@app.function(image=image, secrets=secrets, timeout=300)
def set_staff(email: str) -> None:
    """Grant staff status (Django Admin access) to the registered user with this email."""
    sys.path.insert(0, "/app")
    import django

    django.setup()
    from core.models import User

    updated = User.objects.filter(email=email).update(is_staff=True)
    print(f"updated users: {updated}")


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
