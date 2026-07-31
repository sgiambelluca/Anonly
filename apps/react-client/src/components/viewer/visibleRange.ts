/**
 * `visibleRange.ts` — cómputo puro de rangos de páginas para el
 * `PageVirtualizer` (`ui/Components.md` §5.3, `architecture/07_Performance_Strategy.md`
 * §3: "solo renderiza las visibles + 1 antes + 1 después").
 *
 * Separado del componente React a propósito: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que la única forma
 * de testear esta lógica es extraerla de cualquier código que dependa del DOM
 * (IntersectionObserver, canvas, refs).
 */

import type { VisibleRange } from "../../store/viewer.store.js";

export type { VisibleRange };

/**
 * Reduce el conjunto de índices de página que el `IntersectionObserver` del
 * `PageVirtualizer` reporta como intersectando el viewport a un rango
 * contiguo `{ start, end }` (el mínimo y el máximo). `undefined` si el
 * conjunto está vacío (el llamador conserva el rango anterior en vez de
 * colapsar a un rango vacío/inválido).
 */
export function computeVisibleRangeFromIndices(
  visibleIndices: ReadonlySet<number> | ReadonlyArray<number>,
): VisibleRange | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const index of visibleIndices) {
    if (start === undefined || index < start) start = index;
    if (end === undefined || index > end) end = index;
  }
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

/**
 * Rango de páginas que efectivamente se montan con contenido real (canvas):
 * `visibleRange` ± 1 página, acotado a `[0, pageCount - 1]`
 * (`Components.md` §5.3, `07_Performance_Strategy.md` §3). Con `pageCount <= 0`
 * devuelve un rango vacío (`end < start`) — todavía no hay páginas que montar.
 */
export function computeMountRange(visibleRange: VisibleRange, pageCount: number): VisibleRange {
  if (pageCount <= 0) return { start: 0, end: -1 };
  const start = Math.max(0, visibleRange.start - 1);
  const end = Math.min(pageCount - 1, visibleRange.end + 1);
  if (end < start) return { start, end: start - 1 };
  return { start, end };
}

/** `{start, end}` → `[start, start+1, ..., end]`. `[]` si el rango está vacío (`end < start`). */
export function rangeToPageIndices(range: VisibleRange): ReadonlyArray<number> {
  if (range.end < range.start) return [];
  const indices: number[] = [];
  for (let i = range.start; i <= range.end; i += 1) {
    indices.push(i);
  }
  return indices;
}
