Plan Estratégico de Animación y Micro-interacciones — CaloriesCounter

Este plan define la arquitectura de Motion Design para dotar a CaloriesCounter de una respuesta física, orgánica y cohesiva digna de una aplicación nativa de gama alta, manteniendo un presupuesto estricto de 60–120 fps en dispositivos móviles (animando exclusivamente transform, opacity, filter y propiedades vectoriales SVG).

1. Físicas, Curvas de Aceleración y Profundidad Espacial
1.1. Sistema de Tokens de Movimiento con Físicas de Resorte (linear())

Actualmente el proyecto utiliza una única curva cubic-bezier(0.22, 1, 0.36, 1) repetida en más de 20 selectores (capture.scss, drawer.scss, result.scss, app.scss). Aunque es suave al desacelerar, carece de la inercia y elasticidad característica de los resortes físicos de iOS (CASpringAnimation).

Propuesta en _tokens.scss: Centralizar tres curvas físicas basadas en linear() (soportado en Chrome 113+, Safari 17.2+, Firefox 112+) con fallback cubic-bezier:
--ease-spring-sheet (Mass 1, Stiffness 280, Damping 28 — sub-amortiguado al 1.5%): Para grandes superficies como .drawer y .sheet. Aporta un asentamiento orgánico sin rebote exagerado.
--ease-spring-pop (Stiffness 380, Damping 22 — overshoot del 4%): Para micro-elementos emergentes como las etiquetas .tag sobre el plato, el check de pasos completados, el icono activo de .tabbar y los números de la cuenta regresiva.
--ease-out-quart (cubic-bezier(0.165, 0.84, 0.44, 1)): Para transiciones de salida y fundidos de opacidad.
1.2. Animaciones de Salida (Exit Transitions) en Drawer y Sheet

IMPORTANT

Tanto el menú lateral (drawer.ts) como la hoja de detalle nutricional (result.ts) tienen animación de entrada, pero desaparecen instantáneamente en 0ms al cerrarse porque el DOM se destruye o dialog.close() se ejecuta de forma síncrona.

Solución propuesta:
En Drawer y Result, añadir un estado transitorio closing (o usar CSS @starting-style + transition-behavior: allow-discrete en <dialog>) de 240ms con --ease-out-quart para que el panel se deslice suavemente hacia fuera (translateX(100%) / translateY(100%)) mientras el .scrim / ::backdrop desvanece su opacidad a 0.
1.3. Profundidad Tridimensional en Modales (Efecto Push-Back scale(0.96))
Propuesta en app.scss y result.ts:
Cuando body.menu-open (menú lateral abierto) o body.sheet-open (hoja de detalle de alimento abierta) estén activos, aplicar sobre <main> y .topbar:
transform: scale(0.96) translateY(4px);
border-radius: var(--radius-lg);
filter: brightness(0.92);
transform-origin: center top;
Este efecto de apilamiento espacial (layered sheet depth de iOS) indica visualmente que el contexto principal sigue vivo detrás del modal y retorna a scale(1) con física de resorte al cerrarlo.
2. Coreografía de Estado: De 'working' a 'result'

Actualmente, al pasar de Capture (mode() === 'working') a Result, la imagen vuelve a montarse desde cero y tanto los polígonos como toda la columna .results-panel (translateY(100%)) compiten al mismo tiempo en los primeros 350ms.

Proponemos una coreografía de descubrimiento IA en 4 tiempos que narra visualmente el proceso de análisis:

