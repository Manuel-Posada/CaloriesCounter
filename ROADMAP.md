# Roadmap

## Fase 2 — Aviso de foto no cenital ✅

Detección *a posteriori* del ángulo de cámara a partir del plano de apoyo que ya ajusta
`ml/pipeline/volume.py`, para avisar cuando la foto viene torcida (típico de la galería, donde
no hay sensor de inclinación).

- [x] `volume.py`: exponer la normal del plano y calcular `camera_tilt_deg()`
- [x] `runner.py`: agregar el ángulo por imagen y aviso si supera el umbral
- [x] `FoodLog.angulo_camara_deg` + migración + serializer + vista
- [x] Frontend: tarjeta de aviso en el resultado cuando el ángulo es alto
- [x] Retención de 30 días para los `FoodLog` (comando `purge_food_logs`)

## Mejoras de interfaz

- [x] Menú lateral de configuración (drawer) con Perfil, Configuración, Administración
      (solo `is_staff`) y cerrar sesión.
- [x] `GET /api/me/` y `PATCH /api/me/` (nombre y apellidos editables).
- [x] Selector de pipeline A/B en Administración, persistido y enviado en cada análisis.
- [x] **Temas**: claro, oscuro y "sistema", con 5 acentos.
- [x] **Cámara**: FOV horizontal (se envía como `fov_deg`) y sensibilidad del nivel.
- [x] Marcar en el historial las fotos tomadas torcidas (> 15°).
- [x] En móvil se ocultan las barras de desplazamiento; en escritorio se mantienen.

## Resultado con zonas y detalle ✅

- [x] `overlay.py`: contorno de la máscara (`poligono`, ≤ 40 puntos normalizados) y `centroide`
- [x] `runner.py`: `poligono`, `centroide`, `densidad_asumida` y `nutricion.por_100g`
- [x] Foto del resultado: proporción real + `<svg>` con el contorno de cada zona
- [x] Etiqueta por zona con número, nombre y kcal, con separación si se solapan
- [x] Lista de alimentos que abre una hoja de detalle: porción y valores por 100 g
- [x] **Contornos guardados** en `FoodLog.contornos` y pintados en la miniatura del historial
      mientras exista la imagen (72 h); `cleanup_r2_images` los vacía al borrarla.
- [x] **EXIF**: el navegador lee `FocalLengthIn35mmFilm` antes de recomprimir y lo envía como
      `f35_mm`; el pipeline lo usa si la subida no trae EXIF.

## Ideas / posible feature

- [ ] **Recordatorios de comidas** (avisos): requieren permiso de notificaciones y un service
      worker. No es un ajuste más: necesita infraestructura propia.
- [ ] Ver la foto con sus contornos a tamaño completo desde el historial (hoy solo en la
      miniatura de 84 px).
- [ ] Detectar el FOV real de la cámara a partir de `FocalLength` + tamaño de sensor cuando no
      hay `FocalLengthIn35mmFilm`.
