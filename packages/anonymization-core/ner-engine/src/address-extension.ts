/**
 * Extensión de los spans de `Address` hasta la altura que los sigue
 * (NER_Engine.md §13 caso 34, ADR-212).
 *
 * El modelo marca la calle y deja el número afuera («con domicilio en Maipú
 * 1434» da `Maipú`). Este paso, posterior al modelo, corre en el host sobre el
 * texto completo de la página y antes de mapear el span a palabras. Son
 * funciones puras: sin modelo, sin pool, sin estado.
 *
 * Qué es una «palabra» (caso 34, precisado el 2026-10-07): un tramo del texto
 * de la página delimitado por espacios en blanco. Solo cuentan palabras
 * completas: el resto de un tramo donde el span empieza a mitad (`(Maipú`) no
 * es una palabra anterior, y la cola pegada a los dígitos (`1950,`) no es una
 * palabra posterior. Para comparar, a cada palabra y a cada entrada de las
 * listas se le recortan los bordes que no sean letra ni dígito, se pasa a
 * minúsculas y se le quitan las tildes (`normalizeEntityValue`, criterio de
 * ADR-061 §2).
 */
import { EntityType, normalizeEntityValue, type NerKernelSpan } from "@anonly/shared";

/*
 * ADR-212 punto 4: las ventanas y las listas de palabras de dirección son
 * parte de la decisión. Cambiar cualquiera de estas constantes es cambiar el
 * ADR (y el caso 34 del spec), no un ajuste de implementación.
 */

/** ADR-212 §4: «cerca» hacia atrás son las seis palabras anteriores al span. */
const ADDRESS_CUE_WINDOW_BEFORE = 6;
/** ADR-212 §4: «cerca» hacia adelante son las cuatro palabras posteriores al número. */
const ADDRESS_CUE_WINDOW_AFTER = 4;

/** ADR-212 §4, antes de la dirección o como primera palabra de ella. */
const ADDRESS_CUES_BEFORE: ReadonlySet<string> = new Set(
  [
    "domicilio",
    "domiciliado",
    "domiciliada",
    "domiciliados",
    "domiciliadas",
    "calle",
    "avenida",
    "av.",
    "avda.",
    "sito",
    "sita",
    "vive",
    "viven",
    "reside",
    "residen",
  ].map(normalizeEntityValue),
);

/** ADR-212 §4, después del número: palabras sueltas. */
const ADDRESS_CUES_AFTER: ReadonlySet<string> = new Set(
  ["piso", "departamento", "depto.", "dpto."].map(normalizeEntityValue),
);

/** ADR-212 §4, después del número: secuencias, que deben caber enteras en la ventana. */
const ADDRESS_CUE_SEQUENCES_AFTER: ReadonlyArray<ReadonlyArray<string>> = [
  ["de", "esta", "ciudad"].map(normalizeEntityValue),
  ["de", "la", "localidad"].map(normalizeEntityValue),
];

/** ADR-212 §2/§3: «parece un año» es un número de cuatro dígitos entre 1900 y 2099. */
const YEAR_LIKE_MIN = 1900;
const YEAR_LIKE_MAX = 2099;
const YEAR_LIKE_DIGITS = 4;

/*
 * ADR-212 §2 / caso 34 «Número candidato»: uno o dos espacios en blanco,
 * conector opcional (`N°`, `Nº`, `No.`, `nro`/`nro.`, `número`/`numero`, `al`)
 * con cero a dos espacios, y de uno a cinco dígitos. Después de los dígitos no
 * puede venir otro dígito, una barra, ni un punto, una coma o un guion
 * (`-`, U+2010, U+2011, U+2013, U+2014) seguidos de un dígito: eso es una
 * fecha, un importe o un rango. Sticky: solo prueba en `lastIndex`.
 */
const STREET_NUMBER_RE =
  /\s{1,2}(?:(?:N[°º]|No\.|nro\.?|n[úu]mero|al)\s{0,2})?(\d{1,5})(?!\d|\/|[.,\-‐‑–—]\d)/iy;

const WHITESPACE_RE = /\s/;
const DIGIT_RE = /\d/;

