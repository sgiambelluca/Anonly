/**
 * `visibleRange.ts` — cómputo puro de rangos de páginas para el
 * `PageVirtualizer` (`ui/Components.md` §5.3, `architecture/07_Performance_Strategy.md`
 * §3: "solo renderiza las visibles + 1 antes + 1 después").
 *
 * Separado del componente React a propósito: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que la única forma
 * de testear esta lógica es extraerla de cualquier código que dependa del DOM
 * (IntersectionObserver, canvas, refs).
 *
 * **Alcance tras ADR-054 §5/§6**: `computeVisibleRangeFromIndices` (min..max
 * sobre lo que reporta el `IntersectionObserver`) decide **únicamente** el
 * rango de montaje (`computeMountRange`) — qué páginas reciben contenido
 * real. Ya **no** se usa para derivar la página actual del visor: eso vive en
 * `currentPageIndex.ts`, calculado por geometría de scroll (la página que
 * ocupa el centro del viewport). Un conjunto transitoriamente no contiguo acá
 * solo hace que se monte una página de más — inofensivo. Usarlo para la
 * página actual era justamente lo que colapsaba el rango a `start: 0` y
 * mandaba los dos visores al principio (el bug que ADR-054 cierra por
 * eliminación del mecanismo compartido, no por endurecer este cómputo).
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

/**
 * Une dos rangos visibles en la menor cantidad de rangos contiguos que los
 * cubre: un solo rango fusionado si se solapan o son adyacentes (sin brecha
 * entre ellos), o los dos por separado si hay una brecha. Con `visibleRange`
 * por panel (ADR-054 §1), `SettingsDialog` ya no puede re-pedir previews
 * sobre un único rango global: usa esta unión para cubrir las dos regiones
 * que el usuario está viendo (`React_Client.md` §3.7, último párrafo) **sin**
 * incluir las páginas intermedias que ningún panel mira — forzar los dos
 * rangos a un único `{min start, max end}` pediría renders de esas páginas
 * intermedias cuando los paneles están scrolleados a regiones lejanas del
 * documento.
 */
export function unionVisibleRange(a: VisibleRange, b: VisibleRange): ReadonlyArray<VisibleRange> {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  if (second.start <= first.end + 1) {
    return [{ start: first.start, end: Math.max(first.end, second.end) }];
  }
  return [first, second];
}
