/**
 * `kindSwitchHold.ts` — qué imagen pinta una página del visor, y si espera, al
 * conmutar entre Original y Anonimizado (ADR-213 §3/§4,
 * `ui/React_Client.md` §7).
 *
 * **El problema.** Después de un zoom, la imagen guardada del otro lado puede
 * haber quedado a la escala anterior. Pintarla al conmutar la estira y se ve
 * borrosa. Con el pedido del emisor de cambio de vista llega la nítida, pero
 * recién unos 150 a 200 ms después. Mientras tanto la página sigue mostrando la
 * imagen del lado anterior (que es nítida a la escala del zoom, o es lo que había
 * en pantalla), y la cambia cuando llega la vigente. Decisión por página, con un
 * tope de `KIND_SWITCH_HOLD_MS`.
 *
 * Una página tiene **imagen vigente** de un `kind` si está en `previewByPage[kind]`
 * y su escala anotada (`previewScaleByPage[kind]`, ADR-213 §2) es la del zoom.
 *
 * Lógica pura, mismo criterio que `readyRenderTrigger.ts`: `apps/react-client`
 * corre sus tests en Node, sin jsdom.
 */

/** Tope de la espera, contado desde el cambio de vista (ADR-213 §4). */
export const KIND_SWITCH_HOLD_MS = 500;

/** Dos escalas se consideran la misma si difieren menos que el ruido del punto flotante. */
const SCALE_EPSILON = 1e-9;

export interface PageImageState {
  /** La imagen que el store tiene de esta página para ese `kind`, si hay. */
  readonly blobUrl: string | undefined;
  /** La escala a la que llegó (`previewScaleByPage`), si se la anotó. */
  readonly scale: number | undefined;
}

export interface SelectPageImageParams {
  /** La imagen del `kind` que se mira. */
  readonly own: PageImageState;
  /** La imagen del otro `kind` (la que la página venía mostrando). Su escala no importa. */
  readonly other: { readonly blobUrl: string | undefined };
  /** La escala del zoom vigente (`computeZoomRenderScale(zoom)`). */
  readonly expectedScale: number;
  /** `true` mientras no pasó `KIND_SWITCH_HOLD_MS` desde el último cambio de vista. */
  readonly holdActive: boolean;
  /** La página falló al renderizar (`failedPages`): no espera (ADR-213 §4). */
  readonly failed: boolean;
}

export interface PageImageChoice {
  /** La imagen a pintar, o `undefined` si no hay ninguna (skeleton). */
  readonly blobUrl: string | undefined;
  /** `true` si es la imagen del otro `kind` (la página está esperando a la vigente). */
  readonly fromOtherKind: boolean;
}

/** `true` si la imagen existe y llegó a la escala del zoom. */
export function isCurrentImage(image: PageImageState, expectedScale: number): boolean {
  return (
    image.blobUrl !== undefined &&
    image.scale !== undefined &&
    Math.abs(image.scale - expectedScale) < SCALE_EPSILON
  );
}

/**
 * Qué imagen pinta una página (ADR-213 §3/§4):
 *
 * 1. Si tiene imagen vigente del `kind` que se mira, esa.
 * 2. Si no, y mientras dura el tope, no falló y hay una imagen del otro `kind`:
 *    esa, hasta que llegue la vigente.
 * 3. Si no, lo de siempre: lo que haya del `kind` que se mira (puede ser nada).
 */
export function selectPageImage(params: SelectPageImageParams): PageImageChoice {
  const { own, other, expectedScale, holdActive, failed } = params;
  if (isCurrentImage(own, expectedScale)) return { blobUrl: own.blobUrl, fromOtherKind: false };
  if (holdActive && !failed && other.blobUrl !== undefined) {
    return { blobUrl: other.blobUrl, fromOtherKind: true };
  }
  return { blobUrl: own.blobUrl, fromOtherKind: false };
}
