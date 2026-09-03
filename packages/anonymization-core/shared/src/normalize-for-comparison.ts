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

/*
 * ADR-115 §1: la puntuación pegada a un valor no es parte del valor.
 *
 * Se recorta todo lo que no sea letra ni dígito en los **bordes** — no adentro:
 * `A.C.` conserva sus puntos internos y `20-12345678-9` no se toca, que es lo
 * que un abreviado o un identificador necesitan.
 */
const EDGE_NON_WORD_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * ADR-115 §1 — la normalización de `Occurrence.normalizedValue`, que es la
 * **clave con la que `grouping-engine` agrupa**.
 *
 * Es `normalizeForComparison` más el recorte de los bordes. Existe separada
 * porque `normalizeForComparison` es además la normalización de las claves del
 * léxico de género (ADR-060 §4), donde el script de build y el lookup de
 * runtime **tienen que coincidir carácter a carácter**: meterle el recorte ahí
 * haría que las dos definiciones divergieran por un cambio que al léxico no le
 * sirve de nada (sus claves son nombres, sin puntuación en los bordes).
 *
 * Por qué hace falta: el mismo apellido impreso llega con la puntuación que le
 * tocó al lado —`SUAREZ,` en el sello, `“SUAREZ,` en la carátula del cuerpo,
 * `Suarez.` al final de una oración—, y `Word.text` la trae pegada porque la
 * palabra es la unidad más fina que existe (ADR-089 §3). Sin el recorte, las
 * claves salen `suarez,`, `“suarez,` y `suarez.`, y el pase difuso de
 * `findMatchingGroup` no las alcanza: contra `suarez` dan **0,857 y 0,750**,
 * por debajo del umbral de 0,88. Medido sobre un expediente escaneado: un solo
 * apellido agregado a mano producía **cuatro** grupos en vez de uno.
 */
export function normalizeEntityValue(value: string): string {
  return normalizeForComparison(value).replace(EDGE_NON_WORD_RE, "");
}
