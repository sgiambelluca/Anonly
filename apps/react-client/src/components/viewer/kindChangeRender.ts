/**
 * `kindChangeRender.ts` — decide si `PdfViewer` debe pedir el render del rango
 * montado porque el usuario conmutó el toggle `Original | Anonimizado`.
 *
 * **El defecto que cierra.** `ui/React_Client.md` §7 ya decía que conmutar el
 * toggle emite un `RENDER_REQUESTED` del nuevo `kind`, pero `PdfViewer` solo
 * pedía por `Ready`, por rango montado y por zoom. Con una imagen cacheada del
 * otro lado tampoco lo cubría el reintento de `previewRetry.ts` (pide solo las
 * páginas SIN imagen). Resultado: después de un zoom, al conmutar se veía la
 * imagen vieja del otro lado, a la escala anterior y estirada por CSS, hasta el
 * próximo zoom o scroll.
 *
 * Este es el **cuarto** emisor de `PdfViewer`. No se dispara en el montaje
 * inicial (`previousKind === null`: lo cubren los otros emisores) ni cuando no
 * hay páginas montadas. Tampoco cuando el `kind` no cambió, que es lo que hace
 * inofensiva la segunda pasada de los efectos en StrictMode.
 *
 * Lógica separada de React/DOM a propósito, mismo criterio que
 * `readyRenderTrigger.ts`: `apps/react-client` corre sus tests en Node, sin
 * jsdom.
 */

import type { ViewerKind } from "../../store/viewer.store.js";

export interface KindChangeRenderParams {
  /** El `kind` del render anterior de `PdfViewer`, o `null` en el montaje inicial. */
  readonly previousKind: ViewerKind | null;
  readonly kind: ViewerKind;
  readonly mountedPageIndicesCount: number;
}

/**
 * `true` si hubo un cambio real de `kind` (no el montaje inicial) y hay páginas
 * montadas para pedir.
 */
export function shouldRenderOnKindChange(params: KindChangeRenderParams): boolean {
  const { previousKind, kind, mountedPageIndicesCount } = params;
  if (previousKind === null) return false;
  if (previousKind === kind) return false;
  if (mountedPageIndicesCount === 0) return false;
  return true;
}
