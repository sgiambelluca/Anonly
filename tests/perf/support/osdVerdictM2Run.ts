/**
 * M-O2: arma el registro de una observación de los conjuntos nuevos (ruido, margen, páginas reales) a partir
 * de lo que capturó el spec. Pura: sin Electron ni disco. Comparte con M-O1 las cinco observaciones por
 * página (producción y un veredicto forzado a cada ángulo) y la revisión de coherencia.
 *
 * **Privacidad.** Un registro de una página real (`kind: "real"`) no lleva ningún campo de texto: ni las
 * palabras, ni los valores de las entidades, ni nombres de archivo. Solo cantidades, confianzas, tinta,
 * ángulos, tiempos, dimensiones, hashes, tipos de entidad y el identificador neutro (`R1-p07`). Los registros
 * de ruido y de margen (sintéticos) sí traen las palabras y los valores, porque los sintéticos no son
 * confidenciales y el análisis necesita ver qué inventó una hoja vacía y qué leyó del sello.
 */

import type { Word } from "@anonly/shared";

import { decodeWords, scoreReading, tokens, type Job } from "./adr190Dpi.js";
import type { RawOsd } from "./adr190OsdProbe.js";
import { hasExactDniToken, type OcrAttempt } from "./adr190Recovery.js";
import type { PhysicalAngle } from "./osdVerdictCorpus.js";
import { MARGIN_BODY_DNI, STAMP_DNI, STAMP_TEXT, marginBodyText } from "./osdVerdictCorpusM2.js";
import type { M2Entry, M2Kind } from "./osdVerdictCorpusM2.js";
import {
  countReliable,
  observationIssues,
  readOrientationView,
  type OrientationView,
  type VerdictMode,
} from "./osdVerdictRun.js";

/** Lo que se espera leer de una parte de la página (el cuerpo o el sello de un PDF de margen). */
export interface ExpectedPart {
  readonly tokens: ReadonlyArray<string>;
  readonly text: string;
  readonly dni: string;
}

export interface M2Expected {
  readonly body: ExpectedPart | null;
  readonly stamp: ExpectedPart | null;
}

export function expectedOf(entry: M2Entry): M2Expected {
  if (entry.margin === null) return { body: null, stamp: null };
  const bodyText = marginBodyText(entry.margin);
  return {
    body:
      bodyText === "" ? null : { tokens: tokens(bodyText), text: bodyText, dni: MARGIN_BODY_DNI },
    stamp: { tokens: tokens(STAMP_TEXT), text: STAMP_TEXT, dni: STAMP_DNI },
  };
}

/** Si una lectura trae todos los tokens de una parte y el número como palabra. */
export interface PartFlags {
  readonly allTokens: boolean;
  readonly dniToken: boolean;
}

export interface M2Attempt {
  readonly order: number;
  readonly sourceOrientation: number | null;
  readonly dispatchedOrientation: number | null;
  readonly upscale: number;
  readonly dpi: number | null;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly imageBytes: number;
  readonly imageSha256: string;
  readonly terminal: string | null;
  readonly durationMs: number | null;
  readonly pageConfidence: number | null;
  readonly wordCount: number;
  readonly reliableWordCount: number;
  /** Confianza de cada palabra, 0 a 1, en el orden de la lectura. */
  readonly confidences: ReadonlyArray<number>;
  readonly body: PartFlags | null;
  readonly stamp: PartFlags | null;
  /** Solo en los sintéticos. */
  readonly words?: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
}

export interface M2Final {
  readonly wordCount: number;
  readonly reliableWordCount: number;
  readonly pageConfidence: number | null;
  readonly unreadableInk: boolean;
  readonly confidences: ReadonlyArray<number>;
  /** Cantidad de entidades por tipo (`DNI`, `PERSON`…). */
  readonly entityCounts: Readonly<Record<string, number>>;
  readonly body: (PartFlags & { readonly dniEntity: boolean }) | null;
  readonly stamp: (PartFlags & { readonly dniEntity: boolean }) | null;
  /** Solo en los sintéticos. */
  readonly words?: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
  readonly entities?: ReadonlyArray<{ readonly entityType: string; readonly value: string }>;
}

