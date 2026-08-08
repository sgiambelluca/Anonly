/**
 * @anonly/shared — Estimación de ancho de token de la escalera de
 * abreviaturas del `placeholder`.
 *
 * Fuente de verdad: docs/core/Contracts.md §6,
 * docs/adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md §5.
 *
 * Pura y determinista: sin canvas, sin `measureText`. La usan dos motores
 * que no pueden importarse entre sí (P-1) pero sí importar `shared`:
 * `grouping-engine`, para elegir el nivel de abreviatura del `placeholder`
 * por grupo, y `render-engine`, como punto de partida de su medición real
 * con `measureText`. No se duplica en ninguno de los dos (ADR-057 §5).
 */

import { AVG_GLYPH_ADVANCE_RATIO, REPLACEMENT_FONT_HEIGHT_RATIO } from "./constants.js";

/**
 * Ancho estimado de un token de `charCount` caracteres dentro de una caja de
 * altura `boxHeight`, sin canvas (ADR-057 §5):
 *
 * - tamaño de fuente estimado = `boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO`
 * - avance medio de glifo = tamaño de fuente * `AVG_GLYPH_ADVANCE_RATIO`
 * - ancho del token = `charCount` * avance medio de glifo
 *
 * Determinista (aritmética pura, sin estado retenido) y monótona no
 * decreciente tanto en `charCount` como en `boxHeight`: el criterio de
 * "¿cabe?" compara este valor contra `bbox.width`, y las dos magnitudes
 * salen del mismo bbox, así que la razón width/height es invariante a la
 * escala a la que se renderice después (ADR-057 §5).
 */
export function estimateTokenWidth(charCount: number, boxHeight: number): number {
  const estimatedFontSize = boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO;
  const avgGlyphAdvance = estimatedFontSize * AVG_GLYPH_ADVANCE_RATIO;
  return charCount * avgGlyphAdvance;
}
