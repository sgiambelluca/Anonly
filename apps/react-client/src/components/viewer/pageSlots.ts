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
  /**
   * Alto base de una fila sin franja (el `baseHeight` con el que se calculó).
   * Distingue un cambio de franjas de un cambio de zoom: el zoom cambia el alto
   * base, la marca `unreadableInk` no (`isStripOnlyChange`).
   */
  readonly baseHeight: number;
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
  return { offsets, heights, totalHeight: total, baseHeight };
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

/**
 * ¿La geometría cambió **solo** porque alguna página ganó o perdió su franja?
 * Es así cuando hay la misma cantidad de páginas, el mismo alto base y alguna
 * fila con otro alto. Un cambio de zoom (otro alto base) o de documento (otra
 * cantidad de páginas) no lo es, y no se ancla: conserva su comportamiento de
 * siempre.
 *
 * Se comparan los altos **fila por fila**, no el alto total: una franja que
 * aparece en una fila y desaparece en otra deja el total igual y mueve todo lo
 * que queda entre las dos.
 */
export function isStripOnlyChange(previous: PageSlots, next: PageSlots): boolean {
  return (
    previous.offsets.length === next.offsets.length &&
    previous.baseHeight === next.baseHeight &&
    previous.heights.some((height, index) => height !== next.heights[index])
  );
}

/**
 * Anclaje del scroll (ADR-190 §4, `ui/Components.md` §5.3). Cuando una página
 * gana o pierde su franja —en la práctica durante un `reanalyze` de OCR—, todo
 * lo que está debajo se desplaza. Para que el usuario siga viendo lo mismo, se
 * toma la fila visible de arriba **antes** del cambio, con su desplazamiento
 * dentro de la vista, y se devuelve el `scrollTop` que deja esa fila en el
 * mismo lugar con la geometría nueva.
 *
 * - Cambio arriba de la fila de arriba: el desplazamiento de esa fila cambia
 *   y hay corrección.
 * - Cambio en la propia fila de arriba (su franja va dentro de ella, sobre su
 *   imagen) o debajo: su desplazamiento no cambia y se devuelve `scrollTop`
 *   tal cual, sin corrección.
 * - Solo se ancla un cambio que causó la marca (`isStripOnlyChange`); si el
 *   cambio de `slots` viene del zoom o del documento, se devuelve `scrollTop`
 *   sin tocarlo.
 *
 * `scrollTop` es el de **antes** del cambio: si el contenido se achicó, el
 * navegador ya pudo recortarlo. `clientHeight` acota el resultado al máximo
 * que el navegador permite (`totalHeight - clientHeight`).
 */
export function anchorScrollTop(
  previous: PageSlots,
  next: PageSlots,
  scrollTop: number,
  clientHeight = 0,
): number {
  if (!isStripOnlyChange(previous, next)) return scrollTop;
  const anchor = slotIndexAtOffset(previous, scrollTop);
  const previousOffset = previous.offsets[anchor] ?? 0;
  const nextOffset = next.offsets[anchor] ?? 0;
  if (nextOffset === previousOffset) return scrollTop;
  const withinRow = scrollTop - previousOffset;
  const target = nextOffset + withinRow;
  const max = Math.max(0, next.totalHeight - clientHeight);
  return Math.min(max, Math.max(0, target));
}
