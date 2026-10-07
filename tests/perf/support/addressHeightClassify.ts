/**
 * M-D1: la clasificación pura de una oración de prueba a partir de lo que la aplicación dejó después del
 * análisis. Sin Electron, sin disco: recibe el texto de la página tal como lo extrajo la app y todas las
 * ocurrencias de esa página, de cualquier tipo, y dice si el modelo marcó el lugar, si el número quedó
 * dentro de una dirección y si lo cubrió otro tipo (ADR-212).
 *
 * Posiciones: todo se calcula sobre el texto de la página (`Page.text` es `words.map(w => w.text).join(" ")`).
 * Una ocurrencia se ubica por su `value` dentro de la oración de prueba (el valor de una ocurrencia de NER
 * es un tramo del texto de la página, ADR-212 §8); si el valor no aparece, por sus índices de palabra
 * (`wordSpan`); si tampoco, queda sin ubicar y se cuenta aparte.
 */

import {
  expectedOutcome,
  isYearLike,
  type AddressHeightCategory,
  type AddressHeightSentence,
  type ExpectedOutcome,
} from "./addressHeightSentences.js";

const ADDRESS_TYPE = "ADDRESS";

export interface ObservedOccurrence {
  readonly id: string;
  readonly entityType: string;
  readonly value: string;
  readonly normalizedValue: string | null;
  readonly source: string;
  readonly confidence: number | null;
  readonly pageIndex: number;
  readonly wordSpan: {
    readonly startIndex: number;
    readonly endIndexExclusive: number;
  } | null;
}

export type LocatedBy = "value" | "wordSpan" | "unlocated";

export interface LocatedOccurrence extends ObservedOccurrence {
  readonly start: number | null;
  readonly end: number | null;
  readonly locatedBy: LocatedBy;
}

export interface ClassifyInput {
  readonly sentence: AddressHeightSentence;
  /** El texto de la página tal como lo extrajo la aplicación. */
  readonly pageText: string;
  /** Las palabras de la página, en orden (para ubicar por `wordSpan`). */
  readonly pageWords: ReadonlyArray<string>;
  /** Todas las ocurrencias de la página, de cualquier tipo y de cualquier detector. */
  readonly occurrences: ReadonlyArray<ObservedOccurrence>;
}

export interface SentenceRecord {
  readonly id: string;
  readonly category: AddressHeightCategory;
  readonly text: string;
  readonly place: string;
  readonly number: string;
  /** El texto de la página tal como lo extrajo la aplicación. */
  readonly pageText: string;
  /** La oración aparece textual dentro del texto extraído. */
  readonly sentenceInPageText: boolean;
  readonly occurrences: ReadonlyArray<LocatedOccurrence>;
  /** Cuántas ocurrencias no se pudieron ubicar en el texto (ni por valor ni por palabras). */
  readonly unlocatedOccurrences: number;
  readonly placeMarked: boolean;
  readonly addressValues: ReadonlyArray<string>;
  readonly numberInAddress: boolean;
  /** Tipos de las ocurrencias que no son direcciones y cuyo rango contiene los dígitos. */
  readonly numberCoveredByOther: ReadonlyArray<string>;
  readonly adjacent: boolean;
  /** El número de la oración tiene forma de año (cuatro dígitos entre 1900 y 2099). */
  readonly yearLike: boolean;
}

const WORD_SEPARATOR = " ";

function wordSpanToChars(
  pageWords: ReadonlyArray<string>,
  span: { readonly startIndex: number; readonly endIndexExclusive: number },
): { readonly start: number; readonly end: number } | null {
  if (
    span.startIndex < 0 ||
    span.endIndexExclusive <= span.startIndex ||
    span.endIndexExclusive > pageWords.length
  )
    return null;
  let offset = 0;
  let start = -1;
  let end = -1;
  for (let index = 0; index < span.endIndexExclusive; index += 1) {
    const word = pageWords[index] ?? "";
    if (index === span.startIndex) start = offset;
    offset += word.length;
    if (index === span.endIndexExclusive - 1) end = offset;
    offset += WORD_SEPARATOR.length;
  }
  return start < 0 || end < 0 ? null : { start, end };
}

/** Ubica una ocurrencia sobre el texto de la página. Ver el comentario de cabecera. */
export function locateOccurrence(
  occurrence: ObservedOccurrence,
  pageText: string,
  pageWords: ReadonlyArray<string>,
  searchFrom: number,
): LocatedOccurrence {
  if (occurrence.value.length > 0) {
    const preferred = pageText.indexOf(occurrence.value, Math.max(0, searchFrom));
    const index = preferred >= 0 ? preferred : pageText.indexOf(occurrence.value);
    if (index >= 0) {
      return {
        ...occurrence,
        start: index,
        end: index + occurrence.value.length,
        locatedBy: "value",
      };
    }
  }
  if (occurrence.wordSpan !== null) {
    const chars = wordSpanToChars(pageWords, occurrence.wordSpan);
    if (chars !== null) return { ...occurrence, ...chars, locatedBy: "wordSpan" };
  }
  return { ...occurrence, start: null, end: null, locatedBy: "unlocated" };
}

