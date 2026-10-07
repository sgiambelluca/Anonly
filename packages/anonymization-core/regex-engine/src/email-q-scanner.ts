import type { EmailMatchSpan } from "./email-scanner.js";

/*
 * Segunda búsqueda del email default (Regex_Engine.md §13 caso 35, ADR-211):
 * el email que el OCR leyó con la `@` convertida en una `Q` mayúscula, a veces
 * con un espacio después del punto del nombre (`contacto. estudioQexample.org`).
 *
 * Equivale, con la semántica de JavaScript (la más a la izquierda, codiciosa,
 * sin flags, `\b` ASCII), a la expresión de referencia del spec:
 *
 *   /\b(?:[a-z0-9._%+-]*[a-z0-9]\. ){0,2}[a-z0-9._%+-]*[a-z0-9]Q[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b/g
 *
 * La expresión queda como oráculo de los tests y no se ejecuta en producción.
 *
 * Por qué el escáner es lineal (mismo criterio que ADR-181): se ancla en cada
 * `Q` y nunca reintenta desde cada carácter del prefijo.
 *
 *  - Ni el nombre ni el dominio admiten mayúsculas, así que una `Q` corta toda
 *    corrida de caracteres de nombre y toda corrida de caracteres de dominio.
 *    Entre dos `Q` consecutivas hay a lo sumo una corrida de cada clase, y cada
 *    una se recorre una vez como cola de la `Q` de la izquierda y una vez como
 *    nombre de la `Q` de la derecha.
 *  - Los tramos «nombre, punto, un espacio» de la izquierda son corridas de
 *    caracteres de nombre separadas por exactamente un espacio, así que
 *    tampoco cruzan una `Q`: hacia la izquierda se miran como mucho tres
 *    corridas (la del nombre y dos tramos previos) y nunca se vuelve a recorrer
 *    lo que ya cubrió un recorrido anterior más de un número constante de veces.
 *  - Dado el inicio, el resto del match es determinista: un tramo de nombre
 *    llega hasta el final de su corrida, que tiene que ser el punto seguido del
 *    espacio (otro tramo) o la `Q`. Por eso para cada `Q` alcanza con elegir el
 *    menor inicio válido, y las `Q` se procesan de izquierda a derecha (un
 *    match de una `Q` posterior nunca empieza antes que el de una anterior,
 *    porque una corrida de nombre no contiene una `Q`).
 */

const DOT = 46;
const SPACE = 32;
const UPPERCASE_Q = "Q";

function isLowercaseLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLowercaseAlphanumeric(code: number): boolean {
  return isLowercaseLetter(code) || isDigit(code);
}

/** `[a-z0-9._%+-]`: los caracteres de un tramo de nombre. */
function isNameCharacter(code: number): boolean {
  return (
    isLowercaseAlphanumeric(code) ||
    code === DOT ||
    code === 95 ||
    code === 37 ||
    code === 43 ||
    code === 45
  );
}

/** `[a-z0-9.-]`: los caracteres de un dominio. */
function isDomainCharacter(code: number): boolean {
  return isLowercaseAlphanumeric(code) || code === DOT || code === 45;
}

/** `\w` de JavaScript sin flags `u`/`i`: `[A-Za-z0-9_]`. */
function isRegexWordCharacter(code: number): boolean {
  return (code >= 65 && code <= 90) || isLowercaseLetter(code) || isDigit(code) || code === 95;
}

function hasWordBoundary(text: string, index: number): boolean {
  const before = index > 0 ? text.charCodeAt(index - 1) : -1;
  const current = index < text.length ? text.charCodeAt(index) : -1;
  return isRegexWordCharacter(before) !== isRegexWordCharacter(current);
}

/**
 * Fin del match de la cola `Q[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b` para la `Q` en
 * `qIndex`, o `undefined` si no hay cola. Entre las terminaciones posibles
 * rige la más larga, que es la que elige el cuantificador codicioso.
 */
function findTailEnd(text: string, qIndex: number): number | undefined {
  if (!isLowercaseAlphanumeric(text.charCodeAt(qIndex + 1))) return undefined;

  let domainEnd = qIndex + 2;
  while (domainEnd < text.length && isDomainCharacter(text.charCodeAt(domainEnd))) domainEnd++;

  let longestEnd: number | undefined;
  for (let dotIndex = qIndex + 2; dotIndex < domainEnd; dotIndex++) {
    if (text.charCodeAt(dotIndex) !== DOT) continue;

    let suffixEnd = dotIndex + 1;
    while (suffixEnd < domainEnd && isLowercaseLetter(text.charCodeAt(suffixEnd))) suffixEnd++;
    if (suffixEnd - dotIndex - 1 < 2 || !hasWordBoundary(text, suffixEnd)) continue;
    if (longestEnd === undefined || suffixEnd > longestEnd) longestEnd = suffixEnd;
  }
  return longestEnd;
}

