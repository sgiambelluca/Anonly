/**
 * `originalImageGuard.ts` — bajo la pestaña Anonimizado nunca se muestra la imagen
 * original (enmienda del mantenedor a ADR-213, `ui/React_Client.md` §7 regla 4).
 *
 * `selectPageImage` (`kindSwitchHold.ts`) ya no elige la imagen original para esa vista.
 * Pero un canvas conserva sus píxeles hasta que el dibujo siguiente termina de cargar
 * (`PageCanvas` dibuja desde un `Image` asíncrono): al conmutar a Anonimizado, la original
 * que estaba pintada seguiría a la vista, ya bajo el rótulo nuevo, durante esos cuadros.
 * Esta regla dice cuándo hay que vaciar el canvas **en el mismo commit** del cambio, antes
 * de que el navegador pinte.
 *
 * Lógica pura, mismo criterio que `readyRenderTrigger.ts`: el cliente testea sin jsdom.
 */

import type { ViewerKind } from "../../store/viewer.store.js";

export interface OriginalImageGuardParams {
  /** El `kind` que se mira ahora (la pestaña seleccionada). */
  readonly viewing: ViewerKind;
  /** De qué lado era la última imagen que el canvas dibujó, o `null` si está vacío. */
  readonly painted: ViewerKind | null;
}

/** `true` si el canvas muestra una imagen original bajo la vista Anonimizado y hay que vaciarlo. */
export function mustClearOriginalImage(params: OriginalImageGuardParams): boolean {
  return params.viewing === "anonymized" && params.painted === "original";
}
