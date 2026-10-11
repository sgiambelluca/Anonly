/**
 * Fábricas de observaciones de M-O2 para los tests. No se usan fuera de `*.test.ts`.
 */

import type { PhysicalAngle } from "./osdVerdictCorpus.js";
import { corpusEntriesM2, type M2Entry } from "./osdVerdictCorpusM2.js";
import type { M2Attempt, M2Observation, PartFlags } from "./osdVerdictM2Run.js";
import type { Angle, SimGroup, SimPage, SimReading } from "./osdVerdictSim.js";

export function m2EntryOf(key: string): M2Entry {
  const found = corpusEntriesM2(["R1", "R2", "R3", "R4"]).find(
    (candidate) => candidate.key === key,
  );
  if (found === undefined) throw new Error(`sin entrada ${key}`);
  return found;
}

export interface M2ReadingSpec {
  readonly angle: number;
  readonly words?: number;
  readonly reliable?: number;
  readonly conf?: number | null;
  readonly ms?: number | null;
  readonly body?: PartFlags | null;
  readonly stamp?: PartFlags | null;
  readonly upscale?: number;
  readonly sha?: string;
}

export interface M2FinalSpec {
  readonly words?: number;
  readonly reliable?: number;
  readonly conf?: number | null;
  readonly unreadable?: boolean;
  readonly entityCounts?: Record<string, number>;
  readonly body?: (PartFlags & { dniEntity: boolean }) | null;
  readonly stamp?: (PartFlags & { dniEntity: boolean }) | null;
}

export interface M2ObservationSpec {
  readonly key: string;
  readonly forcedAngle: PhysicalAngle | null;
  readonly verdict?: { readonly orientation: number; readonly had: boolean };
  readonly ink?: number;
  readonly attempts?: ReadonlyArray<M2ReadingSpec>;
  readonly final?: M2FinalSpec;
  readonly finalAttemptOrder?: number | null;
  readonly fixtureSha?: string;
  readonly dpi?: number;
}

export function m2Attempt(order: number, spec: M2ReadingSpec, sha = "raster"): M2Attempt {
  const reliable = spec.reliable ?? 0;
  const words = spec.words ?? reliable;
  return {
    order,
    sourceOrientation: spec.angle,
    dispatchedOrientation: spec.angle,
    upscale: spec.upscale ?? 1,
    dpi: 150,
    widthPx: 100,
    heightPx: 200,
    imageBytes: 4,
    imageSha256: spec.sha ?? sha,
    terminal: "COMPLETED",
    durationMs: spec.ms === undefined ? 1000 : spec.ms,
    pageConfidence: spec.conf === undefined ? 0 : spec.conf,
    wordCount: words,
    reliableWordCount: reliable,
    confidences: Array.from({ length: words }, (_, i) => (i < reliable ? 0.9 : 0.3)),
    body: spec.body ?? null,
    stamp: spec.stamp ?? null,
  };
}

export function makeM2Observation(spec: M2ObservationSpec): M2Observation {
  const entry = m2EntryOf(spec.key);
  const natural = {
    orientation: spec.verdict?.orientation ?? 0,
    osdHadVerdict: spec.verdict?.had ?? false,
    inkRatio: spec.ink ?? 0.05,
  };
  const delivered =
    spec.forcedAngle === null
      ? natural
      : { orientation: spec.forcedAngle, osdHadVerdict: true, inkRatio: natural.inkRatio };
  const specs = spec.attempts ?? [{ angle: delivered.orientation }];
  const attempts = specs.map((item, order) => m2Attempt(order, item, "raster"));
  const final = spec.final ?? {};
  const synthetic = entry.kind !== "real";
  return {
    schema: 2,
    key: entry.key,
    kind: entry.kind,
    label: entry.label,
    sourceDpi: entry.sourceDpi,
    physicalRotation: entry.physicalRotation,
    correctAngle: entry.correctAngle,
    mode: spec.forcedAngle === null ? "production" : "forced-verdict",
    forcedAngle: spec.forcedAngle,
    fixtureSha256: spec.fixtureSha ?? `pdf-${entry.key}`,
    effectiveDpi: spec.dpi ?? 150,
    rawOsd: { orientation: null, confidence: null, error: null },
    natural,
    delivered,
    attempts,
    finalAttemptOrder: spec.finalAttemptOrder === undefined ? 0 : spec.finalAttemptOrder,
    final: {
      wordCount: final.words ?? 0,
      reliableWordCount: final.reliable ?? 0,
      pageConfidence: final.conf === undefined ? 0 : final.conf,
      unreadableInk: final.unreadable ?? false,
      confidences: [],
      entityCounts: final.entityCounts ?? {},
      body: final.body ?? null,
      stamp: final.stamp ?? null,
      ...(synthetic ? { words: [], entities: [] } : {}),
    },
    totalOcrDurationMs: attempts.reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
    readyMs: 1000,
    issues: [],
  };
}

