/**
 * `dialogLayers.ts` — la pila de diálogos modales (`UX_Guidelines.md` §11b.17).
 *
 * Un diálogo abierto encima de otro tiene que desenfocar también al de abajo,
 * así que su fondo (velo con desenfoque) va **por encima** del contenido del
 * diálogo padre. Cada diálogo abierto toma la capa siguiente: el fondo y el
 * contenido suben de a 20, y los menús flotantes (`Select`, `Tooltip`) quedan
 * por encima de la pila entera y por debajo de los avisos (`z-[100]`).
 *
 * Puro: el estado de la pila vive en `Dialog.tsx`.
 */

/** Capas máximas apiladas; más profundo se reutiliza la última. */
export const MAX_DIALOG_LAYER = 2;

const OVERLAY_BASE = 40;
const CONTENT_BASE = 50;
const LAYER_STEP = 20;

export interface DialogZIndex {
  readonly overlay: number;
  readonly content: number;
}

/** La capa de un diálogo según cuántos hay abiertos debajo de él. */
export function dialogLayerFor(openBelow: number): number {
  return Math.max(0, Math.min(openBelow, MAX_DIALOG_LAYER));
}

export function dialogZIndex(layer: number): DialogZIndex {
  const clamped = dialogLayerFor(layer);
  return {
    overlay: OVERLAY_BASE + clamped * LAYER_STEP,
    content: CONTENT_BASE + clamped * LAYER_STEP,
  };
}
