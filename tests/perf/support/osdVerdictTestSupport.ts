/**
 * Fábricas de observaciones sintéticas para los tests de M-O1. No se usan fuera de `*.test.ts`.
 */

import { corpusEntries, type CorpusEntry, type PhysicalAngle } from "./osdVerdictCorpus.js";
import type { AttemptRecord, ObservationRecord } from "./osdVerdictRun.js";

export function entryOf(key: string): CorpusEntry {
  const found = corpusEntries().find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`sin entrada ${key}`);
  return found;
}

export interface ReadingSpec {
  readonly reliable?: number;
  readonly confidence?: number | null;
  readonly durationMs?: number | null;
  readonly allTokens?: boolean;
}

export function attemptOf(
  order: number,
  angle: number,
  spec: ReadingSpec = {},
  sha = "raster",
): AttemptRecord {
  const reliable = spec.reliable ?? 0;
  return {
    order,
    sourceOrientation: angle,
    dispatchedOrientation: angle,
    upscale: 1,
    dpi: 150,
    widthPx: 100,
    heightPx: 200,
    imageBytes: 4,
    imageSha256: sha,
    terminal: "COMPLETED",
    durationMs: spec.durationMs === undefined ? 1000 : spec.durationMs,
    pageConfidence: spec.confidence === undefined ? 0 : spec.confidence,
    wordCount: reliable,
    reliableWordCount: reliable,
    matchedTokens: spec.allTokens === true ? 4 : 0,
    tokenRecall: spec.allTokens === true ? 1 : 0,
    tokenPrecision: spec.allTokens === true ? 1 : 0,
    allExpectedTokens: spec.allTokens === true,
    dniTokenPresent: spec.allTokens === true,
    words: Array.from({ length: reliable }, () => ({ text: "x", confidence: 0.9 })),
  };
}

export interface FinalSpec {
  readonly present?: boolean;
  readonly unreadable?: boolean;
  readonly dniEntity?: boolean;
  readonly reliable?: number;
  readonly confidence?: number | null;
  readonly text?: string;
}

export interface ObservationSpec {
  readonly key: string;
  readonly forcedAngle: PhysicalAngle | null;
  /** Veredicto natural (en producción es el que recibe el host). */
  readonly verdict?: { readonly orientation: number; readonly had: boolean } | null;
  readonly inkRatio?: number;
  readonly attempts?: ReadonlyArray<{ readonly angle: number; readonly spec?: ReadingSpec }>;
  readonly final?: FinalSpec;
  readonly sha?: string;
  readonly fixtureSha?: string;
}

export function makeObservation(spec: ObservationSpec): ObservationRecord {
  const entry = entryOf(spec.key);
  const natural = {
    orientation: spec.verdict?.orientation ?? 0,
    osdHadVerdict: spec.verdict?.had ?? false,
    inkRatio: spec.inkRatio ?? 0.05,
  };
  const delivered =
    spec.forcedAngle === null
      ? natural
      : { orientation: spec.forcedAngle, osdHadVerdict: true, inkRatio: natural.inkRatio };
  const firstAngle = delivered.orientation;
  const attempts = (spec.attempts ?? [{ angle: firstAngle }]).map((item, order) =>
    attemptOf(order, item.angle, item.spec, spec.sha ?? "raster"),
  );
  const final = spec.final ?? {};
  const present = entry.set === "old-control" ? null : (final.present ?? false);
  return {
    schema: 1,
    key: entry.key,
    set: entry.set,
    label: entry.label,
    sourceDpi: entry.sourceDpi,
    physicalRotation: entry.physicalRotation,
    correctAngle: entry.correctAngle,
    mode: spec.forcedAngle === null ? "production" : "forced-verdict",
    forcedAngle: spec.forcedAngle,
    fixtureSha256: spec.fixtureSha ?? `pdf-${entry.key}`,
    expectedTokens: entry.set === "old-control" ? [] : ["juan", "perez", "dni", "34567891"],
    expectedDni: entry.set === "old-control" ? null : "34.567.891",
    effectiveDpi: 150,
    rawOsd: { orientation: null, confidence: null, error: null },
    natural,
    delivered,
    attempts,
    final: {
      words:
        final.text === undefined
          ? []
          : final.text.split(" ").map((text) => ({ text, confidence: 0.8 })),
      wordCount: final.text === undefined ? 0 : final.text.split(" ").length,
      reliableWordCount: final.reliable ?? 0,
      pageConfidence: final.confidence === undefined ? 0 : final.confidence,
      unreadableInk: final.unreadable ?? false,
      dniEntity: entry.set === "old-control" ? null : (final.dniEntity ?? present === true),
      matchedTokens: 0,
      tokenRecall: null,
      tokenPrecision: null,
      allExpectedTokens: present,
      expectedDataPresent: present,
    },
    totalOcrDurationMs: attempts.reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
    readyMs: 1000,
    issues: [],
  };
}

export interface PdfSpec {
  readonly key: string;
  readonly verdict?: { readonly orientation: number; readonly had: boolean } | null;
  readonly inkRatio?: number;
  readonly production?: Omit<ObservationSpec, "key" | "forcedAngle" | "verdict" | "inkRatio">;
  /** Por ángulo forzado: la primera lectura y el resultado final. */
  readonly forced: Readonly<
    Record<
      PhysicalAngle,
      {
        readonly reading?: ReadingSpec;
        readonly final?: FinalSpec;
        readonly attempts?: ObservationSpec["attempts"];
      }
    >
  >;
}

/** Las cinco observaciones de un PDF. */
export function makePdf(spec: PdfSpec): ObservationRecord[] {
  const base = {
    key: spec.key,
    ...(spec.inkRatio === undefined ? {} : { inkRatio: spec.inkRatio }),
  };
  const production = makeObservation({
    ...base,
    forcedAngle: null,
    verdict: spec.verdict ?? null,
    ...spec.production,
  });
  const forced = ([0, 90, 180, 270] as const).map((angle) => {
    const item = spec.forced[angle];
    return makeObservation({
      ...base,
      forcedAngle: angle,
      verdict: spec.verdict ?? null,
      attempts: item.attempts ?? [{ angle, spec: item.reading ?? {} }],
      final: item.final ?? {},
    });
  });
  return [production, ...forced];
}
