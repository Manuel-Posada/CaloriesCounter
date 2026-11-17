# Roadmap

## Phase 2: Non-Top-Down Photo Warning ✅

Post-hoc detection of the camera angle, derived from the support plane already fitted by
`ml/pipeline/volume.py`, to warn the user when a photo is tilted (typical for gallery uploads,
where there is no tilt sensor).

- [x] `volume.py`: expose the plane normal and compute `camera_tilt_deg()`
- [x] `runner.py`: aggregate the angle per image and raise a warning above the threshold
- [x] `FoodLog.angulo_camara_deg` + migration + serializer + view
- [x] Frontend: warning card on the result screen when the angle is high
- [x] 30-day retention for `FoodLog` records (`purge_food_logs` command)

## Languages (Spanish / English) ✅

- [x] In-house i18n service built on signals and typed dictionaries (zero dependencies)
- [x] Hot-swappable language with a per-device preference (`cc.locale`); defaults to `navigator.language`
- [x] All screens migrated (login, capture, result, history, profile, settings, admin, menu)
- [x] Dates and numbers formatted per locale; `<html lang>` kept in sync
- [x] `Accept-Language` support in the API and Gemini prompt in the user's language
- [x] Pipeline warnings emitted as codes (`tilt`, `low_volume`, `density_assumed`, `class_missing`)
- [x] **323 food names translated** (`nombre_es` in the nutrition CSV), reviewed by the user
- [x] Language, theme and accent stored in the profile (`User.locale/theme/accent` + `PATCH /me/`),
      synced with `localStorage` as a cache for the first paint
- [ ] More languages (the structure already supports it: dictionary + prompt)

## Result View with Zones and Detail ✅

- [x] `overlay.py`: mask outline (`poligono`, ≤ 40 normalized points) and `centroide`
- [x] `runner.py`: `poligono`, `centroide`, `densidad_asumida` and `nutricion.por_100g`
- [x] Result photo: true aspect ratio + `<svg>` overlay with each zone's outline
- [x] Per-zone label with number, name and kcal, with collision handling when labels overlap
- [x] Food list that opens a detail sheet: portion and per-100 g values
- [x] Outlines stored in `FoodLog.contornos` and drawn on the history thumbnail (72 h)
- [x] EXIF: the browser reads `FocalLengthIn35mmFilm` before recompression and sends it as `f35_mm`

## UI Improvements

- [x] Settings side menu with Profile, Settings, Administration and sign out
- [x] `GET/PATCH /api/me/` (editable first and last name)
- [x] A/B pipeline selector and depth predictor size (Small vs. Large) in Administration
- [x] Light / dark / system themes with 5 accent colors
- [x] Camera: horizontal FOV and level sensitivity
- [x] History: flag tilted photos (> 15°) and draw their outlines
- [x] Scrollbars hidden on mobile; kept on desktop

## Ideas / Potential Features

- [ ] **Meal reminders** (require notification permission and a service worker)
- [ ] View the photo with its outlines at full size from the history (currently thumbnail only)
- [x] Calibrate the depth scale against capture distance so the *Large* model can be used (evaluated and calibrated in `research/notebooks/D1_depth_calibration_nutrition5k.ipynb` and validated against a scale on Nutrition5k)
- [ ] Store `nombre_es` in the history outlines as well (currently stored in English)
- [ ] **Chat with the agent, with strict topic control.** A conversation about the analyzed plate
      (macros, portions, substitutions, habits), not a general-purpose assistant:
      - *Closed scope*: the system prompt defines the topic and a polite refusal message; a prior
        call with structured output (`{on_topic: bool, reason}`) filters the question before
        answering.
      - *Explicit blocks*: medical diagnosis or treatment, medication, eating disorders, and any
        topic unrelated to nutrition. It never replaces a professional.
      - *Limits*: context = plate summary (never the photo or personal data), cap on messages per
        session and per user/day, short `max_output_tokens`, and the same timeout as the advice
        feature.
      - *Privacy*: first name only if the user allows it; chat history expires after N days.
      - *UI*: a tab inside the result view and a permanent notice that the output is for guidance only.
      - *Cost*: measure tokens per conversation and cache frequent answers.

## Corrections and Detail (2026-11)

- [x] True scale from the plate rim (Hough + pinhole geometry) with a warning if it isn't detected
- [x] `FoodLog.items`: editable per-food detail; totals are their sum
- [x] `PATCH /food-logs/<id>/`: correct class, grams and plate diameter (volume ∝ diameter³)
- [x] `GET /foods/?q=`: 323-class catalog, accent-insensitive and with synonyms (`papa` → `patata`)
- [x] History → `/result/:id` with the detail of any saved analysis
- [x] Swipeable gallery across analyses (scroll-snap, thumbnails, synced URL and preloading)
- [x] Pagination shared between history and gallery; active-panel detail with retry
- [x] Analysis deletion with confirmation (`DELETE /food-logs/<id>/`, also removes the photo from R2)
- [x] Date, time and year visible in history and result (device time zone)
- [x] Full-screen camera with portrait orientation lock (Chrome Android)
- [x] Sheet and menu close by swiping (down / right)
- [x] 30-nutrient per-100 g table on each food's detail card
- [x] Gemini advice regenerates when the plate is corrected; first name appears ~1 in 3 times
- [x] Confidence level (high / medium / low) with its reasons, recomputed on correction
- [x] "?" badge on foods the classifier was unsure about
- [x] Directional ring: each side opens toward the lower edge (tilt and roll axes)
- [x] The shutter is the level: a bubble that moves and grows as it centers
- [x] Optional classic guide inside the shutter (crosshair and degrees), frameless
- [x] Pipeline sanity caps (mean height and total weight) with the `volume_clamped` warning

## Session (2026-11)

- [x] Sign-out on inactivity (30 min, with a warning one minute before and a "Stay signed in" option)
- [x] Fast re-entry: refresh on startup if the access token expired; a network outage no longer signs the user out
- [x] Reason shown on the login screen ("We signed you out due to inactivity" / "Your session expired")
- [x] Profile cached and retried: never stuck on "My account" while signed in
- [ ] Remember the device beyond the 14-day refresh window (requires token rotation + blacklist)