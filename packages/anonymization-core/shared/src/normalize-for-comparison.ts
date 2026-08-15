// Normalización de comparación de texto libre (nombres, direcciones),
// promovida desde `grouping-engine/src/gender.ts` (ADR-061 §2, errata):
// única implementación existente, y otro motor igual de inalcanzable desde
// `regex-engine`. Verbatim: `trim()` y colapso de espacios incluidos a
// propósito para que `gender.ts` la consuma sin wrapper (ADR-061 §2 errata,
// punto 4).

// Rango Unicode "Combining Diacritical Marks" (U+0300–U+036F) en forma de
// escape explícito (no literal): un carácter combinante pegado en el código
// fuente es indistinguible a simple vista de texto normal y frágil frente a
// cualquier re-normalización del archivo por el editor/herramientas.
const COMBINING_DIACRITICS_RE = /[\u0300-\u036f]/g;

export function normalizeForComparison(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .trim()
    .replace(/\s+/g, " ");
}
