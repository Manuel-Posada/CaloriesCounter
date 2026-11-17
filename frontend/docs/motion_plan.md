# Strategic Motion & Micro-interactions Plan — CaloriesCounter

This plan defines the Motion Design architecture to give **CaloriesCounter** a physical, organic, and cohesive feel worthy of a native flagship app while maintaining a strict 60–120 fps mobile budget (animating exclusively `transform`, `opacity`, `filter`, and SVG vector properties).

## 1. Physics, Easing Curves & Spatial Depth

### 1.1. Spring Physics Motion Tokens (`linear()`)

Currently the project reuses a single `cubic-bezier(0.22, 1, 0.36, 1)` curve across more than 20 selectors (`capture.scss`, `drawer.scss`, `result.scss`, `app.scss`). While smooth on deceleration, it lacks the inertia and elasticity of native iOS springs (`CASpringAnimation`).

Proposal in `_tokens.scss`: Centralize three physics-based curves using `linear()` (supported in Chrome 113+, Safari 17.2+, Firefox 112+) with `cubic-bezier` fallbacks:
- `--ease-spring-sheet` (Mass 1, Stiffness 280, Damping 28 — 1.5% under-damped): For large surfaces like `.drawer` and `.sheet`, giving organic settling without excessive bounce.
- `--ease-spring-pop` (Stiffness 380, Damping 22 — 4% overshoot): For popping micro-elements like `.tag` labels on the plate, completed step checkmarks, active `.tabbar` icon, and countdown digits.
- `--ease-out-quart` (`cubic-bezier(0.165, 0.84, 0.44, 1)`): For exit transitions and opacity fades.

### 1.2. Exit Transitions on Drawer & Sheet

> [!IMPORTANT]
> Both the side drawer (`drawer.ts`) and the nutrition detail sheet (`result.ts`) have entry animations, but vanish instantaneously in 0 ms on close because the DOM unmounts or `dialog.close()` runs synchronously.

Proposed solution:
In `Drawer` and `Result`, add a transient `closing` state (or use CSS `@starting-style` + `transition-behavior: allow-discrete` on `<dialog>`) for 240 ms with `--ease-out-quart` so panels slide out smoothly (`translateX(100%)` / `translateY(100%)`) while `.scrim` / `::backdrop` fades opacity to `0`.

### 1.3. 3D Modal Depth (Push-Back `scale(0.96)` Effect)

Proposal in `app.scss` and `result.ts`:
When `body.menu-open` or `body.sheet-open` is active, apply to `<main>` and `.topbar`:
- `transform: scale(0.96) translateY(4px);`
- `border-radius: var(--radius-lg);`
- `filter: brightness(0.92);`
- `transform-origin: center top;`

This layered sheet depth signals that the main context remains alive behind the modal and springs back to `scale(1)` on close.

## 2. State Choreography: `'working'` to `'result'`

Currently, transitioning from `Capture` (`mode() === 'working'`) to `Result` remounts the image from scratch, while polygons and `.results-panel` (`translateY(100%)`) compete simultaneously in the first 350 ms.

We propose a 4-beat AI discovery choreography narrating the analysis pipeline:

- **Phase 0 — Photo Continuity (View Transitions API):**
  Enable `withViewTransitions()` in `app.config.ts` and assign `view-transition-name: plate-hero` to `.preview img` and `.photo img` so the captured photo morphs seamlessly from the scanning container into the result header.
- **Phase 1 — Perimeter Polygon Drawing (AI Contour Drawing):**
  In `result.ts`, add `pathLength="1"` to each `<polygon>` and in `result.scss` animate `stroke-dasharray: 1; stroke-dashoffset: 1 -> 0` over 420 ms followed by translucent green fill (`fill-opacity: 0 -> 1`), staggered by `--i * 90ms`.
- **Phase 2 — Spring Connectors & Floating `.tag` Labels:**
  Delay each `.tag` entrance to `calc(var(--i, 0) * 0.09s + 0.24s)` so each label pops in with `--ease-spring-pop` (`scale(0.75) -> scale(1)`) right as its polygon finishes drawing.