function isWhitespaceAt(text: string, index: number): boolean {
  return WHITESPACE_RE.test(text.charAt(index));
}

/** Índice del primer carácter que no es espacio en blanco, a partir de `from`. */
function skipWhitespaceForward(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWhitespaceAt(text, i)) i += 1;
  return i;
}

/** Índice del primer espacio en blanco (o del final), a partir de `from`. */
function skipWordForward(text: string, from: number): number {
  let i = from;
  while (i < text.length && !isWhitespaceAt(text, i)) i += 1;
  return i;
}

/**
 * Hasta `max` palabras completas posteriores a `from`, normalizadas. Si `from`
 * cae a mitad de un tramo, ese resto no es una palabra: la primera palabra es
 * el tramo siguiente.
 */
function wordsAfter(text: string, from: number, max: number): ReadonlyArray<string> {
  const words: string[] = [];
  let i = skipWordForward(text, from);
  while (words.length < max) {
    i = skipWhitespaceForward(text, i);
    if (i >= text.length) break;
    const end = skipWordForward(text, i);
    words.push(normalizeEntityValue(text.slice(i, end)));
    i = end;
  }
  return words;
}

/**
 * Hasta `max` palabras completas anteriores a `before`, normalizadas. Si
 * `before` cae a mitad de un tramo (`(Maipú`), el resto anterior del tramo no
 * cuenta. El resultado va de la más cercana a la más lejana.
 */
function wordsBefore(text: string, before: number, max: number): ReadonlyArray<string> {
  const words: string[] = [];
  let i = before;
  while (i > 0 && !isWhitespaceAt(text, i - 1)) i -= 1;
  while (words.length < max) {
    while (i > 0 && isWhitespaceAt(text, i - 1)) i -= 1;
    if (i === 0) break;
    const end = i;
    while (i > 0 && !isWhitespaceAt(text, i - 1)) i -= 1;
    words.push(normalizeEntityValue(text.slice(i, end)));
  }
  return words;
}

function looksLikeYear(digits: string): boolean {
  if (digits.length !== YEAR_LIKE_DIGITS) return false;
  const value = Number(digits);
  return value >= YEAR_LIKE_MIN && value <= YEAR_LIKE_MAX;
}

function hasCueBefore(text: string, startIndex: number, endIndexExclusive: number): boolean {
  const firstWordEnd = Math.min(skipWordForward(text, startIndex), endIndexExclusive);
  if (ADDRESS_CUES_BEFORE.has(normalizeEntityValue(text.slice(startIndex, firstWordEnd)))) {
    return true;
  }
  return wordsBefore(text, startIndex, ADDRESS_CUE_WINDOW_BEFORE).some((word) =>
    ADDRESS_CUES_BEFORE.has(word),
  );
}

function hasCueAfter(text: string, afterDigitsIndex: number): boolean {
  const words = wordsAfter(text, afterDigitsIndex, ADDRESS_CUE_WINDOW_AFTER);
  if (words.some((word) => ADDRESS_CUES_AFTER.has(word))) return true;
  return ADDRESS_CUE_SEQUENCES_AFTER.some((sequence) => {
    for (let offset = 0; offset + sequence.length <= words.length; offset++) {
      if (sequence.every((expected, i) => words[offset + i] === expected)) return true;
    }
    return false;
  });
}

/**
 * Devuelve el fin (exclusivo, sobre `pageText`) que le corresponde a un span de
 * `Address` que ocupa `[startIndex, endIndexExclusive)`: el del último dígito de
 * la altura que lo sigue, o `endIndexExclusive` sin cambios si no hay número
 * candidato, si ya termina en dígitos (idempotencia) o si el número parece un
 * año y no hay una palabra de dirección cerca (caso 34).
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
  const digits = match?.[1];
  if (match === null || digits === undefined) return endIndexExclusive;

  const afterDigits = endIndexExclusive + match[0].length;
  if (!looksLikeYear(digits)) return afterDigits;

  const hasCue =
    hasCueBefore(pageText, startIndex, endIndexExclusive) || hasCueAfter(pageText, afterDigits);
  return hasCue ? afterDigits : endIndexExclusive;
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
