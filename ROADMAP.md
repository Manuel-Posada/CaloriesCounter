# Roadmap

## Phase 2 — Non-Zenithal Photo Warning ✅

*A posteriori* camera tilt estimation from the support plane already fitted by `ml/pipeline/volume.py`, warning users when a gallery photo was taken at an oblique angle (where no live gyroscope sensor is available).

- [x] `volume.py`: expose plane normal and compute `camera_tilt_deg()`
- [x] `runner.py`: include per-image angle and warning if above threshold
- [x] `FoodLog.angulo_camara_deg` + migration + serializer + view
- [x] Frontend: warning card in result view when tilt angle is high
- [x] 30-day retention for `FoodLog` records (`purge_food_logs` management command)

## Localization (Spanish / English) ✅

- [x] Custom i18n service with Angular signals and typed dictionaries (zero external dependencies)
- [x] Hot-swappable language & per-device preference (`cc.locale`), defaulting to `navigator.language`
- [x] All screens migrated (login, capture, result, history, profile, settings, admin, drawer)
- [x] Locale-aware date and number formatting; `<html lang>` kept in sync
- [x] `Accept-Language` header in API and Gemini prompt localized to user language
- [x] Pipeline warnings returned as codes (`tilt`, `low_volume`, `density_assumed`, `class_missing`)
- [x] **323 food names translated** (`nombre_es` in nutritional CSV), manually reviewed
- [x] Language, theme, and accent persisted in user profile (`User.locale/theme/accent` + `PATCH /me/`), cached in `localStorage` for instant first paint
- [ ] Additional languages (architecture is ready: dictionary + prompt)

## Segmented Result Zones & Nutritional Detail ✅

- [x] `overlay.py`: mask contour (`poligono`, ≤ 40 normalized points) and `centroide`
- [x] `runner.py`: `poligono`, `centroide`, `densidad_asumida`, and `nutricion.por_100g`
- [x] Result photo: true aspect ratio + `<svg>` overlay for each zone contour
- [x] Per-zone label with index, name, and kcal, with vertical overlap separation
- [x] Food list opening a detail sheet: portion breakdown and values per 100 g
- [x] Contours stored in `FoodLog.contornos` and rendered on history thumbnails (72 h)
- [x] EXIF: browser reads `FocalLengthIn35mmFilm` before recompression and sends `f35_mm`

## UI Improvements

- [x] Side account drawer with Profile, Settings, Administration, and Sign out
- [x] `GET/PATCH /api/me/` (editable first and last name)
- [x] A/B pipeline selector in Administration
- [x] Light / dark / system themes with 5 accent colors
- [x] Camera: horizontal FOV and level sensitivity settings
- [x] History: flag tilted photos (> 15°) and render contours
- [x] Hide scrollbars on mobile; keep visible on desktop

## Ideas / Future Features

- [ ] **Meal reminders** (requires notification permissions and a service worker)
- [ ] Full-size photo with contours from history (currently thumbnail-only)
- [ ] Calibrate depth scale with capture distance to enable *Large* model in production
- [ ] Store localized `nombre_es` in history contours as well (currently stored in English)
- [ ] **Topic-restricted AI nutrition chat.** Scoped conversation about the analyzed meal (macros, portions, substitutions, habits), not a general-purpose assistant:
  - *Closed scope*: system prompt defines topic and polite refusal; pre-filter structured call (`{on_topic: bool, motivo}`) gates every question.
  - *Explicit blocks*: medical diagnosis/treatment, medications, eating disorders, and off-topic queries. Never replaces a healthcare professional.
  - *Limits*: context = meal summary only (never raw photo or personal data), session and daily user caps, short `max_output_tokens`, same timeout as advice.
  - *Privacy*: first name used only with user consent; chat history expires after N days.
  - *UI*: tab inside result screen with permanent advisory disclaimer.
  - *Cost*: track tokens per conversation and cache frequent answers.

## Corrections & Detailed Breakdown (2026-11)

- [x] Real-world scale from plate rim (Hough + pinhole geometry) and warning if undetected
- [x] `FoodLog.items`: editable per-food detail; totals are always their sum
- [x] `PATCH /food-logs/<id>/`: edit food class, grams, and plate diameter (volume ∝ diameter³)
- [x] `GET /foods/?q=`: 323-class catalog search, accent-insensitive with regional synonyms (`papa` → `patata`)
- [x] History → `/result/:id` with full detail of any saved analysis
- [x] Swipeable horizontal gallery (`scroll-snap`, thumbnails, synced URL, and prefetching)
- [x] Shared pagination between history and gallery; active panel retry on failure
- [x] Analysis deletion with two-step confirmation (`DELETE /food-logs/<id>/`, also deletes R2 photo)
- [x] Date, time, and year visible in history and result (device timezone)
- [x] Fullscreen camera with locked portrait orientation (Chrome Android)
- [x] Swipe-to-dismiss detail sheet (down) and side drawer (right)
- [x] 30-nutrient per-100 g table inside each food's detail sheet
- [x] Gemini advice regenerated on plate edits; user's first name used ~1/3 of the time
- [x] Confidence level (high/medium/low) with reason flags, recalculated on edits
- [x] "?" indicator on foods with low classifier confidence
- [x] Directional level ring: each arc opens toward the low side (pitch and roll axes)
- [x] Shutter button acts as bubble level: shifts and scales up when centered
- [x] Optional classic level guide inside shutter (crosshair and degrees), frameless
- [x] Pipeline sanity caps (mean height and total weight) with `volume_clamped` warning

## Session & Auth (2026-11)

- [x] Inactivity auto-logout (30 min, 1-minute warning with "Stay signed in")
- [x] Fast re-entry: refresh on startup if access token expired; network drops do not log out
- [x] Logout reason banner on login screen ("Signed out due to inactivity" / "Session expired")
- [x] Cached profile with retries: never stuck on "My account" while signed in
- [ ] Remember device beyond 14-day refresh lifetime (requires token rotation + blacklist)
