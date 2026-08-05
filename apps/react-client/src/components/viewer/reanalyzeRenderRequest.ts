/**
 * `reanalyzeRenderRequest.ts` — composición pura del pedido de render que
 * `SettingsDialog` emite tras un `reanalyze` (`adr/ADR-056-RenderRequested-Kind-Por-Panel.md`
 * §3).
 *
 * Unión de los dos rangos visibles por panel (ADR-054 §1: con scroll
 * independiente son dos regiones distintas, no una) expandida a índices de
 * página, con `kind: "anonymized"` fijo: el `original` se renderiza sin
 * `replacements` y —hasta que exista el highlight de entidades— sin
 * `annotations`, así que un reanalyze no puede cambiar un solo píxel de ese
 * lado (ADR-056, Contexto §4). Refrescarlo sería trabajo garantizado-inútil.
 * `kind` queda tipado como el literal `"anonymized"`, no `string`, para que
 * el tipo documente esa decisión en sí mismo.
 *
 * Función pura separada del componente por el mismo criterio que
 * `canvasDimensions.ts`: los tests de `apps/react-client` corren sin jsdom
 * (`environment: "node"` en `vitest.config.ts`), así que `SettingsDialog` no
 * se puede montar con React Testing Library para ejercitar esta lógica —
 * hay que extraerla a una función que no dependa del DOM.
 */

import { rangeToPageIndices, unionVisibleRange, type VisibleRange } from "./visibleRange.js";

export interface ReanalyzeRenderRequest {
  readonly pageIndices: ReadonlyArray<number>;
  readonly kind: "anonymized";
}

/**
 * Compone el pedido de render de un reanalyze a partir de los `VisibleRange`
 * vigentes de los dos paneles: une los rangos (`unionVisibleRange`), los
 * expande a índices de página (`rangeToPageIndices`) y fija `kind:
 * "anonymized"` (ADR-056 §3).
 */
export function computeReanalyzeRenderRequest(
  original: VisibleRange,
  anonymized: VisibleRange,
): ReanalyzeRenderRequest {
  return {
    pageIndices: unionVisibleRange(original, anonymized).flatMap(rangeToPageIndices),
    kind: "anonymized",
  };
}
