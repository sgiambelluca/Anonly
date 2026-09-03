/**
 * @anonly/shared — Constantes nombradas de nivel de sistema.
 *
 * Fuente de verdad: docs/core/Contracts.md §6 ("Constantes nombradas").
 *
 * A diferencia de otras constantes documentadas en esa tabla
 * (`GROUPING_SIMILARITY_THRESHOLD`, `NER_CONFIDENCE_THRESHOLD`,
 * `CANCEL_SLA_MS`, `MAX_QUEUE_PER_POOL`, `PREVIEW_CACHE_PAGES`,
 * `WORDS_CACHE_PAGES`), que son valores default horneados directamente en
 * `packages/anonymization-core/src/config.ts` para campos de `EngineConfig`,
 * `MAX_RENDER_SCALE` y `PREVIEW_CACHE_MAX_BYTES` (ADR-037 §2/§3) NO son
 * campos de `RenderConfig` — el ADR decidió explícitamente no agregarlos a
 * una config total para evitar el churn de fixtures documentado en
 * ADR-035 §4. `render-engine` los consume directamente como guard/límite,
 * sin pasar por `EngineConfig`, por lo que necesitan existir como
 * constantes exportadas en runtime (no solo documentadas).
 *
 * Mismo criterio para `REPLACEMENT_FONT_HEIGHT_RATIO`, `AVG_GLYPH_ADVANCE_RATIO`
 * (ADR-057 §5) y `DEGRADED_FONT_RATIO` (ADR-058 §7): no son campos de
 * `RenderConfig` ni de `GroupingConfig` — `grouping-engine` y `render-engine`
 * las consumen directo (la primera pareja también respalda `estimateTokenWidth`,
 * ver `estimate-token-width.ts`).
 */

/**
 * Rango válido de `RenderRequested.scale` / `RenderPageInput.scale`:
 * `0 < scale <= MAX_RENDER_SCALE` (ADR-037 §2). Margen sobre el zoom máximo
 * de UI (3x) y protección de límites de canvas/memoria (A4 a 4x ≈ 32 MB RGBA).
 */
export const MAX_RENDER_SCALE = 4;

/**
 * Límite adicional por bytes del cache LRU de previews de `render-engine`,
 * además de `RenderConfig.cachePages` (ADR-037 §3).
 */
export const PREVIEW_CACHE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Fracción de `bbox.height` que el render usa como tamaño de fuente del
 * reemplazo. Deja de ser número mágico de `fontForMode` (ADR-057 §5).
 *
 * **Bajó de 0,7 a 0,64 en ADR-109 §4, y no cambió de significado**: cambió la
 * caja. Hasta ADR-109 `bbox.height` de una palabra de PDF era el **cuerpo**
 * de la fuente; desde ADR-109 es su **alto de tinta**, `(ascent + |descent|) ×
 * cuerpo`, que sobre el corpus relevado (10 documentos, 4266 items) vale
 * 1,101 pesado por items. `0,70 / 1,101 = 0,636` es entonces la recalibración
 * que deja todo igual a la vista: el token se dibuja del mismo tamaño y el
 * detector de degradación de ADR-086 mide contra la misma referencia, porque
 * el producto `ratio × height` se conserva.
 *
 * No es una decisión tipográfica. Si el token debería medir lo mismo que el
 * texto que lo rodea —hoy sale ~30 % más chico por construcción— sigue abierto
 * en `roadmap/Post_Hito10.8_Pendientes.md` §25.
 */
export const REPLACEMENT_FONT_HEIGHT_RATIO = 0.64;

/**
 * Avance medio de glifo como fracción del tamaño de fuente, para estimar
 * ancho sin canvas (ADR-057 §5).
 */
export const AVG_GLYPH_ADVANCE_RATIO = 0.6;

/**
 * Umbral del aviso de degradación (`AnnotationKind.Degraded`): se marca cuando
 *
 * ```
 * anchoDisponible / anchoNatural < DEGRADED_FONT_RATIO
 * ```
 *
 * donde `anchoNatural` es lo que el texto de reemplazo mediría a su tamaño de
 * referencia (`boxHeight × REPLACEMENT_FONT_HEIGHT_RATIO`). O sea: **cuánto más
 * angosto que su ancho natural quedó**.
 *
 * Sigue siendo una razón y no un tamaño en píxeles, que es el principio de
 * ADR-058 §7. Lo que cambió con **ADR-086** es qué razón: antes comparaba
 * `tamañoEfectivo / tamañoNatural`, o sea el encogido VERTICAL de la fuente, y
 * eso es exactamente la compresión que en una caja de cuerpo de texto no puede
 * ocurrir — los dos términos chocaban contra el piso de fuente mínima y el
 * cociente daba 1,00 por construcción. Lo que arruina la legibilidad es el
 * aplastado HORIZONTAL de `fillText(..., maxWidth)`, y es lo que ahora se mide.
 * (Las dos compresiones no son independientes: su producto se simplifica
 * exactamente a esta razón, porque el tamaño final se cancela.)
 *
 * **El valor bajó de 0,6 a 0,5 en el mismo cambio, y no es cosmético**: el 0,6
 * viejo medía otra magnitud. Aplicado a la razón de anchos marcaría
 * placeholders normales en cajas apretadas —`[PERSONA 01]` da 0,579— que se
 * renderizan perfectamente bien. Sobre-marcar erosiona la única señal que el
 * usuario tiene: una señal que aparece de más deja de ser señal (ADR-058 §7,
 * ADR-062 "Alternativas"). Ante la duda, no se marca.
 *
 * Invariante a la escala de render, ahora sí de forma **exacta** (ADR-086 §2):
 * el tamaño de referencia no tiene piso ni redondeo, y el piso de dibujo escala
 * con el render. Por eso el veredicto del preview vale para el PDF exportado.
 */
export const DEGRADED_FONT_RATIO = 0.5;
