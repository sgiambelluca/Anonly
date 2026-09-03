// ADR-127: el predicado de solapamiento 2D del Core, en un solo lugar.
//
// Estaba escrito dos veces —`intersects`, privada de `words-in-rect.ts`, y
// `overlapsBbox` en el kernel de `render-engine`— con la misma AABB y una
// diferencia: solo la de `shared` guardaba el área cero. Vive acá por la misma
// razón y con el mismo precedente que `sharesVerticalBand` y
// `normalizeForComparison` (ADR-061 §2 errata): un motor no puede importar a
// otro (P-1/P-2), así que la única salida legal para compartir una primitiva
// es este paquete.
//
// NO reemplaza a `sharesVerticalBand`, que mira solo el eje Y: son dos
// preguntas distintas y tienen que poder responder distinto (ADR-127 §3).

import type { BoundingBox } from "./types.js";

/**
 * `true` si los dos rectángulos comparten área.
 *
 * **Estricto**: tocarse por el borde exacto no cuenta (mismo criterio que
 * `sharesVerticalBand`). Un rectángulo **sin área no se solapa con nada** —
 * es la respuesta correcta, y es la que `render-engine` daba distinta antes de
 * ADR-127.
 */
export function rectsOverlap(a: BoundingBox, b: BoundingBox): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
