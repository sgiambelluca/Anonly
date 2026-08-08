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
 */
export const REPLACEMENT_FONT_HEIGHT_RATIO = 0.7;

/**
 * Avance medio de glifo como fracción del tamaño de fuente, para estimar
 * ancho sin canvas (ADR-057 §5).
 */
export const AVG_GLYPH_ADVANCE_RATIO = 0.6;

/**
 * Umbral del aviso de degradación (`AnnotationKind.Degraded`): se marca
 * cuando `tamañoEfectivo / tamañoNatural` cae por debajo de este valor. Es
 * una razón, no un tamaño en píxeles — invariante a la escala de render, así
 * que preview y export coinciden siempre sobre si hay que avisar (ADR-058 §7).
 */
export const DEGRADED_FONT_RATIO = 0.6;
