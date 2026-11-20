// ADR-219 §3 / ADR-220 §5: la máscara de un valor bajo un tipo propio, o de una
// aparición de un formato propio bajo un tipo base. La usan `grouping-engine` y
// `regex-engine`, que no pueden importarse entre sí.

const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/gu;

/**
 * Cada letra o dígito pasa a `X` y el resto queda.
 * `"0170-0994 11"` -> `"XXXX-XXXX XX"`.
 */
export function maskByCharacters(value: string): string {
  return value.replace(LETTER_OR_DIGIT_RE, "X");
}
