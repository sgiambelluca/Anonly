// ADR-219 §4 / ADR-220 §5: la clave de un valor bajo un tipo propio. Función
// pura y compartida porque la usan dos motores que no pueden importarse entre
// sí (`regex-engine` y `grouping-engine`), mismo argumento que
// `normalizeEntityValue`. No la reemplaza: ésa conserva la puntuación interna y
// sigue siendo la clave de los tipos base.

const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;
const NON_ALPHANUMERIC_RE = /[^\p{L}\p{N}]/gu;

/**
 * NFC, sin diacríticos, minúsculas y sin nada que no sea letra o dígito.
 * `"0170-0994 11"` -> `"0170099411"`.
 */
export function alphanumericKey(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(NON_ALPHANUMERIC_RE, "");
}