export interface M2PageSpec {
  readonly key: string;
  readonly verdict?: { readonly orientation: number; readonly had: boolean };
  readonly ink?: number;
  readonly dpi?: number;
  readonly production?: Omit<M2ObservationSpec, "key" | "forcedAngle" | "verdict" | "ink">;
  /** Por ángulo forzado. */
  readonly forced: Readonly<
    Record<
      PhysicalAngle,
      {
        readonly reading?: Omit<M2ReadingSpec, "angle">;
        readonly attempts?: ReadonlyArray<M2ReadingSpec>;
        readonly final?: M2FinalSpec;
        readonly finalAttemptOrder?: number | null;
      }
    >
  >;
}

export function makeM2Page(spec: M2PageSpec): M2Observation[] {
  const base = {
    key: spec.key,
    ...(spec.verdict === undefined ? {} : { verdict: spec.verdict }),
    ...(spec.ink === undefined ? {} : { ink: spec.ink }),
    ...(spec.dpi === undefined ? {} : { dpi: spec.dpi }),
  };
  const production = makeM2Observation({ ...base, forcedAngle: null, ...spec.production });
  const forced = ([0, 90, 180, 270] as const).map((angle) => {
    const item = spec.forced[angle];
    return makeM2Observation({
      ...base,
      forcedAngle: angle,
      attempts: item.attempts ?? [{ angle, ...item.reading }],
      final: item.final ?? {},
      ...(item.finalAttemptOrder === undefined
        ? {}
        : { finalAttemptOrder: item.finalAttemptOrder }),
    });
  });
  return [production, ...forced];
}

// ------------------------------------------------------------------ páginas simuladas

/** Una lectura simulada: palabras confiables y confianza de página. */
export function reading(
  reliable: number,
  conf: number,
  extra: Partial<SimReading> = {},
): SimReading {
  return {
    words: reliable,
    reliable,
    conf,
    durationMs: 1000,
    ok: null,
    body: null,
    stamp: null,
    ...extra,
  };
}

export const EMPTY_READING: SimReading = reading(0, 0);

export function simPageOf(options: {
  readonly key?: string;
  readonly group?: SimGroup;
  readonly label?: string;
  readonly readings: Partial<Record<Angle, SimReading>>;
  readonly ink?: number;
  readonly dpi?: number;
  readonly had?: boolean;
  readonly orientation?: number;
  readonly correctAngle?: Angle | null;
  readonly measured?: SimPage["measured"];
  readonly warmMs?: SimPage["warmMs"];
}): SimPage {
  return {
    key: options.key ?? "P-150-0",
    group: options.group ?? "m1-text",
    label: options.label ?? "P",
    sourceDpi: options.dpi ?? 300,
    effectiveDpi: options.dpi ?? 300,
    ink: options.ink ?? 0.05,
    correctAngle: options.correctAngle === undefined ? 0 : options.correctAngle,
    natural: { had: options.had ?? false, orientation: options.orientation ?? 0 },
    readings: options.readings,
    warmMs: options.warmMs ?? {},
    measured: options.measured ?? {},
  };
}
