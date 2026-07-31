/**
 * `pageLayout.ts` — dimensiones de layout del visor virtualizado.
 *
 * `pageSize` (altura uniforme de fila usada por `PageVirtualizer` para
 * `pageCount × pageSize`, `Components.md` §5.3) no tiene un valor
 * documentado en los specs (no hay dimensiones de página reales expuestas al
 * cliente: `document.store` solo trae `id/name/pageCount/sourceKind`,
 * `React_Client.md` §3.1). Es una constante puramente de layout de UI, sin
 * correlato en el Core ni en `core/Contracts.md` — no requiere ADR porque no
 * es un contrato compartido, solo afecta la altura reservada por el
 * scroll virtual antes de que la imagen real llegue.
 */

/** Alto de referencia (px CSS) de una página a `zoom = 1`. */
export const BASE_PAGE_HEIGHT_PX = 800;

/** Relación de aspecto ancho/alto de A4 (`210mm / 297mm`), usada para el phantom antes de tener la imagen real. */
export const PAGE_ASPECT_RATIO = 210 / 297;

/** Alto de fila virtualizada a un `zoom` dado (`viewer.store.zoom`, 0.5..3). */
export function computePageHeight(zoom: number): number {
  return BASE_PAGE_HEIGHT_PX * zoom;
}

/** Ancho correspondiente a un alto de página, preservando `PAGE_ASPECT_RATIO`. */
export function computePageWidth(pageHeight: number): number {
  return pageHeight * PAGE_ASPECT_RATIO;
}
