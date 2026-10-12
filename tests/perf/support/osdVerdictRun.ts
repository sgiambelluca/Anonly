/**
 * M-O1: arma el registro de una observación (un PDF, un modo) a partir de lo que el spec capturó en la
 * aplicación, y revisa que el registro sea coherente. Pura: sin Electron ni disco.
 *
 * Hay cinco observaciones por PDF:
 *
 * - `production`: la cadena de ADR-190 sin forzar nada. Guarda el veredicto natural del OSD, la lectura que
 *   entrega la cadena y todo lo que intentó.
 * - `forced-<ángulo>` (cuatro): el resultado de la detección de orientación se reemplaza, antes de que lo
 *   lea el host, por un veredicto válido (`osdHadVerdict: true`) en ese ángulo. El producto sigue desde ahí
 *   con su cadena completa. El primer reconocimiento de cada una es la «primera lectura» del PDF en ese
 *   ángulo, sobre el mismo ráster y con el mismo DPI.
 *
 * `delivered` es lo que recibió el host; `natural`, lo que devolvió el worker. En `production` son iguales.
 */

import type { Word } from "@anonly/shared";

import { decodeWords, scoreReading, tokens, type Job } from "./adr190Dpi.js";
import type { RawOsd } from "./adr190OsdProbe.js";
import { hasExactDniToken, type OcrAttempt } from "./adr190Recovery.js";
import type { CorpusEntry, PhysicalAngle } from "./osdVerdictCorpus.js";

/** Confianza mínima de una palabra confiable (la de ADR-190 §2, en la escala 0 a 1 de los eventos). */
export const RELIABLE_WORD_CONFIDENCE = 0.6;

/** Se usa el mismo nombre en `mode` de cada registro; `forcedAngle` dice a qué ángulo. */
export type VerdictMode = "production" | "forced-verdict";

export interface OrientationView {
  readonly orientation: number | null;
  readonly osdHadVerdict: boolean | null;
  readonly inkRatio: number | null;
}

export interface AttemptRecord {
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
  readonly matchedTokens: number;
  readonly tokenRecall: number | null;
  readonly tokenPrecision: number | null;
  /** Están todos los tokens esperados. `null` si el PDF no tiene texto esperado. */
  readonly allExpectedTokens: boolean | null;
  readonly dniTokenPresent: boolean | null;
  readonly words: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
}

export interface FinalRecord {
  readonly words: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
  readonly wordCount: number;
  readonly reliableWordCount: number;
  /** De `OCR_PAGE_FINISHED`. */
  readonly pageConfidence: number | null;
  readonly unreadableInk: boolean;
  /** Regex encontró el DNI esperado como entidad. `null` si el PDF no tiene DNI esperado. */
  readonly dniEntity: boolean | null;
  readonly matchedTokens: number;
  readonly tokenRecall: number | null;
  readonly tokenPrecision: number | null;
  readonly allExpectedTokens: boolean | null;
  /** Los cuatro tokens (los esperados, en general) y el DNI como entidad. `null` si no hay qué esperar. */
  readonly expectedDataPresent: boolean | null;
}

export interface ObservationRecord {
  readonly schema: 1;
  readonly key: string;
  readonly set: CorpusEntry["set"];
  readonly label: string;
  readonly sourceDpi: number;
  readonly physicalRotation: PhysicalAngle;
  readonly correctAngle: PhysicalAngle;
  readonly mode: VerdictMode;
  readonly forcedAngle: PhysicalAngle | null;
  readonly fixtureSha256: string;
  readonly expectedTokens: ReadonlyArray<string>;
  readonly expectedDni: string | null;
  readonly effectiveDpi: number | null;
  readonly rawOsd: {
    readonly orientation: number | null;
    readonly confidence: number | null;
    readonly error: string | null;
  };
  readonly natural: OrientationView;
  readonly delivered: OrientationView;
  readonly attempts: ReadonlyArray<AttemptRecord>;
  readonly final: FinalRecord;
  readonly totalOcrDurationMs: number;
  /** Del `setInputFiles` hasta `PIPELINE_READY`. */
  readonly readyMs: number;
  readonly issues: ReadonlyArray<string>;
}

export function observationFileName(key: string, forcedAngle: number | null): string {
  return `${key}-${forcedAngle === null ? "production" : `forced-${forcedAngle}`}.json`;
}

export function countReliable(words: ReadonlyArray<{ readonly confidence: number }>): number {
  return words.filter((word) => word.confidence >= RELIABLE_WORD_CONFIDENCE).length;
}

