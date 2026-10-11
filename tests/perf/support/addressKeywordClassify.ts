/**
 * M-D2: la clasificación pura de una página de prueba a partir de lo que la aplicación dejó después del
 * análisis. Sin Electron, sin disco: recibe el texto de la página tal como lo extrajo la app y todas las
 * ocurrencias de esa página, de cualquier tipo, y dice, para cada parte de la oración (vía, nombre,
 * altura, resto), si quedó cubierta entera, en parte o nada por una ocurrencia de tipo dirección, por una
 * de otro tipo (y cuál) y por cualquiera de las dos.
 *
 * Posiciones: todo se calcula sobre el texto de la página (`Page.text` es `words.map(w => w.text).join(" ")`).
 * Una ocurrencia se ubica por sus índices de palabra (`wordSpan`) cuando el tramo coincide con su `value`;
 * si no, por su `value` dentro de la página, desde el comienzo de la oración; si tampoco, por los índices
 * sin verificar, y si no hay nada queda sin ubicar y se cuenta aparte. Una ocurrencia sin ubicar no puede
 * decir si toca la oración: se informa su cantidad y no entra en ninguna cobertura.
 *
 * Una cobertura mira solo los caracteres que no son espacio: dos ocurrencias contiguas separadas por un
 * espacio cubren entera la parte que abarcan entre las dos.
 */

import {
  wordSpanToChars,
  type LocatedOccurrence,
  type ObservedOccurrence,
} from "./addressHeightClassify.js";
import {
  expectedKeywordPageText,
  presentParts,
  type KeywordCategory,
  type KeywordPage,
  type KeywordPartName,
  type KeywordScript,
} from "./addressKeywordSentences.js";

const ADDRESS_TYPE = "ADDRESS";

export type Coverage = "full" | "partial" | "none";

export interface KeywordPartRecord {
  readonly part: KeywordPartName;
  /** La parte tal como aparece en la oración de la página. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Cubierta por ocurrencias de tipo dirección. */
  readonly address: Coverage;
  /** Cubierta por ocurrencias de cualquier otro tipo. */
  readonly other: Coverage;
  /** Los tipos de las ocurrencias que no son dirección y se superponen con la parte. */
  readonly otherTypes: ReadonlyArray<string>;
  /** Cubierta por la unión de todas las ocurrencias, de cualquier tipo. */
  readonly any: Coverage;
}

/** Una ocurrencia que toca la oración. */
export interface TouchingOccurrence {
  readonly entityType: string;
  readonly value: string;
  readonly source: string;
  readonly confidence: number | null;
  readonly start: number;
  readonly end: number;
  readonly locatedBy: LocatedOccurrence["locatedBy"];
  /**
   * Se ubicó por su valor y ese valor aparece más de una vez en la oración (por ejemplo un «.»): la posición
   * es la de la primera aparición y puede no ser la de la ocurrencia.
   */
  readonly ambiguous: boolean;
  /**
   * Quedó en algún grupo después del agrupado, o sea que se pinta. `false`: el agrupador la descartó (por
   * identidad con otra, o por estar contenida en otra, ADR-117). Ausente si la corrida no lo observó.
   */
  readonly survives?: boolean;
}

export interface KeywordPageRecord {
  readonly id: string;
  readonly baseId: string;
  readonly category: KeywordCategory;
  readonly script: KeywordScript;
  /** La oración de la página, ya en su escritura. */
  readonly text: string;
  /** El texto de la página tal como lo extrajo la aplicación. */
  readonly pageText: string;
  /** `false` si el texto extraído difiere del escrito: la página no entra a ningún total. */
  readonly valid: boolean;
  readonly invalidReason: string | null;
  /** Las partes presentes de la oración, en orden. Vacío en K8 y en una página inválida. */
  readonly parts: ReadonlyArray<KeywordPartRecord>;
  /** Las ocurrencias de tipo dirección que tocan la oración. */
  readonly addresses: ReadonlyArray<TouchingOccurrence>;
  /** Las ocurrencias de otro tipo que tocan la oración. */
  readonly others: ReadonlyArray<TouchingOccurrence>;
  /** Cuántas ocurrencias de la página no se pudieron ubicar en el texto. */
  readonly unlocatedOccurrences: number;
}

