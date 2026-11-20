/**
 * @anonly/regex-engine — Guarda de corrida (ADR-075 §2).
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, «Semántica de la guarda de
 * corrida». Se aplica a todo match de `process`, venga de un patrón base o de
 * un formato del generador, y a `testFormat`: una sola definición para las
 * tres entradas.
 */

const RUN_ALNUM_RE = /[\p{L}\p{N}]/u;
const RUN_SEPARATOR_RE = /[-./]/;
const HAS_LETTER_RE = /\p{L}/u;

function isRunChar(ch: string | undefined): boolean {
  return ch !== undefined && RUN_ALNUM_RE.test(ch);
}

/*
 * ADR-075 §2: extiende [startIndex, endIndexExclusive) hacia los dos lados,
 * a través de [\p{L}\p{N}] y de los tres separadores internos de número -, /
 * y . — un separador solo extiende la corrida si el carácter que sigue del
 * lado hacia el que se expande es alfanumérico (si no, es un borde de
 * puntuación de oración, no una continuación del identificador). Nunca mira
 * dentro de [startIndex, endIndexExclusive): un match con espacios internos
 * (phone-mobile-ar, "11 4567 8900") sigue expandiéndose solo desde sus bordes.
 */
function computeRunBounds(
  text: string,
  startIndex: number,
  endIndexExclusive: number,
): { readonly start: number; readonly end: number } {
  let start = startIndex;
  for (;;) {
    if (isRunChar(text[start - 1])) {
      start -= 1;
      continue;
    }
    if (RUN_SEPARATOR_RE.test(text[start - 1] ?? "") && isRunChar(text[start - 2])) {
      start -= 1;
      continue;
    }
    break;
  }

  let end = endIndexExclusive;
  for (;;) {
    if (isRunChar(text[end])) {
      end += 1;
      continue;
    }
    if (RUN_SEPARATOR_RE.test(text[end] ?? "") && isRunChar(text[end + 1])) {
      end += 1;
      continue;
    }
    break;
  }

  return { start, end };
}

/*
 * ADR-075 §2/§4: `true` si el match hay que conservarlo. Se descarta cuando
 * el match no tiene ninguna letra pero su corrida sí — es un tramo de un
 * identificador más largo (número de expediente, folio, etc.), no la entidad
 * que su tipo declara. La condición de aplicabilidad ("el match no tiene
 * letras") hace que la guarda se ignore sola en License/Plate/IBAN/Email —
 * esos matches siempre llevan letras — sin ninguna lista de tipos en el
 * código. Se aplica también a los formatos del generador (ADR-220 §2): es una
 * propiedad del texto, no del patrón que lo encontró.
 *
 * `rawValue` ya viene sin el espacio de borde (v1.6.2): que la guarda mida
 * sobre el match sin espacio sigue siendo necesario —si no, la corrida se
 * mide contra el carácter que está ANTES del espacio y se extiende hasta una
 * palabra con letras, descartando un teléfono real.
 */
export function passesRunGuard(
  text: string,
  startIndex: number,
  endIndexExclusive: number,
  rawValue: string,
): boolean {
  if (HAS_LETTER_RE.test(rawValue)) return true;
  const { start, end } = computeRunBounds(text, startIndex, endIndexExclusive);
  return !HAS_LETTER_RE.test(text.slice(start, end));
}