export function readOrientationView(value: unknown): OrientationView {
  if (typeof value !== "object" || value === null)
    return { orientation: null, osdHadVerdict: null, inkRatio: null };
  const record = value as { orientation?: unknown; osdHadVerdict?: unknown; inkRatio?: unknown };
  return {
    orientation: typeof record.orientation === "number" ? record.orientation : null,
    osdHadVerdict: typeof record.osdHadVerdict === "boolean" ? record.osdHadVerdict : null,
    inkRatio: typeof record.inkRatio === "number" ? record.inkRatio : null,
  };
}

function toAttemptRecord(
  attempt: OcrAttempt,
  order: number,
  expectedText: string,
  expectedDni: string | null,
  expectedTokenCount: number,
): AttemptRecord {
  let words: ReadonlyArray<Word> = [];
  let pageConfidence: number | null = null;
  if (attempt.job.terminal === "COMPLETED") {
    words = decodeWords(attempt.job.result);
    const result = attempt.job.result as { confidence?: unknown } | null;
    pageConfidence = typeof result?.confidence === "number" ? result.confidence : null;
  }
  const quality = scoreReading(expectedText, words, [], expectedDni);
  return {
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
    matchedTokens: quality.matchedTokens,
    tokenRecall: quality.tokenRecall,
    tokenPrecision: quality.tokenPrecision,
    allExpectedTokens: expectedTokenCount === 0 ? null : quality.tokenRecall === 1,
    dniTokenPresent: expectedDni === null ? null : hasExactDniToken(words, expectedDni),
    words: words.map(({ text, confidence }) => ({ text, confidence })),
  };
}

const digits = (value: string): string => value.replace(/\D/g, "");

/** Último `OCR_PAGE_FINISHED` de la página 0: su confianza y si trae `unreadableInk`. */
function lastPageEvent(events: ReadonlyArray<unknown>): {
  readonly confidence: number | null;
  readonly unreadableInk: boolean;
} {
  let found: { confidence: number | null; unreadableInk: boolean } | null = null;
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const record = event as { pageIndex?: unknown; confidence?: unknown; unreadableInk?: unknown };
    if (record.pageIndex !== 0) continue;
    found = {
      confidence: typeof record.confidence === "number" ? record.confidence : null,
      unreadableInk: record.unreadableInk === true,
    };
  }
  return found ?? { confidence: null, unreadableInk: false };
}

