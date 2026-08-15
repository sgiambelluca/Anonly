// La definición de "misma línea" del producto (ADR-061 §2, errata):
// promovida desde el façade (`src/line-words.ts`) y de-dup de una segunda
// copia en `render-engine/src/worker/kernel.ts`. Ninguno de los dos motores
// puede importarse entre sí ni al façade, así que el criterio vive acá.

import type { BoundingBox } from "./types.js";

/**
 * Dos bboxes "comparten banda vertical" cuando sus extensiones en Y se
 * solapan — el criterio geométrico estándar de overlap de intervalos, sin
 * umbral de proporción: cualquier solapamiento cuenta como misma línea.
 */
export function sharesVerticalBand(a: BoundingBox, b: BoundingBox): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}