export interface M2Observation {
  readonly schema: 2;
  readonly key: string;
  readonly kind: M2Kind;
  readonly label: string;
  readonly sourceDpi: number | null;
  readonly physicalRotation: PhysicalAngle;
  readonly correctAngle: PhysicalAngle | null;
  readonly mode: VerdictMode;
  readonly forcedAngle: PhysicalAngle | null;
  readonly fixtureSha256: string;
  readonly effectiveDpi: number | null;
  readonly rawOsd: {
    readonly orientation: number | null;
    readonly confidence: number | null;
    readonly error: string | null;
  };
  readonly natural: OrientationView;
  readonly delivered: OrientationView;
  readonly attempts: ReadonlyArray<M2Attempt>;
  /** Orden del reconocimiento cuya lectura es la que entregó la cadena (`null` si ninguna coincide). */
  readonly finalAttemptOrder: number | null;
  readonly final: M2Final;
  readonly totalOcrDurationMs: number;
  readonly readyMs: number;
  readonly issues: ReadonlyArray<string>;
}

export function m2FileName(key: string, forcedAngle: number | null): string {
  return `${key}-${forcedAngle === null ? "production" : `forced-${forcedAngle}`}.json`;
}

function flagsOf(words: ReadonlyArray<Word>, part: ExpectedPart | null): PartFlags | null {
  if (part === null) return null;
  const quality = scoreReading(part.text, words, [], part.dni);
  return { allTokens: quality.tokenRecall === 1, dniToken: hasExactDniToken(words, part.dni) };
}

const digits = (value: string): string => value.replace(/\D/g, "");