export interface ObservationInput {
  readonly entry: CorpusEntry;
  readonly fixture: {
    readonly hash: string;
    readonly expectedText: string;
    readonly expectedDni: string | null;
  };
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

export function buildObservation(input: ObservationInput): ObservationRecord {
  const { entry, fixture, forcedAngle, attempts, orientationJob, rawOsd, run } = input;
  const expectedTokens = tokens(fixture.expectedText);
  const delivered = readOrientationView(orientationJob.result);
  const natural =
    orientationJob.naturalResult === undefined
      ? delivered
      : readOrientationView(orientationJob.naturalResult);
  const attemptRecords = attempts.map((attempt, order) =>
    toAttemptRecord(
      attempt,
      order,
      fixture.expectedText,
      fixture.expectedDni,
      expectedTokens.length,
    ),
  );

  const quality = scoreReading(fixture.expectedText, run.words, [], fixture.expectedDni);
  const event = lastPageEvent(run.ocrPages);
  const dniEntity =
    fixture.expectedDni === null
      ? null
      : run.entities.some(
          (candidate) =>
            candidate.entityType === "DNI" &&
            digits(candidate.value) === digits(fixture.expectedDni ?? ""),
        );
  const allExpectedTokens = expectedTokens.length === 0 ? null : quality.tokenRecall === 1;
  const expectedDataPresent =
    allExpectedTokens === null && dniEntity === null
      ? null
      : allExpectedTokens !== false && dniEntity !== false;
  const first = attempts[0];
  const record: ObservationRecord = {
    schema: 1,
    key: entry.key,
    set: entry.set,
    label: entry.label,
    sourceDpi: entry.sourceDpi,
    physicalRotation: entry.physicalRotation,
    correctAngle: entry.correctAngle,
    mode: forcedAngle === null ? "production" : "forced-verdict",
    forcedAngle,
    fixtureSha256: fixture.hash,
    expectedTokens,
    expectedDni: fixture.expectedDni,
    effectiveDpi: first?.job.dpi ?? null,
    rawOsd: {
      orientation: rawOsd.rawOrientation,
      confidence: rawOsd.rawConfidence,
      error: rawOsd.error,
    },
    natural,
    delivered,
    attempts: attemptRecords,
    final: {
      words: run.words.map(({ text, confidence }) => ({ text, confidence })),
      wordCount: run.words.length,
      reliableWordCount: countReliable(run.words),
      pageConfidence: event.confidence,
      unreadableInk: event.unreadableInk || run.unreadableInkEvents.length > 0,
      dniEntity,
      matchedTokens: quality.matchedTokens,
      tokenRecall: quality.tokenRecall,
      tokenPrecision: quality.tokenPrecision,
      allExpectedTokens,
      expectedDataPresent,
    },
    totalOcrDurationMs: attemptRecords.reduce((total, a) => total + (a.durationMs ?? 0), 0),
    readyMs: input.readyMs,
    issues: [],
  };
  return { ...record, issues: observationIssues(record) };
}

/** Lo que la revisión de coherencia mira de un registro (los de M-O1 y los de M-O2 lo cumplen). */
export interface IssueCheckable {
  readonly mode: VerdictMode;
  readonly forcedAngle: PhysicalAngle | null;
  readonly natural: OrientationView;
  readonly delivered: OrientationView;
  readonly attempts: ReadonlyArray<
    Pick<
      AttemptRecord,
      "terminal" | "sourceOrientation" | "dispatchedOrientation" | "imageSha256" | "dpi"
    >
  >;
}

/**
 * Coherencia interna de un registro. Un registro con issues no entra a ningún total: la campaña falla
 * cerrado (`osdVerdictSummary.ts`). `issues` del propio registro no se mira acá.
 */
export function observationIssues(record: IssueCheckable): string[] {
  const issues: string[] = [];
  const { delivered, natural, attempts } = record;
  if (
    delivered.orientation === null ||
    delivered.osdHadVerdict === null ||
    delivered.inkRatio === null
  )
    issues.push("el resultado de orientación recibido por el host está incompleto");
  if (delivered.inkRatio !== null && (delivered.inkRatio < 0 || delivered.inkRatio > 1))
    issues.push(`inkRatio fuera de [0, 1]: ${delivered.inkRatio}`);
  if (delivered.osdHadVerdict === false && delivered.orientation !== 0)
    issues.push("osdHadVerdict=false con orientación distinta de 0");

  if (record.forcedAngle === null) {
    if (record.mode !== "production") issues.push("modo production esperado sin ángulo forzado");
    if (
      natural.orientation !== delivered.orientation ||
      natural.osdHadVerdict !== delivered.osdHadVerdict ||
      natural.inkRatio !== delivered.inkRatio
    )
      issues.push("producción: lo recibido por el host difiere del resultado natural");
  } else {
    if (record.mode !== "forced-verdict") issues.push("modo forced-verdict esperado con ángulo");
    if (delivered.orientation !== record.forcedAngle)
      issues.push(
        `veredicto forzado ${record.forcedAngle}: el host recibió orientación ${delivered.orientation}`,
      );
    if (delivered.osdHadVerdict !== true)
      issues.push("veredicto forzado: el host no recibió osdHadVerdict=true");
    if (natural.orientation === null || natural.inkRatio === null)
      issues.push("veredicto forzado: falta el resultado natural del worker");
    if (natural.inkRatio !== delivered.inkRatio)
      issues.push("veredicto forzado: el inkRatio recibido difiere del natural");
  }

  const first = attempts[0];
  if (first === undefined) issues.push("sin ningún reconocimiento");
  else {
    if (first.terminal !== "COMPLETED") issues.push(`primera lectura ${first.terminal}`);
    if (first.sourceOrientation !== delivered.orientation)
      issues.push(
        `el primer reconocimiento usó ${first.sourceOrientation}, no el ${delivered.orientation} del OSD`,
      );
    if (first.dispatchedOrientation !== first.sourceOrientation)
      issues.push("el primer despacho cambió la orientación que decidió el host");
    if (record.forcedAngle !== null && first.dispatchedOrientation !== record.forcedAngle)
      issues.push("el primer reconocimiento no salió en el ángulo forzado");
  }
  if (new Set(attempts.map((a) => a.imageSha256)).size > 1)
    issues.push("los reconocimientos de una misma observación no usaron el mismo ráster");
  if (new Set(attempts.map((a) => a.dpi)).size > 1)
    issues.push("los reconocimientos de una misma observación usaron DPI distintos");
  return issues;
}
