/**
 * `WordSelectionOverlay` (`ui/Components.md` §5.4b, ADR-061 §3/§4 ruta B):
 * traduce un punto o arrastre en pantalla a un `BoundingBox` en coordenadas
 * de página, para pasarle a `wordsInRect`. Función pura — `apps/react-client`
 * corre sus tests en Node sin jsdom (mismo criterio que
 * `canvasDimensions.ts`/`currentPageIndex.ts`).
 */

import type { BoundingBox } from "@anonly/anonymization-core";

import type { ViewerKind } from "../../store/viewer.store.js";

/**
 * El hit-test solo se ofrece sobre el `original` (ADR-061 §3): en el
 * `anonymized` lo visible puede ser un reemplazo, y señalarlo no
 * significaría nada. Extraída para poder testearla sin renderizar
 * `PdfViewer` (sin jsdom).
 */
export function shouldShowWordSelectionOverlay(kind: ViewerKind): boolean {
  return kind === "original";
}

/** Tolerancia de click sin arrastre, en px CSS de pantalla (no de página). */
const CLICK_TOLERANCE_PX = 3;

export interface PointerSelectionInput {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  /** Tamaño en pantalla (CSS px) del canvas sobre el que se señaló. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Tamaño real de la página (puntos PDF, `getPageSize`). */
  readonly pageWidth: number;
  readonly pageHeight: number;
}

/**
 * Un click (sin arrastre perceptible) da un rect de ancho/alto cero, y
 * `wordsInRect` no matchea nada contra una región vacía (ADR-061 §4,
 * `wordsInRect` §10) — a propósito, para que una región vacía en cualquier
 * posición no matchee por accidente. Por eso un click se expande a un
 * cuadrado mínimo centrado en el punto, en vez de dejarlo en cero.
 */
export function pointerSelectionToPageRect(input: PointerSelectionInput): BoundingBox {
  const scaleX = input.pageWidth / input.displayWidth;
  const scaleY = input.pageHeight / input.displayHeight;

  const minX = Math.min(input.startX, input.endX);
  const maxX = Math.max(input.startX, input.endX);
  const minY = Math.min(input.startY, input.endY);
  const maxY = Math.max(input.startY, input.endY);

  const isClick = maxX - minX < CLICK_TOLERANCE_PX && maxY - minY < CLICK_TOLERANCE_PX;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const x = isClick ? centerX - CLICK_TOLERANCE_PX / 2 : minX;
  const y = isClick ? centerY - CLICK_TOLERANCE_PX / 2 : minY;
  const width = isClick ? CLICK_TOLERANCE_PX : maxX - minX;
  const height = isClick ? CLICK_TOLERANCE_PX : maxY - minY;

  return {
    x: x * scaleX,
    y: y * scaleY,
    width: width * scaleX,
    height: height * scaleY,
  };
}
