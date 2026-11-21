/**
 * `popoverShift.ts` — cuánto hay que correr un globo flotante en horizontal para
 * que quede entero dentro de la ventana. Puro: los tests corren en Node sin jsdom.
 */

/** Margen que se deja contra el borde de la ventana. */
export const POPOVER_WINDOW_MARGIN_PX = 8;

/**
 * Desplazamiento horizontal (px, positivo = a la derecha) que mete `[left, right]`
 * en `[margin, windowWidth - margin]`. Si no entra, gana el borde izquierdo.
 */
export function shiftIntoWindow(
  left: number,
  right: number,
  windowWidth: number,
  margin: number = POPOVER_WINDOW_MARGIN_PX,
): number {
  let shift = 0;
  if (right > windowWidth - margin) shift = windowWidth - margin - right;
  if (left + shift < margin) shift = margin - left;
  return shift;
}
