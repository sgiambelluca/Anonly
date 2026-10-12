/**
 * Extensión de los spans de `Address` hasta la altura que los sigue
 * (NER_Engine.md §13 caso 34, ADR-212).
 *
 * El modelo marca la calle y deja el número afuera («con domicilio en Maipú
 * 1434» da `Maipú`). Este paso, posterior al modelo, corre en el host sobre el
 * texto completo de la página y antes de mapear el span a palabras. Son
 * funciones puras: sin modelo, sin pool, sin estado.
 *
 * La regla es una sola: si inmediatamente después del span hay un número
 * candidato, el span se extiende hasta su último dígito. No se mira el contexto
 * ni el valor del número (un número con forma de año se suma igual).
 */
import { EntityType, normalizeEntityValue, type NerKernelSpan } from "@anonly/shared";

/*
 * ADR-212 punto 2 / caso 34 «Número candidato»: uno o dos espacios en blanco,
 * conector opcional (`N°`, `Nº`, `No.`, `nro`/`nro.`, `número`/`numero`, `al`)
 * con cero a dos espacios, y de uno a cinco dígitos. Después de los dígitos no
 * puede venir otro dígito, una barra, ni un punto, una coma o un guion
 * (`-`, U+2010, U+2011, U+2013, U+2014) seguidos de un dígito: eso es una
 * fecha, un importe o un rango. Sticky: solo prueba en `lastIndex`.
 */
const STREET_NUMBER_RE =
  /\s{1,2}(?:(?:N[°º]|No\.|nro\.?|n[úu]mero|al)\s{0,2})?(\d{1,5})(?!\d|\/|[.,\-‐‑–—]\d)/iy;

const DIGIT_RE = /\d/;

/**
 * Devuelve el fin (exclusivo, sobre `pageText`) que le corresponde a un span de
 * `Address` que ocupa `[startIndex, endIndexExclusive)`: el del último dígito de
 * la altura que lo sigue, o `endIndexExclusive` sin cambios si no hay número
 * candidato o si el span ya termina en dígitos (idempotencia, caso 34).
 */
export function extendAddressEnd(
  pageText: string,
  startIndex: number,
  endIndexExclusive: number,
): number {
  if (startIndex < 0 || startIndex >= endIndexExclusive || endIndexExclusive > pageText.length) {
    return endIndexExclusive;
  }
  // Idempotencia: un span que ya termina en dígitos no busca número.
  if (DIGIT_RE.test(pageText.charAt(endIndexExclusive - 1))) return endIndexExclusive;

  STREET_NUMBER_RE.lastIndex = endIndexExclusive;
  const match = STREET_NUMBER_RE.exec(pageText);
  if (match === null) return endIndexExclusive;
  return endIndexExclusive + match[0].length;
}

/**
 * Aplica `extendAddressEnd` a un span del kernel (offsets absolutos de la
 * página). Solo `Address` se toca; en el span extendido, `value` es el texto de
 * la página y `normalizedValue` se recalcula con `normalizeEntityValue`, la
 * misma normalización que usa el kernel. `confidence` y `startIndex` no
 * cambian. Sin extensión devuelve el mismo objeto.
 */
export function extendAddressSpan(span: NerKernelSpan, pageText: string): NerKernelSpan {
  if (span.entityType !== EntityType.Address) return span;
  const end = extendAddressEnd(pageText, span.startIndex, span.endIndexExclusive);
  if (end === span.endIndexExclusive) return span;
  const value = pageText.slice(span.startIndex, end);
  return {
    ...span,
    value,
    normalizedValue: normalizeEntityValue(value),
    endIndexExclusive: end,
  };
}
