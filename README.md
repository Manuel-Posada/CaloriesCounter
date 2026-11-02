# caloriescounter.app – Scaffolding

## Estructura

```
CaloriesCounter/
├── backend/                  # Django + DRF
│   ├── config/               # settings.py, urls.py, wsgi/asgi (startproject)
│   ├── apps/                 # apps de dominio (vacío por ahora)
│   ├── manage.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/                 # Angular
│   └── src/
│       ├── app/
│       │   ├── core/         # servicios singleton, interceptores
│       │   ├── shared/       # módulo compartido
│       │   └── features/     # módulos por funcionalidad (lazy)
│       └── environments/     # environment.ts / environment.prod.ts
├── .gitignore
└── README.md
```

## 1. Backend (Django 6.1 + PostgreSQL + DRF)

Requiere Python ≥ 3.12 y PostgreSQL en ejecución.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Crea el proyecto en el directorio actual (genera manage.py y config/)
django-admin startproject config .
mkdir apps
Copy-Item .env.example .env      # y edita los valores

# Base de datos
psql -U postgres -c "CREATE DATABASE caloriescounter;"
```

### Cambios en `config/settings.py`

```python
from pathlib import Path
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("DJANGO_SECRET_KEY")
DEBUG = config("DJANGO_DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("DJANGO_ALLOWED_HOSTS", default="localhost", cast=Csv())

INSTALLED_APPS = [
    # ... apps por defecto de Django ...
    "corsheaders",
    "rest_framework",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",   # antes de CommonMiddleware
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    # ... resto por defecto ...
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("POSTGRES_DB", default="caloriescounter"),
        "USER": config("POSTGRES_USER", default="postgres"),
        "PASSWORD": config("POSTGRES_PASSWORD", default=""),
        "HOST": config("POSTGRES_HOST", default="localhost"),
        "PORT": config("POSTGRES_PORT", default="5432"),
    }
}

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],  # endurecer luego
}

# CORS (desarrollo)
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:4200,http://127.0.0.1:4200",
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
```

```powershell
python manage.py migrate
python manage.py runserver   # http://localhost:8000
```

## 2. Frontend (Angular modular)

Requiere Node LTS. `--no-standalone` genera un proyecto basado en NgModules.

```powershell
cd frontend/..   # raíz del repo
npm install -g @angular/cli
ng new frontend --no-standalone --routing --style=scss --skip-git
cd frontend
ng generate module core
ng generate module shared
ng generate module features --routing
ng generate environments      # crea src/environments/ (ya incluido en este repo)
ng serve                      # http://localhost:4200
```

> Si `ng new` pregunta por el directorio existente, ejecútalo tras mover/borrar `frontend/src/environments` y vuelve a copiarlo, o usa `ng generate environments` después.

Los archivos `environment.ts` (apunta a `http://localhost:8000/api`) y `environment.prod.ts` ya están creados. Si `ng generate environments` los regenera, conserva `apiUrl`.

### Modo guiado cenital

La pantalla de captura abre la cámara dentro de la página (`getUserMedia`) y usa `DeviceOrientationEvent`
para medir la inclinación del móvil: el aro y el disparador se ponen verdes cuando la cámara está
perpendicular a la mesa (≤ 8°, con histéresis hasta 12°) y, si se mantiene, dispara solo con cuenta atrás.
Es lo que garantiza que el cálculo de volumen reciba una foto cenital. Si no hay sensor (escritorio) o
no se concede el permiso, cae a la guía estática y a la cámara del sistema.

### Aviso de foto no cenital

La guía solo actúa en la captura en vivo; las fotos de la galería pueden venir torcidas. Para ese caso
el pipeline mide la inclinación *a posteriori*: el plano de apoyo que ajusta `volume.py` (RANSAC sobre el
anillo alrededor de la comida) es la mesa, así que el ángulo entre su normal y el eje óptico da
`angulo_camara_deg`. Solo se reporta cuando el plano viene del anillo; si la salvaguarda lo sustituye,
el campo vale `null` en vez de un `0°` falso.

A partir de 15° (`TILT_WARN_DEG` en el pipeline, `TILT_WARN_DEG` en `core/tilt.service.ts`) el resultado
muestra una tarjeta ámbar avisando de que el volumen puede estar sobreestimado. No se bloquea la subida:
la inferencia ya está pagada.

### Resultado: zonas segmentadas y detalle nutricional

El pipeline devuelve, por cada alimento, el contorno de su máscara (`poligono`, ≤ 40 puntos normalizados
a 0..1) y su `centroide`. El resultado los pinta sobre la foto con un `<svg>` superpuesto y una etiqueta
por zona con el número, el nombre y las kcal. El `<figure>` toma la proporción real de la imagen al
cargarla, así que el contorno coincide exactamente aunque la foto no sea 4:3.

Las etiquetas que caen demasiado juntas se separan en vertical y se unen a su centro con una línea
discontinua. Para leerlas sin solapar nada, el `viewBox` va de 0 a 1 y los trazos usan
`vector-effect: non-scaling-stroke` para no deformarse con la escala.

Debajo, la lista de alimentos abre una hoja (`<dialog>`) con dos bloques: **en tu porción** (gramos,
kcal y macros calculados) y **por 100 g** (los valores del CSV tal cual, `nutricion.por_100g`). Ahí
también se ve el volumen, la densidad —avisando si se asumió 1 g/cm³— y la confianza del clasificador.