Fase 0 — Continuidad de la Foto (View Transitions API):
Activar withViewTransitions() en app.config.ts y asignar view-transition-name: plate-hero a .preview img y .photo img. La fotografía capturada se transforma sin parpadeo desde el contenedor de escaneo hasta la cabecera de resultados.
Fase 1 — Trazado Perimetral de Polígonos (AI Contour Drawing):
En result.ts añadir pathLength="1" a cada <polygon> y en result.scss animar stroke-dasharray: 1; stroke-dashoffset: 1 -> 0 durante 420ms seguido de la aparición del relleno verde translúcido (fill-opacity: 0 -> 1), escalonado por --i * 90ms. El usuario percibe que la IA está dibujando cada máscara sobre su plato en tiempo real.
Fase 2 — Conectores y Etiquetas Flotantes (.tag) con Resorte:
Retrasar la entrada de cada .tag a calc(var(--i, 0) * 0.09s + 0.24s) para que cada etiqueta brote con --ease-spring-pop (scale(0.75) -> scale(1)) justo cuando el trazo de su polígono se completa.
Fase 3 — Cascada de Tarjetas, Count-Up de Calorías y Barra de Macros:
Reemplazar el brusco translateY(100%) de .results-panel por una entrada escalonada (stagger) de sus bloques hijos (.advice, .summary, h2, .foods) con un desplazamiento corto (translateY(18px) -> 0).
Implementar un contador animado (count-up interpolado con requestAnimationFrame durante 550ms) para las calorías totales en result.ts, sincronizado con el crecimiento horizontal (scaleX(0) -> scaleX(1)) de los segmentos de macronutrientes en .split.
3. Micro-interacciones y Retroalimentación Táctil
3.1. Respuesta Táctil Unificada (:active con Física de Resorte)
Componente	Estado Actual	Mejora Propuesta
Tarjetas de Historial (.card.row, .card.text-only)	Sin :active ni transition (inertes al tacto).	transition: transform 0.2s var(--ease-spring-pop), border-color 0.2s, box-shadow 0.2s; y :active { transform: scale(0.975); }.
Filas de alimentos (.food)	scale(0.995) sin transition (imperceptible).	:active { transform: scale(0.975); } con desplazamiento de .chev (translateX(3px) en :hover/:active).
Selector de tamaño de plato (.plate-size__btn)	Cambio de color brusco sin transición.	Pulso táctil scale(0.93) al pulsar y transición suave de fondo/borde al recalcular porciones.
Controles segmentados (.segmented button)	Cambio instantáneo de fondo.	Añadir transición de fondo/sombra y compresión :active { transform: scale(0.96); }.
Swatches de color (.swatch)	Sin animación del check ✓.	Animar el span interno con transform: scale(0.4) -> scale(1) usando --ease-spring-pop al activarse.
3.2. Modernización del Escáner y Estados de Carga ('working')
Haz de Escaneo con Estela Luminosa (.scan):
Acompañar la línea de 3px con un pseudoelemento ::after de 48px de alto con gradiente vertical difuminado (linear-gradient(to bottom, color-mix(in srgb, var(--c-primary) 28%, transparent), transparent)) y respiración suave de la imagen (scale(1) <-> scale(1.02)), dando un acabado de visión por computador moderna.
Transición Elástica en los Pasos de Progreso (.steps):
Cuando un paso pasa de .active a .done, animar el círculo .dot y su marca ✓ con @keyframes check-pop (scale(0.5) -> scale(1.12) -> scale(1)) y añadir un pulso de halo (box-shadow expansivo) en el paso .active.
4. Cohesión de Navegación (Rutas e Historial)
Transiciones Espaciales entre Pestañas (withViewTransitions):
Al habilitar withViewTransitions() en app.config.ts, aislar .topbar y .tabbar con sus propios view-transition-name fijos (app-topbar, app-tabbar) para que las barras superior e inferior permanezcan inmóviles mientras únicamente el contenido de <main> realiza una transición cruzada limpia.
Efecto Cascada (Staggering) y Revelado de Miniaturas en Historial (history.ts / history.scss):
Asignar [style.--i]="$index % 10" a cada <li> en history.ts (usando módulo 10 para que al paginar con "Cargar más" los nuevos elementos también entren en cascada desde 0ms sin acumular retrasos largos).
Animar la entrada de cada tarjeta con slide-up-fade (calc(var(--i, 0) * 0.045s)) y hacer que la miniatura .thumb y su .thumb-overlay se revelen suavemente con opacity: 0 -> 1 cuando el evento (load) confirma las dimensiones de la imagen (size(log.id)).
5. Matriz de Priorización para Implementación
Nivel 1 — Impacto Alto (Core Experience & Wow Factor)
Tokens de físicas de resorte (linear()) en _tokens.scss + Animaciones de salida y profundidad 3D (scale(0.96)) en Drawer y Sheet.
Coreografía de 4 fases 'working' → 'result' en result.ts y result.scss: trazado vectorial de polígonos (stroke-dashoffset), brotado elástico de etiquetas .tag, cascada de paneles, count-up numérico de calorías y animación de barra de macros.
Continuidad de navegación con withViewTransitions() en app.config.ts y transición compartida de la foto del plato (plate-hero).
Nivel 2 — Toques Finales (Tactile Polish & Micro-interactions)
Cascada (Staggering) por lotes y revelado suave de miniaturas/contornos en history.ts y history.scss.
Estela luminosa del escáner .scan y animación check-pop en los pasos .steps dentro de capture.scss.
Refinamiento táctil (:active con resorte) en tarjetas de historial, filas de alimentos .food, selectores .plate-size__btn, controles .segmented y .swatch en settings.scss.