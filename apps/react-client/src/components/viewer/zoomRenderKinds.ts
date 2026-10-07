/**
 * `zoomRenderKinds.ts` — a qué lados pide el render el emisor debounced de zoom
 * (ADR-213 §1, `ui/React_Client.md` §7 regla 1).
 *
 * Al terminar un zoom se actualizan los dos lados: primero el que se mira y
 * después el otro, así que al conmutar la imagen del otro lado ya está a la
 * escala del zoom. Es el único emisor que pide el lado que no se mira: el scroll,
 * `Ready` y el reintento siguen pidiendo solo el que se mira (ADR-056).
 *
 * **El lado anonimizado solo se pide si el toggle ya lo permite.** El toggle
 * «Anonimizado» está deshabilitado mientras `stage !== Ready`
 * (`React_Client.md` §7): antes de eso los `replacements` no existen y el render
 * sale idéntico al original, así que pedirlo sería trabajo sin destino. Cuando
 * llegue `Ready`, el cambio de vista pide ese lado a la escala del zoom igual.
 *
 * Lógica pura, mismo criterio que `readyRenderTrigger.ts`.
 */

import type { ViewerKind } from "../../store/viewer.store.js";

export interface ZoomRenderKindsParams {
  /** El `kind` que se mira ahora (`viewer.mode`). */
  readonly viewing: ViewerKind;
  /** El pipeline llegó a `Ready`: el lado anonimizado ya tiene sus reemplazos. */
  readonly anonymizedAvailable: boolean;
}

/** Los `kind` a pedir, en orden: primero el que se mira. */
export function kindsToRenderOnZoom(params: ZoomRenderKindsParams): ReadonlyArray<ViewerKind> {
  const { viewing, anonymizedAvailable } = params;
  const other: ViewerKind = viewing === "original" ? "anonymized" : "original";
  if (other === "anonymized" && !anonymizedAvailable) return [viewing];
  return [viewing, other];
}
