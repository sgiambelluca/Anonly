/**
 * Helpers de los tests del caso 34 (ADR-212): la extensión de `Address` es una
 * función pura sobre el texto de la página, así que se prueba directo, sin
 * modelo ni pool, y además de punta a punta por el motor.
 */
import { extendAddressEnd } from "../../address-extension.js";

/**
 * Texto que abarcaría el span `spanText` (la primera aparición en `pageText`)
 * después de la extensión: el span tal cual si no se extiende.
 */
export function extendedAddressText(pageText: string, spanText: string): string {
  const start = pageText.indexOf(spanText);
  if (start < 0) throw new Error(`El span "${spanText}" no está en el texto de prueba.`);
  const end = extendAddressEnd(pageText, start, start + spanText.length);
  return pageText.slice(start, end);
}