/** Las mismas palabras, sin importar el orden: el documento las reordena por posición de lectura. */
function sameWords(a: ReadonlyArray<Word>, b: ReadonlyArray<Word>): boolean {
  if (a.length !== b.length) return false;
  const key = (word: Word): string => `${word.confidence}|${word.text}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((item, index) => item === right[index]);
}

function readAttempt(attempt: OcrAttempt, order: number, expected: M2Expected, keepText: boolean) {
  let words: ReadonlyArray<Word> = [];
  let pageConfidence: number | null = null;
  if (attempt.job.terminal === "COMPLETED") {
    words = decodeWords(attempt.job.result);
    const result = attempt.job.result as { confidence?: unknown } | null;
    pageConfidence = typeof result?.confidence === "number" ? result.confidence : null;
  }
  const record: M2Attempt = {
    order,
    sourceOrientation: attempt.input.sourceOrientation,
    dispatchedOrientation: attempt.input.dispatchedOrientation,
    upscale: attempt.job.upscale,
    dpi: attempt.job.dpi,
    widthPx: attempt.input.widthPx,
    heightPx: attempt.input.heightPx,
    imageBytes: attempt.job.imageBytes,
    imageSha256: attempt.imageSha256,
    terminal: attempt.job.terminal,
    durationMs:
      attempt.job.finishedAt === null ? null : attempt.job.finishedAt - attempt.job.startedAt,
    pageConfidence,
    wordCount: words.length,
    reliableWordCount: countReliable(words),
    confidences: words.map((word) => word.confidence),
    body: flagsOf(words, expected.body),
    stamp: flagsOf(words, expected.stamp),
    ...(keepText ? { words: words.map(({ text, confidence }) => ({ text, confidence })) } : {}),
  };
  return { record, words };
}

export interface M2Input {
  readonly entry: M2Entry;
  readonly fixtureSha256: string;
  readonly forcedAngle: PhysicalAngle | null;
  readonly attempts: ReadonlyArray<OcrAttempt>;
  readonly orientationJob: Job;
  readonly rawOsd: RawOsd;
  readonly run: {
    readonly words: ReadonlyArray<Word>;
    readonly entities: ReadonlyArray<{ readonly value: string; readonly entityType: string }>;
    readonly ocrPages: ReadonlyArray<unknown>;
    readonly unreadableInkEvents: ReadonlyArray<unknown>;
  };
  readonly readyMs: number;
}

export function buildM2Observation(input: M2Input): M2Observation {
  const { entry, forcedAngle, attempts, orientationJob, rawOsd, run } = input;
  const keepText = entry.kind !== "real";
  const expected = expectedOf(entry);
  const delivered = readOrientationView(orientationJob.result);
  const natural =
    orientationJob.naturalResult === undefined
      ? delivered
      : readOrientationView(orientationJob.naturalResult);
  const read = attempts.map((attempt, order) => readAttempt(attempt, order, expected, keepText));

  let pageConfidence: number | null = null;
  let unreadableInk = run.unreadableInkEvents.length > 0;
  for (const event of run.ocrPages) {
    if (typeof event !== "object" || event === null) continue;
    const record = event as { pageIndex?: unknown; confidence?: unknown; unreadableInk?: unknown };
    if (record.pageIndex !== 0) continue;
    pageConfidence = typeof record.confidence === "number" ? record.confidence : null;
    if (record.unreadableInk === true) unreadableInk = true;
  }
  const finalIndex = read.findIndex((item) => sameWords(item.words, run.words));
  const entityCounts: Record<string, number> = {};
  for (const entity of run.entities)
    entityCounts[entity.entityType] = (entityCounts[entity.entityType] ?? 0) + 1;
  const partFinal = (part: ExpectedPart | null) => {
    const flags = flagsOf(run.words, part);
    if (part === null || flags === null) return null;
    return {
      ...flags,
      dniEntity: run.entities.some(
        (entity) => entity.entityType === "DNI" && digits(entity.value) === digits(part.dni),
      ),
    };
  };
  const record: M2Observation = {
    schema: 2,
    key: entry.key,
    kind: entry.kind,
    label: entry.label,
    sourceDpi: entry.sourceDpi,
    physicalRotation: entry.physicalRotation,
    correctAngle: entry.correctAngle,
    mode: forcedAngle === null ? "production" : "forced-verdict",
    forcedAngle,
    fixtureSha256: input.fixtureSha256,
    effectiveDpi: attempts[0]?.job.dpi ?? null,
    rawOsd: {
      orientation: rawOsd.rawOrientation,
      confidence: rawOsd.rawConfidence,
      error: rawOsd.error,
    },
    natural,
    delivered,
    attempts: read.map((item) => item.record),
    finalAttemptOrder: finalIndex < 0 ? null : finalIndex,
    final: {
      wordCount: run.words.length,
      reliableWordCount: countReliable(run.words),
      pageConfidence,
      unreadableInk,
      confidences: run.words.map((word) => word.confidence),
      entityCounts,
      body: partFinal(expected.body),
      stamp: partFinal(expected.stamp),
      ...(keepText
        ? {
            words: run.words.map(({ text, confidence }) => ({ text, confidence })),
            entities: run.entities.map(({ entityType, value }) => ({ entityType, value })),
          }
        : {}),
    },
    totalOcrDurationMs: read.reduce((total, item) => total + (item.record.durationMs ?? 0), 0),
    readyMs: input.readyMs,
    issues: [],
  };
  return { ...record, issues: m2ObservationIssues(record) };
}

/** Coherencia interna de un registro de M-O2: la de M-O1 más las propias del conjunto. */
export function m2ObservationIssues(record: M2Observation): string[] {
  const issues = observationIssues(record);
  if (record.kind === "real" && record.correctAngle !== null)
    issues.push("una página real no tiene ángulo correcto conocido");
  if (record.final.pageConfidence === null && record.final.wordCount > 0)
    issues.push("hay palabras finales pero no se vio OCR_PAGE_FINISHED de la página");
  if (record.finalAttemptOrder === null && record.final.wordCount > 0)
    issues.push("la lectura final no coincide con ningún reconocimiento");
  return issues;
}

/**
 * Los nombres de campo de un registro y de todo lo que contiene. Sirve para comprobar que el de una página
 * real no tiene ningún campo de texto.
 */
export function fieldNames(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) fieldNames(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [name, inner] of Object.entries(value)) {
      into.add(name);
      fieldNames(inner, into);
    }
  }
  return into;
}

/** Los campos que pueden llevar texto del documento. Un registro `real` no puede tener ninguno. */
export const TEXT_FIELD_NAMES: ReadonlyArray<string> = [
  "text",
  "words",
  "value",
  "entities",
  "name",
];