/** Inicio de la corrida maximal de caracteres de nombre que contiene `index`. */
function findNameRunStart(text: string, index: number): number {
  let start = index;
  while (start > 0 && isNameCharacter(text.charCodeAt(start - 1))) start--;
  return start;
}

/**
 * Si justo antes de `followingStart` hay un tramo «nombre, punto, un espacio»
 * (la corrida termina en letra o dígito, luego `.` y luego exactamente un
 * espacio), devuelve el inicio de la corrida de ese tramo; si no, `undefined`.
 * El tramo empieza donde empieza su corrida porque lo que lo precede en el
 * match es un espacio (otro tramo) o el límite de palabra del inicio.
 */
function findPreviousSegmentRunStart(text: string, followingStart: number): number | undefined {
  if (followingStart < 3) return undefined;
  if (text.charCodeAt(followingStart - 1) !== SPACE) return undefined;
  if (text.charCodeAt(followingStart - 2) !== DOT) return undefined;
  if (!isLowercaseAlphanumeric(text.charCodeAt(followingStart - 3))) return undefined;
  return findNameRunStart(text, followingStart - 2);
}

/** Menor índice de `[low, high]` con límite de palabra, o `undefined`. */
function findFirstWordBoundary(text: string, low: number, high: number): number | undefined {
  for (let index = low; index <= high; index++) {
    if (hasWordBoundary(text, index)) return index;
  }
  return undefined;
}

/**
 * Menor inicio válido (a partir de `lastIndex`) del match que usa la `Q` en
 * `qIndex`. Los tres casos —dos tramos previos, uno, ninguno— ocupan rangos
 * de inicio disjuntos y ordenados de izquierda a derecha; gana el primero que
 * tenga un inicio con límite de palabra.
 */
function findMatchStart(text: string, qIndex: number, lastIndex: number): number | undefined {
  const nameStart = findNameRunStart(text, qIndex - 1);
  const secondSegmentStart = findPreviousSegmentRunStart(text, nameStart);

  if (secondSegmentStart !== undefined) {
    const firstSegmentStart = findPreviousSegmentRunStart(text, secondSegmentStart);
    if (firstSegmentStart !== undefined) {
      const withTwoSegments = findFirstWordBoundary(
        text,
        Math.max(firstSegmentStart, lastIndex),
        secondSegmentStart - 3,
      );
      if (withTwoSegments !== undefined) return withTwoSegments;
    }
    const withOneSegment = findFirstWordBoundary(
      text,
      Math.max(secondSegmentStart, lastIndex),
      nameStart - 3,
    );
    if (withOneSegment !== undefined) return withOneSegment;
  }

  return findFirstWordBoundary(text, Math.max(nameStart, lastIndex), qIndex - 1);
}

/**
 * Spans `[startIndex, endIndexExclusive)` de la forma con `Q`, en orden y sin
 * superposición, como los daría la expresión de referencia con flag global.
 * Costo O(caracteres + coincidencias).
 */
export function scanEmailReadWithQ(text: string): ReadonlyArray<EmailMatchSpan> {
  const spans: EmailMatchSpan[] = [];
  let lastIndex = 0;
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const qIndex = text.indexOf(UPPERCASE_Q, searchIndex);
    if (qIndex < 0) break;
    searchIndex = qIndex + 1;

    if (qIndex === 0 || !isLowercaseAlphanumeric(text.charCodeAt(qIndex - 1))) continue;

    const endIndexExclusive = findTailEnd(text, qIndex);
    if (endIndexExclusive === undefined) continue;

    const startIndex = findMatchStart(text, qIndex, lastIndex);
    if (startIndex === undefined) continue;

    spans.push({ startIndex, endIndexExclusive });
    lastIndex = endIndexExclusive;
  }

  return spans;
}

/**
 * `normalizedValue` del email leído con `Q`: sin el espacio de cada «punto,
 * espacio» del grupo inicial, con la `@` en el lugar de la `Q` y en
 * minúsculas. `contacto. estudioQexample.org` → `contacto.estudio@example.org`.
 * El valor entra ya validado por `scanEmailReadWithQ`: tiene exactamente una
 * `Q` y ningún otro espacio.
 */
export function normalizeEmailReadWithQ(value: string): string {
  return value.replace(/\. /g, ".").replace(UPPERCASE_Q, "@").toLowerCase();
}