- **Phase 3 — Card Cascade, Calorie Count-Up & Macro Bar:**
  Replace the abrupt `translateY(100%)` on `.results-panel` with a staggered entrance of its children (`.advice`, `.summary`, `h2`, `.foods`) using a short `translateY(18px) -> 0`.
  Add a 550 ms `requestAnimationFrame` calorie count-up in `result.ts`, synced with horizontal growth (`scaleX(0) -> scaleX(1)`) of macro segments in `.split`.

## 3. Micro-interactions & Tactile Feedback

### 3.1. Unified Tactile Response (`:active` with Spring Physics)

| Component | Current State | Proposed Improvement |
|---|---|---|
| History cards (`.card.row`, `.card.text-only`) | No `:active` or `transition` (inert on touch). | `transition: transform 0.2s var(--ease-spring-pop), border-color 0.2s, box-shadow 0.2s;` and `:active { transform: scale(0.975); }`. |
| Food rows (`.food`) | `scale(0.995)` with no `transition` (imperceptible). | `:active { transform: scale(0.975); }` with `.chev` shift (`translateX(3px)` on `:hover/:active`). |
| Plate size selector (`.plate-size__btn`) | Abrupt color switch without transition. | Tactile `scale(0.93)` press and smooth background/border transition on portion recalculation. |
| Segmented controls (`.segmented button`) | Instant background swap. | Add background/shadow transition and `:active { transform: scale(0.96); }`. |
| Color swatches (`.swatch`) | No checkmark animation. | Animate inner span `transform: scale(0.4) -> scale(1)` with `--ease-spring-pop` on activation. |

### 3.2. Scanner & Loading States (`'working'`) Modernization

- **Luminous Scan Beam (`.scan`):** Pair the 3 px scan line with a 48 px `::after` vertical gradient trail and subtle image breathing (`scale(1) <-> scale(1.02)`).
- **Elastic Progress Steps (`.steps`):** When a step transitions from `.active` to `.done`, animate `.dot` and `✓` with `@keyframes check-pop` (`scale(0.5) -> scale(1.12) -> scale(1)`) and an expanding `box-shadow` pulse on `.active`.

## 4. Navigation Cohesion (Routes & History)

- **Spatial Tab Transitions (`withViewTransitions`):** Isolate `.topbar` and `.tabbar` with fixed `view-transition-name`s (`app-topbar`, `app-tabbar`) so top/bottom bars stay pinned while only `<main>` cross-transitions.
- **History Staggering & Thumbnail Reveal (`history.ts` / `history.scss`):** Assign `[style.--i]="$index % 10"` per `<li>` (modulo 10 so "Load more" batches also stagger from 0 ms) with `slide-up-fade` (`calc(var(--i, 0) * 0.045s)`) and fade `.thumb` / `.thumb-overlay` in (`opacity: 0 -> 1`) once `(load)` confirms `size(log.id)`.

## 5. Implementation Priority Matrix

### Tier 1 — High Impact (Core Experience & Wow Factor)
- Spring physics tokens (`linear()`) in `_tokens.scss` + exit animations & 3D push-back (`scale(0.96)`) on Drawer and Sheet.
- 4-phase `'working' -> 'result'` choreography in `result.ts` / `result.scss` (vector contour drawing, `.tag` spring pop, panel cascade, calorie count-up, macro bar animation).
- Navigation continuity with `withViewTransitions()` in `app.config.ts` and shared `plate-hero` transition.

### Tier 2 — Final Polish (Tactile Polish & Micro-interactions)
- Batched staggering and smooth thumbnail/contour reveal in `history.ts` / `history.scss`.
- `.scan` luminous trail and `.steps` `check-pop` animation in `capture.scss`.
- Tactile `:active` spring polish across history cards, `.food` rows, `.plate-size__btn`, `.segmented`, and `.swatch` in `settings.scss`.
