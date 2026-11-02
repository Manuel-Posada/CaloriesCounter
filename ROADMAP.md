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

## Idiomas (español / inglés) ✅

- [x] Servicio de i18n propio con signals y diccionarios tipados (sin dependencias)
- [x] Cambio en caliente y preferencia por dispositivo (`cc.locale`); por defecto, `navigator.language`
- [x] Todas las pantallas migradas (login, captura, resultado, historial, perfil, ajustes, admin, menú)
- [x] Fechas y números con el formato de cada idioma; `<html lang>` sincronizado
- [x] `Accept-Language` en la API y prompt de Gemini en el idioma del usuario
- [x] Avisos del pipeline como códigos (`tilt`, `low_volume`, `density_assumed`, `class_missing`)
- [x] **323 nombres de comida traducidos** (`nombre_es` en el CSV nutricional), revisados por el usuario
- [x] Idioma, tema y acento guardados en el perfil (`User.locale/theme/accent` + `PATCH /me/`),
      sincronizados con `localStorage` como caché para el primer pintado
- [ ] Más idiomas (la estructura ya lo permite: diccionario + prompt)

## Resultado con zonas y detalle ✅

- [x] `overlay.py`: contorno de la máscara (`poligono`, ≤ 40 puntos normalizados) y `centroide`
- [x] `runner.py`: `poligono`, `centroide`, `densidad_asumida` y `nutricion.por_100g`
- [x] Foto del resultado: proporción real + `<svg>` con el contorno de cada zona
- [x] Etiqueta por zona con número, nombre y kcal, con separación si se solapan
- [x] Lista de alimentos que abre una hoja de detalle: porción y valores por 100 g
- [x] Contornos guardados en `FoodLog.contornos` y pintados en la miniatura del historial (72 h)
- [x] EXIF: el navegador lee `FocalLengthIn35mmFilm` antes de recomprimir y lo envía como `f35_mm`

## Mejoras de interfaz

- [x] Menú lateral de configuración con Perfil, Configuración, Administración y cerrar sesión
- [x] `GET/PATCH /api/me/` (nombre y apellidos editables)
- [x] Selector de pipeline A/B en Administración
- [x] Temas claro/oscuro/sistema con 5 acentos
- [x] Cámara: FOV horizontal y sensibilidad del nivel
- [x] Historial: marcar fotos torcidas (> 15°) y pintar sus contornos
- [x] En móvil se ocultan las barras de desplazamiento; en escritorio se mantienen

## Ideas / posible feature

- [ ] **Recordatorios de comidas** (necesitan permiso de notificaciones y un service worker)
- [ ] Ver la foto con sus contornos a tamaño completo desde el historial (hoy solo en la miniatura)
- [ ] Calibrar la escala de profundidad con la distancia de captura para poder usar el modelo *Large*
- [ ] Guardar el `nombre_es` también en los contornos del historial (hoy se guardan en inglés)
- [ ] **Chat con el agente, con control estricto de tema.** Conversación sobre el plato analizado
      (macros, porciones, sustituciones, hábitos), no un asistente general:
      - *Alcance cerrado*: el system prompt define el tema y una respuesta de rechazo amable; una
        llamada previa con salida estructurada (`{on_topic: bool, motivo}`) filtra la pregunta antes
        de responder.
      - *Bloqueos explícitos*: diagnóstico o tratamiento médico, medicamentos, trastornos de la
        conducta alimentaria, y cualquier tema ajeno a nutrición. Nunca sustituye a un profesional.
      - *Límites*: contexto = resumen del plato (nunca la foto ni datos personales), tope de
        mensajes por sesión y por usuario/día, `max_output_tokens` corto y el mismo timeout que el
        consejo.
      - *Privacidad*: el nombre de pila solo si el usuario lo permite; el historial del chat caduca
        a los N días.
      - *UI*: pestaña dentro del resultado y aviso permanente de que es orientativo.
      - *Coste*: medir tokens por conversación y cachear las respuestas frecuentes.

## Correcciones y detalle (2026-11)

- [x] Escala real con el borde del plato (Hough + geometría pinhole) y aviso si no se detecta
- [x] `FoodLog.items`: detalle editable por alimento; los totales son su suma
- [x] `PATCH /food-logs/<id>/`: corregir clase, gramos y diámetro del plato (volumen ∝ diámetro³)
- [x] `GET /foods/?q=`: catálogo de 323 clases sin tildes y con sinónimos (`papa` → `patata`)
- [x] Historial → `/result/:id` con el detalle de cualquier análisis guardado
- [x] Tabla de 30 nutrientes por 100 g en la ficha de cada alimento
- [x] El consejo de Gemini se regenera al corregir el plato; el nombre de pila aparece ~1 de cada 3 veces
- [x] Nivel de confianza (alta/media/baja) con sus motivos, recalculado al corregir
- [x] Aviso «?» en los alimentos que el clasificador no tenía claros
- [x] Topes de cordura del pipeline (altura media y peso total) con el aviso `volume_clamped`

## Sesión (2026-11)

- [x] Cierre de sesión por inactividad (30 min, con aviso un minuto antes y «Seguir conectado»)
- [x] Reentrada rápida: refresh al arrancar si el access caducó, y la red caída ya no cierra sesión
- [x] Aviso del motivo en el login («Cerramos tu sesión por inactividad» / «Tu sesión caducó»)
- [ ] Recordar el dispositivo más allá de los 14 días del refresh (requiere rotación + lista negra)

