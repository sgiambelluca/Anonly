/**
 * `currentPageIndex.ts` — deriva la página actual de un panel a partir de la
 * geometría de su scroll, no del `IntersectionObserver` (ADR-054 §5,
 * `ui/React_Client.md` §3.5, `ui/Components.md` §5.3).
 *
 * El mínimo del conjunto que reporta el `IntersectionObserver`
 * (`computeVisibleRangeFromIndices`, `visibleRange.ts`) podía quedar
 * transitoriamente no contiguo y colapsar a `start: 0`, mandando el visor a
 * la página 1 (Contexto §2 de ADR-054). La página actual se calcula en
 * cambio como la página que ocupa el **centro** del viewport visible,
 * directamente de `scrollTop`/`clientHeight` y de la geometría de las filas
 * (`pageSlots.ts`: las filas con franja de `unreadableInk` son más altas que
 * las demás, así que ya no alcanza con `scrollTop / pageSize`) — sin
 * observador, sin `Set`, determinista.
 *
 * Separado del componente React a propósito, mismo criterio que
 * `visibleRange.ts`/`zoomRenderScheduler.ts`: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom).
 */

import { slotIndexAtOffset, type PageSlots } from "./pageSlots.js";

export interface CurrentPageIndexParams {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly slots: PageSlots;
}

/**
 * Índice (0-based) de la página que ocupa el centro del viewport.
 *
 * Cerca del final del documento el navegador recorta `scrollTop` contra
 * `scrollHeight - clientHeight`: dividir directamente `scrollTop / pageSize`
 * ahí da un índice menor al de la página realmente centrada en el viewport
 * (`clientHeight / 2` de margen que la división directa ignora) — por eso se
 * usa el centro del viewport, no su borde superior, y el resultado se
 * clampea a `[0, pageCount - 1]` por si el centro cae más allá de la última
 * fila.
 *
 * `0` (defensivo) si no hay filas todavía o su alto total no es positivo: no
 * hay páginas, o el layout no está listo.
 */
export function computeCurrentPageIndexFromScroll(params: CurrentPageIndexParams): number {
  const { scrollTop, clientHeight, slots } = params;
  return slotIndexAtOffset(slots, scrollTop + clientHeight / 2);
}
