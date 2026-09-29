/**
 * `pageSlots.ts` — geometría vertical del visor cuando las filas no miden lo
 * mismo (ADR-190 §4, `ui/Components.md` §5.3/§5.4).
 *
 * Antes toda fila medía `pageStride(pageHeight)` y el scroll era
 * `índice × paso`. Una página marcada con `unreadableInk` reserva además una
 * franja de aviso de alto fijo justo arriba de su imagen
 * (`UNREADABLE_STRIP_PX`), así que las filas dejan de ser uniformes: el
 * desplazamiento de una página es la suma de las filas anteriores.
 *
 * **La franja depende únicamente de la marca `unreadableInk`, nunca de si la
 * página tiene entidades**: el texto aparece y desaparece dentro de una
 * ranura ya reservada (UX-10). La marca solo cambia con un `reanalyze` de OCR
 * o un documento nuevo, y ahí el layout se recalcula de todos modos.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

/**
 * Alto (px CSS) de la franja de aviso. Fijo — no escala con el zoom — y
 * dimensionado para que el texto (3 líneas de `text-xs` como máximo, a
 * `MIN_ZOOM` donde la página mide ~283 px de ancho) entre sin recortarse.
 */
export const UNREADABLE_STRIP_PX = 72;

export interface PageSlots {
  /** `offsets[i]`: distancia desde el borde superior del scroll al comienzo de la fila `i`. */
  readonly offsets: ReadonlyArray<number>;
  /** `heights[i]`: alto de la fila `i` (paso base + franja si la tiene). */
  readonly heights: ReadonlyArray<number>;
  /** Alto total del contenido con scroll: suma de todas las filas. */
  readonly totalHeight: number;
}

export interface ComputePageSlotsParams {
  readonly pageCount: number;
  /** Alto base de una fila sin franja (`pageStride(pageHeight)`: página + separador). */
  readonly baseHeight: number;
  /** Páginas con franja reservada: las marcadas `unreadableInk`. */
  readonly stripPages: ReadonlySet<number>;
}

export function computePageSlots(params: ComputePageSlotsParams): PageSlots {
  const { pageCount, baseHeight, stripPages } = params;
  const count = Math.max(0, Math.floor(pageCount));
  const offsets: number[] = [];
  const heights: number[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const height = baseHeight + (stripPages.has(index) ? UNREADABLE_STRIP_PX : 0);
    offsets.push(total);
    heights.push(height);
    total += height;
  }
  return { offsets, heights, totalHeight: total };
}

/**
 * Índice de la fila que contiene la coordenada `y` del contenido con scroll
 * (búsqueda binaria: el último `offsets[i] ≤ y`), acotado a `[0, pageCount - 1]`.
 * `0` si no hay filas o su alto total no es positivo (layout no listo).
 */
export function slotIndexAtOffset(slots: PageSlots, y: number): number {
  const count = slots.offsets.length;
  if (count === 0 || slots.totalHeight <= 0) return 0;
  if (y <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((slots.offsets[middle] ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** `scrollTop` que deja una página al comienzo del viewport (`0` si el índice no existe). */
export function scrollTopForPage(slots: PageSlots, pageIndex: number): number {
  return slots.offsets[pageIndex] ?? 0;
}
