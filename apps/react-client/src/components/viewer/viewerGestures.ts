/**
 * `viewerGestures.ts` — cálculos puros del visor que ADR-169 §7/§9 agrega:
 * el zoom con pellizco / `Ctrl + rueda`, el separador entre páginas y el
 * recuadro de la selección persistente.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type { BoundingBox, Word } from "@anonly/anonymization-core";

import { MAX_ZOOM, MIN_ZOOM } from "../../store/viewer.store.js";

/**
 * Sensibilidad del zoom por rueda. El pellizco del trackpad llega como `wheel`
 * con `ctrlKey` y `deltaY` chicos (±1…±10 por evento, muchos eventos); una
 * rueda de mouse con `Ctrl` llega con ±100 por muesca. El factor exponencial
 * hace que los dos se sientan proporcionales, y el tope de `deltaY` evita que
 * una muesca salte medio zoom de golpe.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.004;
const WHEEL_DELTA_CAP = 50;

/**
 * ADR-169 §9: el zoom que corresponde a un `wheel` con `ctrlKey` — pellizco o
 * `Ctrl + rueda`. Hacia arriba (`deltaY < 0`) acerca. Dentro de los mismos
 * límites que los botones (`MIN_ZOOM`..`MAX_ZOOM`) y redondeado a centésimas
 * para que el porcentaje no muestre decimales.
 */
export function zoomFromWheel(zoom: number, deltaY: number): number {
  const delta = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, deltaY));
  const next = zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) * 100) / 100;
}

/**
 * ADR-169 §9: alto del separador entre páginas — un espacio con una línea
 * punteada y la etiqueta *"Página N de M"* centrada. Va arriba de cada página
 * y forma parte del paso del virtualizador (`pageStride`), así que toda la
 * aritmética de scroll (página actual, salto de la lupa) sigue siendo
 * `índice × paso`.
 */
export const PAGE_SEPARATOR_PX = 44;

/** El paso vertical entre el comienzo de una página y el de la siguiente. */
export function pageStride(pageHeight: number): number {
  return pageHeight + PAGE_SEPARATOR_PX;
}

/** La etiqueta del separador. */
export function describePageSeparator(pageIndex: number, pageCount: number): string {
  return `Página ${pageIndex + 1} de ${pageCount}`;
}

/**
 * El recuadro que envuelve las palabras de una selección, en coordenadas de
 * página: lo que la selección persistente dibuja con borde punteado
 * (ADR-169 §7). `null` sin palabras.
 */
export function wordsBoundingBox(words: ReadonlyArray<Word>): BoundingBox | null {
  if (words.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const word of words) {
    minX = Math.min(minX, word.bbox.x);
    minY = Math.min(minY, word.bbox.y);
    maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
    maxY = Math.max(maxY, word.bbox.y + word.bbox.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