/** Entre el fin de la dirección y los dígitos: solo espacio y, si lo hay, el conector de ADR-212 §2. */
const GAP_BEFORE_NUMBER_RE = /^\s*(?:(?:N[°º]|No\.|nro\.?|n[úu]mero|al)\s*)?$/i;

function overlaps(occurrence: LocatedOccurrence, start: number, end: number): boolean {
  return (
    occurrence.start !== null &&
    occurrence.end !== null &&
    occurrence.start < end &&
    occurrence.end > start
  );
}

function contains(occurrence: LocatedOccurrence, start: number, end: number): boolean {
  return (
    occurrence.start !== null &&
    occurrence.end !== null &&
    occurrence.start <= start &&
    occurrence.end >= end
  );
}

/** Clasifica una oración. Ver los campos de `SentenceRecord`. */
export function classifySentence(input: ClassifyInput): SentenceRecord {
  const { sentence, pageText, pageWords } = input;
  const sentenceStart = pageText.indexOf(sentence.text);
  const sentenceInPageText = sentenceStart >= 0;
  const searchFrom = sentenceInPageText ? sentenceStart : 0;
  const located = input.occurrences.map((occurrence) =>
    locateOccurrence(occurrence, pageText, pageWords, searchFrom),
  );
  const unlocatedOccurrences = located.filter((o) => o.locatedBy === "unlocated").length;
  const addresses = located.filter((o) => o.entityType === ADDRESS_TYPE);
  const addressValues = addresses.map((o) => o.value);
  const yearLike = isYearLike(sentence.number);

  const base = {
    id: sentence.id,
    category: sentence.category,
    text: sentence.text,
    place: sentence.place,
    number: sentence.number,
    pageText,
    sentenceInPageText,
    occurrences: located,
    unlocatedOccurrences,
    addressValues,
    yearLike,
  };
  if (!sentenceInPageText) {
    return {
      ...base,
      placeMarked: false,
      numberInAddress: false,
      numberCoveredByOther: [],
      adjacent: false,
    };
  }

  const placeStart = sentenceStart + sentence.text.indexOf(sentence.place);
  const placeEnd = placeStart + sentence.place.length;
  const sentenceEnd = sentenceStart + sentence.text.length;
  const numberStart = pageText.indexOf(sentence.number, placeEnd);
  const numberFound = numberStart >= 0 && numberStart + sentence.number.length <= sentenceEnd;
  const numberEnd = numberStart + sentence.number.length;

  const placeAddresses = addresses.filter((o) => overlaps(o, placeStart, placeEnd));
  const placeMarked = placeAddresses.length > 0;
  const numberInAddress = numberFound && addresses.some((o) => contains(o, numberStart, numberEnd));
  const numberCoveredByOther = numberFound
    ? [
        ...new Set(
          located
            .filter((o) => o.entityType !== ADDRESS_TYPE && contains(o, numberStart, numberEnd))
            .map((o) => o.entityType),
        ),
      ].sort()
    : [];
  const adjacent =
    numberFound &&
    placeAddresses.some(
      (o) =>
        o.end !== null &&
        o.end <= numberStart &&
        GAP_BEFORE_NUMBER_RE.test(pageText.slice(o.end, numberStart)),
    );

  return {
    ...base,
    placeMarked,
    numberInAddress,
    numberCoveredByOther,
    adjacent,
  };
}

export interface ExpectationCheck {
  /** El resultado coincide con lo que ADR-212 espera de la regla vigente para esa oración. */
  readonly asExpected: boolean;
  readonly expected: ExpectedOutcome;
  readonly reason: string | null;
}

/**
 * Compara una oración contra lo esperado de ADR-212 para la regla vigente (el número se suma siempre, salvo
 * que su forma lo excluya). Solo tiene sentido si el modelo marcó el lugar: si no lo marcó, es un límite del
 * modelo y no de la regla (`reason` lo dice y `asExpected` es `true`: no se cuenta como desvío de la regla).
 */
export function checkExpectation(record: SentenceRecord): ExpectationCheck {
  const sentence: AddressHeightSentence = {
    id: record.id,
    category: record.category,
    text: record.text,
    place: record.place,
    number: record.number,
  };
  const expected = expectedOutcome(sentence);
  if (!record.placeMarked) {
    return {
      asExpected: true,
      expected,
      reason: "el modelo no marcó el lugar (límite del modelo)",
    };
  }
  if (expected === "inside" && !record.numberInAddress) {
    return {
      asExpected: false,
      expected,
      reason:
        `esperado: número dentro de la dirección; quedó a la vista (adjacent=${record.adjacent}, ` +
        `yearLike=${record.yearLike}, otros tipos que lo cubren: ${record.numberCoveredByOther.join(",") || "ninguno"})`,
    };
  }
  if (expected === "untouched" && record.numberInAddress) {
    return {
      asExpected: false,
      expected,
      reason: "esperado: número sin tocar; quedó dentro de la dirección (tapado de más)",
    };
  }
  return { asExpected: true, expected, reason: null };
}