export interface KeywordClassifyInput {
  readonly page: KeywordPage;
  /** El texto de la página tal como lo extrajo la aplicación. */
  readonly pageText: string;
  /** Las palabras de la página, en orden (para ubicar por `wordSpan`). */
  readonly pageWords: ReadonlyArray<string>;
  /** Todas las ocurrencias de la página, de cualquier tipo y de cualquier detector. */
  readonly occurrences: ReadonlyArray<ObservedOccurrence>;
  /** Los ids de las ocurrencias que sobreviven al agrupado (M-D3). Sin él, `survives` queda ausente. */
  readonly finalOccurrenceIds?: ReadonlySet<string>;
}

/** Ubica una ocurrencia sobre el texto de la página. Ver el comentario de cabecera. */
export function locateKeywordOccurrence(
  occurrence: ObservedOccurrence,
  pageText: string,
  pageWords: ReadonlyArray<string>,
  searchFrom: number,
): LocatedOccurrence {
  const chars =
    occurrence.wordSpan === null ? null : wordSpanToChars(pageWords, occurrence.wordSpan);
  if (
    chars !== null &&
    occurrence.value.length > 0 &&
    pageText.slice(chars.start, chars.end) === occurrence.value
  )
    return { ...occurrence, ...chars, locatedBy: "wordSpan" };
  if (occurrence.value.length > 0) {
    const preferred = pageText.indexOf(occurrence.value, Math.max(0, searchFrom));
    const index = preferred >= 0 ? preferred : pageText.indexOf(occurrence.value);
    if (index >= 0)
      return {
        ...occurrence,
        start: index,
        end: index + occurrence.value.length,
        locatedBy: "value",
      };
  }
  if (chars !== null) return { ...occurrence, ...chars, locatedBy: "wordSpan" };
  return { ...occurrence, start: null, end: null, locatedBy: "unlocated" };
}

export interface Range {
  readonly start: number;
  readonly end: number;
}

function rangeOf(occurrence: LocatedOccurrence): Range | null {
  return occurrence.start === null || occurrence.end === null
    ? null
    : { start: occurrence.start, end: occurrence.end };
}

/** Cuántos caracteres que no son espacio de `[start, end)` caen dentro de alguno de los `ranges`. */
function coveredLetters(
  ranges: ReadonlyArray<Range>,
  text: string,
  start: number,
  end: number,
): { readonly covered: number; readonly total: number } {
  let covered = 0;
  let total = 0;
  for (let index = start; index < end; index += 1) {
    if (/\s/.test(text.charAt(index))) continue;
    total += 1;
    if (ranges.some((range) => range.start <= index && index < range.end)) covered += 1;
  }
  return { covered, total };
}

export function coverageOf(
  ranges: ReadonlyArray<Range>,
  text: string,
  start: number,
  end: number,
): Coverage {
  const { covered, total } = coveredLetters(ranges, text, start, end);
  if (covered === 0) return "none";
  return covered === total ? "full" : "partial";
}

/** Cuántas veces aparece `value` en `text`, contando las apariciones que se superponen. */
function appearances(text: string, value: string): number {
  let count = 0;
  let from = text.indexOf(value);
  while (value.length > 0 && from >= 0) {
    count += 1;
    from = text.indexOf(value, from + 1);
  }
  return count;
}

function touching(
  occurrence: LocatedOccurrence,
  sentence: string,
  finalIds: ReadonlySet<string> | undefined,
): TouchingOccurrence {
  return {
    entityType: occurrence.entityType,
    value: occurrence.value,
    source: occurrence.source,
    confidence: occurrence.confidence,
    start: occurrence.start ?? 0,
    end: occurrence.end ?? 0,
    locatedBy: occurrence.locatedBy,
    ambiguous: occurrence.locatedBy === "value" && appearances(sentence, occurrence.value) > 1,
    ...(finalIds === undefined ? {} : { survives: finalIds.has(occurrence.id) }),
  };
}