Los contornos se guardan en `FoodLog.contornos` (`JSONField`) para pintarlos en la miniatura del
historial. Solo tienen sentido mientras exista la foto, así que `cleanup_r2_images` los vacía al
borrar la imagen de R2.

### Metadatos de la foto (EXIF)

La subida se recomprime en el navegador (canvas → JPEG ≤ 1280 px), lo que **borra el EXIF**. Como la
focal es lo que más afecta al volumen, la captura lee `FocalLengthIn35mmFilm` del fichero original
(`core/exif.util.ts`, con `exifr`) antes de comprimir y lo manda como `f35_mm` en el `POST`.

Prioridad del pipeline para la focal (`resolve_focal_px`): `fov_deg` explícito > `f35_mm` > 65°.

- Si el formato no expone EXIF (PNG, captura de pantalla, HEIC sin metadatos), no se envía nada y se
  usa el FOV de Configuración o el valor por defecto.
- `modal_app.predict()` acepta `f35_mm`, pero si el fichero que llega trae EXIF, **manda el del
  fichero**.

### Retención de datos

| Dato | Vida | Quién lo borra |
|---|---|---|
| Imagen en R2 | 72 h (`R2_RETENTION_HOURS`) | `python manage.py cleanup_r2_images` |
| Contornos (`FoodLog.contornos`) | 72 h (se vacían con la imagen) | `python manage.py cleanup_r2_images` |
| `FoodLog` (historial) | 30 días (`FOOD_LOG_RETENTION_DAYS`) | `python manage.py purge_food_logs` |

Ambos comandos aceptan `--dry-run`. Programarlos con cron/Task Scheduler (por ejemplo, cada hora el
primero y una vez al día el segundo):

```powershell
python manage.py cleanup_r2_images --hours 72
python manage.py purge_food_logs --days 30
```

> `getUserMedia` y los sensores exigen contexto seguro: `localhost` o HTTPS. Para probar en un móvil de
> la red local hace falta certificado:
>
> ```powershell
> ng serve --host 0.0.0.0 --ssl true   # acepta el aviso de certificado en el móvil
> ```
>
> En iOS 13+ el permiso del sensor se pide al pulsar "Abrir cámara guiada" (requisito de Safari).

### Menú de cuenta

El tercer botón de la barra inferior es el avatar de la cuenta (foto de Google, o iniciales si no
hay). Abre un menú lateral con el nombre y el email, y tres entradas:

| Entrada | Quién la ve | Qué hace |
|---|---|---|
| Perfil | todos | Avatar, nombre y email; permite editar nombre y apellidos (`PATCH /api/me/`) |
| Configuración | todos | Tema, color de acento y ajustes de cámara |
| Administración | solo `is_staff` | Selector de pipeline A/B |

El selector de pipeline se guarda en `localStorage` (`cc.pipeline`) y **solo afecta a ese
dispositivo**: el valor viaja en cada `POST /food-logs/`, así que no cambia el de producción para el
resto. Se borra al cerrar sesión para que no lo herede el siguiente usuario. `/admin` está protegido
también en el router (`adminGuard`), no solo oculto en el menú.

En `ProfileSerializer` solo `first_name` y `last_name` son editables: `email`, `picture_url` e
`is_staff` son de solo lectura porque los manda Google o los decide el servidor.

### Temas, acento y cámara

Todo se guarda en `localStorage` y se aplica antes del primer pintado con un script en línea en
`index.html` (evita el destello del tema claro):

| Preferencia | Clave | Valores |
|---|---|---|
| Tema | `cc.theme` | `system` (por defecto), `light`, `dark` |
| Acento | `cc.accent` | `green` (por defecto), `blue`, `orange`, `pink`, `violet` |
| Campo de visión | `cc.fov` | `null` (EXIF o 65°) o `60`…`80` grados |
| Sensibilidad del nivel | `cc.level` | `strict` (5°/8°), `normal` (8°/12°), `relaxed` (12°/16°) |

El tema se aplica con `data-theme` en `<html>` y el acento con `data-accent`; los tokens viven en
`styles/_tokens.scss`. El ajuste de tema sigue a `prefers-color-scheme` cuando está en `system`.
El FOV elegido se manda como `fov_deg` en el `POST /food-logs/`; si es «Automático» no se envía y el
pipeline usa el EXIF de la foto o 65°.

### Desplazamiento

En móvil (`max-width: 640px` o puntero táctil) se ocultan las barras de desplazamiento: se navega con
el dedo y se gana espacio. En escritorio se mantienen, porque son la única pista de que un menú o una
página sigue hacia abajo. `html, body` usan `overflow-x: clip` para que nada provoque desplazamiento
horizontal.

### Dependencias clave (`package.json`)

`ng new` ya incluye `@angular/core`, `common`, `forms`, `router`, `platform-browser`, `rxjs`, `zone.js`, `tslib` y, en devDependencies, `@angular/cli`, `@angular/compiler-cli`, `typescript`.

Opcionales a añadir según se necesite:

```powershell
npm install @angular/cdk @angular/material   # UI (fase posterior)
```

Usa `HttpClientModule`/`provideHttpClient()` de `@angular/common/http` (ya incluido) para consumir `environment.apiUrl`.

## 3. Archivo de requirements

Ver [backend/requirements.txt](backend/requirements.txt): Django, djangorestframework, django-cors-headers, psycopg (v3), python-decouple, gunicorn.