/** Clasifica una página. Ver los campos de `KeywordPageRecord`. */
export function classifyKeywordPage(input: KeywordClassifyInput): KeywordPageRecord {
  const { page, pageText, pageWords } = input;
  const base = {
    id: page.id,
    baseId: page.baseId,
    category: page.category,
    script: page.script,
    text: page.text,
    pageText,
  };
  const sentenceStart = pageText.indexOf(page.text);
  const located = input.occurrences.map((occurrence) =>
    locateKeywordOccurrence(occurrence, pageText, pageWords, Math.max(0, sentenceStart)),
  );
  const unlocatedOccurrences = located.filter((o) => o.locatedBy === "unlocated").length;

  const invalid = (reason: string): KeywordPageRecord => ({
    ...base,
    valid: false,
    invalidReason: reason,
    parts: [],
    addresses: [],
    others: [],
    unlocatedOccurrences,
  });
  // La página es inválida si la app extrajo un texto distinto del escrito: no se «normaliza».
  if (pageText !== expectedKeywordPageText(page))
    return invalid("texto extraido distinto del escrito");
  if (sentenceStart < 0) return invalid("la oracion no esta en el texto extraido");
  const sentenceEnd = sentenceStart + page.text.length;

  const inSentence = located.filter((o) => {
    const range = rangeOf(o);
    return range !== null && range.start < sentenceEnd && range.end > sentenceStart;
  });
  const addressRanges = inSentence
    .filter((o) => o.entityType === ADDRESS_TYPE)
    .flatMap((o) => rangeOf(o) ?? []);
  const otherOccurrences = inSentence.filter((o) => o.entityType !== ADDRESS_TYPE);
  const otherRanges = otherOccurrences.flatMap((o) => rangeOf(o) ?? []);
  const anyRanges = [...addressRanges, ...otherRanges];

  // Las partes se ubican en orden, desde el comienzo de la oración.
  const parts: KeywordPartRecord[] = [];
  let cursor = sentenceStart;
  for (const { name, text } of presentParts(page.parts)) {
    const start = pageText.indexOf(text, cursor);
    if (start < 0 || start + text.length > sentenceEnd) return invalid(`parte no ubicada: ${name}`);
    const end = start + text.length;
    cursor = end;
    const otherTypes = [
      ...new Set(
        otherOccurrences
          .filter((o) => {
            const range = rangeOf(o);
            return range !== null && coveredLetters([range], pageText, start, end).covered > 0;
          })
          .map((o) => o.entityType),
      ),
    ].sort();
    parts.push({
      part: name,
      text,
      start,
      end,
      address: coverageOf(addressRanges, pageText, start, end),
      other: coverageOf(otherRanges, pageText, start, end),
      otherTypes,
      any: coverageOf(anyRanges, pageText, start, end),
    });
  }

  return {
    ...base,
    valid: true,
    invalidReason: null,
    parts,
    addresses: inSentence
      .filter((o) => o.entityType === ADDRESS_TYPE)
      .map((o) => touching(o, page.text, input.finalOccurrenceIds)),
    others: otherOccurrences.map((o) => touching(o, page.text, input.finalOccurrenceIds)),
    unlocatedOccurrences,
  };
}

/** La parte `name` de un registro, si la oración la tiene. */
export function partOf(
  record: KeywordPageRecord,
  name: KeywordPartName,
): KeywordPartRecord | undefined {
  return record.parts.find((candidate) => candidate.part === name);
}

/** Las partes que cuentan como «la dirección» de una página: el nombre y, si la tiene, la altura. */
export function coreParts(record: KeywordPageRecord): ReadonlyArray<KeywordPartRecord> {
  return record.parts.filter((part) => part.part === "nombre" || part.part === "altura");
}

/** Combina la cobertura de varias partes: entera si todas lo están, nada si ninguna, y en parte si no. */
export function combineCoverage(values: ReadonlyArray<Coverage>): Coverage {
  if (values.length === 0) return "none";
  if (values.every((value) => value === "full")) return "full";
  if (values.every((value) => value === "none")) return "none";
  return "partial";
}
