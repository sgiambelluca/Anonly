/**
 * Agregador puro de la fase `low-memory` de run-ocr-pool.sh (`run-ocr-pool-low.sh`): el pico de RSS
 * del árbol de procesos durante el OCR del perfil Bajo (setting `performancePreset: "low"`) sobre
 * `P2H`, tres corridas frías, y el máximo contra el techo de ADR-194 §7. Sin filesystem:
 * quien lo llama inyecta la lectura de corridas.
 *
 * Mismo criterio que `ultra`: nada ausente se convierte en cero y una corrida cuya configuración
 * efectiva no es el perfil Bajo es inválida.
 */

import { lowProfileMismatches, type EffectiveProfileEvidence } from "./ocrPoolLowProfile.js";
import {
  validityCaveatsOf,
  type UltraCaveat,
  type UltraSleepDetection,
  type UltraValidity,
} from "./ocrPoolUltraSummary.js";

export const LOW_MEMORY_ARM = "low";
export const LOW_MEMORY_PROFILE = "P2H";
export const LOW_MEMORY_ROUNDS = 3;
/**
 * Techo del nivel `low` (ADR-194 §7): 2,5 GB decimales, fijado por el mantenedor el 2026-10-07 con la
 * medición M-M1 (máximo de 2,045 GB sobre `P2H`). Es una alarma de regresión, no un límite de la app.
 */
export const LOW_MEMORY_CEILING_BYTES = 2_500_000_000;
const FINGERPRINT_KEYS = ["ocrQualitySha256", "occurrenceSha256", "groupSha256"] as const;
const NOT_REPORTED: UltraSleepDetection = {
  available: null,
  note: "tanda anterior al campo: no se sabe si la detección de suspensión estuvo activa",
};

export function lowRunId(round: number): string {
  return `memory-${LOW_MEMORY_ARM}-${LOW_MEMORY_PROFILE}-r${round}`;
}

/** La memoria sale de la fase `pool-rss` del spec: su artefacto lleva otro nombre que el run ID. */
export function lowArtifactName(round: number): string {
  return `ocr-pool-pool-rss-${LOW_MEMORY_ARM}-${LOW_MEMORY_PROFILE}-r${round}.json`;
}

/** GB decimales (ADR-194 §7), tres decimales. */
export function toDecimalGb(bytes: number): number {
  return Math.round(bytes / 1e6) / 1000;
}

export interface LowRunData {
  readonly runId?: string;
  readonly startedAtUtc?: string;
  readonly completedAtUtc?: string;
  readonly host?: Readonly<Record<string, unknown>>;
  readonly probe?: Readonly<Record<string, unknown>>;
  readonly effectiveProfile?: EffectiveProfileEvidence;
  readonly natural?: Readonly<Record<string, unknown>>;
}

export interface LowRunInput {
  readonly rounds: ReadonlyArray<number>;
  readonly smoke?: boolean;
  readonly readRun: (round: number) => LowRunData | null;
  readonly validity?: UltraValidity;
  readonly sleepDetection?: UltraSleepDetection;
  readonly caveats?: ReadonlyArray<UltraCaveat>;
}

export interface LowRunSummary {
  readonly runId: string;
  readonly startedAtUtc: string | null;
  readonly completedAtUtc: string | null;
  readonly rssPeakDuringOcrBytes: number;
  readonly rssPeakDuringOcrGbDecimal: number;
  readonly samplesInOcrWindow: number;
  /** RSS por tipo de proceso en la muestra del pico, para ver qué procesos lo componen. */
  readonly peakSampleBytesByProcessType: Readonly<Record<string, number>>;
  readonly peakSampleProcessCount: number | null;
  readonly ocrMs: number | null;
  readonly ocrPages: number | null;
  readonly busyRecognizersPeak: number | null;
  readonly busyOsdPeak: number | null;
  readonly configuredRecognizerPoolSize: number | null;
  readonly effectiveMaxLiveImageBytes: number | null;
  /** Pico de trabajos simultáneos por tipo (ocr-page, ner-page, render-page, pdf-parse...), de los eventos. */
  readonly workerPeakByType: Readonly<Record<string, number>>;
  /** Despachos de NER cuyo inicio cae dentro de la ventana OCR (NER corriendo o precalentado durante el OCR). */
  readonly nerJobsDispatchedDuringOcr: number;
  readonly renderJobsDispatchedDuringOcr: number;
  readonly effectiveProfile: EffectiveProfileEvidence;
  readonly host: Readonly<Record<string, unknown>> | null;
}

export interface LowSummary {
  readonly phase: "low-memory";
  readonly smoke: boolean;
  readonly arm: typeof LOW_MEMORY_ARM;
  readonly profile: typeof LOW_MEMORY_PROFILE;
  readonly expectedRounds: ReadonlyArray<number>;
  readonly runs: ReadonlyArray<LowRunSummary>;
  readonly maxRssPeakBytes: number | null;
  readonly maxRssPeakGbDecimal: number | null;
  readonly minRssPeakBytes: number | null;
  readonly medianRssPeakBytes: number | null;
  readonly ceiling: {
    readonly bytes: number;
    readonly gbDecimal: number;
    readonly source: "ADR-194 §7";
    /** null si no hay corridas válidas; con humo no se interpreta. */
    readonly maxExceedsCeiling: boolean | null;
    readonly marginBytes: number | null;
  };
  readonly fingerprintsIdenticalAcrossRuns: boolean | null;
  readonly sleepDetection: UltraSleepDetection;
  readonly validityCaveats: ReadonlyArray<string>;
  readonly excludedInvalidatedRunIds: ReadonlyArray<string>;
  readonly invalidationReasons: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly invalidRuns: ReadonlyArray<{ readonly runId: string; readonly reason: string }>;
  readonly missingRuns: ReadonlyArray<string>;
  readonly complete: boolean;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function median(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[sorted.length / 2 - 1] ?? 0) + upper) / 2;
}

interface PeakSample {
  readonly bytesByType: Record<string, number>;
  readonly processCount: number;
}

/** La muestra de mayor suma dentro de la ventana OCR, con su desglose por tipo de proceso. */
function peakSampleOf(samples: unknown): PeakSample | null {
  if (!Array.isArray(samples)) return null;
  let best: { sum: number; sample: PeakSample } | null = null;
  for (const item of samples as ReadonlyArray<unknown>) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const sum = num(record.sumWorkingSetSizeBytes);
    if (sum === null || !Array.isArray(record.perProcess)) continue;
    if (best !== null && sum <= best.sum) continue;
    const bytesByType: Record<string, number> = {};
    let processCount = 0;
    for (const process of record.perProcess as ReadonlyArray<unknown>) {
      if (typeof process !== "object" || process === null) continue;
      const entry = process as Record<string, unknown>;
      const bytes = num(entry.workingSetSizeBytes);
      if (typeof entry.type !== "string" || bytes === null) continue;
      bytesByType[entry.type] = (bytesByType[entry.type] ?? 0) + bytes;
      processCount += 1;
    }
    best = { sum, sample: { bytesByType, processCount } };
  }
  return best?.sample ?? null;
}

interface WorkerEvent {
  readonly type: string;
  readonly epochMs: number;
  readonly delta: number;
}

function workerEventsOf(value: unknown): ReadonlyArray<WorkerEvent> {
  if (!Array.isArray(value)) return [];
  return (value as ReadonlyArray<unknown>).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const epochMs = num(record.epochMs);
    const delta = num(record.delta);
    return typeof record.type === "string" && epochMs !== null && delta !== null
      ? [{ type: record.type, epochMs, delta }]
      : [];
  });
}

function workerPeaks(events: ReadonlyArray<WorkerEvent>): Record<string, number> {
  const active = new Map<string, number>();
  const peaks: Record<string, number> = {};
  for (const event of [...events].sort((a, b) => a.epochMs - b.epochMs)) {
    const next = Math.max(0, (active.get(event.type) ?? 0) + event.delta);
    active.set(event.type, next);
    peaks[event.type] = Math.max(peaks[event.type] ?? 0, next);
  }
  return peaks;
}

/** Métricas de una corrida o el motivo (string) por el que no sirve. */
function extract(runId: string, data: LowRunData): LowRunSummary | string {
  const probe = data.probe;
  if (probe === undefined) return "probe-missing";
  if (probe.failed === true) return "pipeline-failed";
  if ((num(probe.ocrPageFailures) ?? 0) > 0) return "ocr-page-failures";
  if ((num(probe.missingWordCachePages) ?? 0) > 0) return "word-cache-missing";
  const rssPeakDuringOcrBytes = num(data.natural?.rssPeakDuringOcrBytes);
  if (rssPeakDuringOcrBytes === null || rssPeakDuringOcrBytes <= 0) return "rss-peak-missing";
  const mismatches = lowProfileMismatches(data.effectiveProfile);
  if (mismatches.length > 0) return `effective-profile-mismatch: ${mismatches.join("; ")}`;
  if (probe.armLabel !== LOW_MEMORY_ARM || probe.profile !== LOW_MEMORY_PROFILE)
    return "run-is-not-low-p2h";
  const startedAt = num(probe.startedAt);
  const finishedAt = num(probe.finishedAt);
  const events = workerEventsOf(probe.workerEvents);
  const inWindow = (type: string): number =>
    startedAt === null || finishedAt === null
      ? 0
      : events.filter(
          (event) =>
            event.type === type &&
            event.delta > 0 &&
            event.epochMs >= startedAt &&
            event.epochMs <= finishedAt,
        ).length;
  const samples = data.natural?.samples;
  const peakSample = peakSampleOf(samples);
  return {
    runId: String(data.runId ?? runId),
    startedAtUtc: data.startedAtUtc ?? null,
    completedAtUtc: data.completedAtUtc ?? null,
    rssPeakDuringOcrBytes,
    rssPeakDuringOcrGbDecimal: toDecimalGb(rssPeakDuringOcrBytes),
    samplesInOcrWindow: Array.isArray(samples) ? samples.length : 0,
    peakSampleBytesByProcessType: peakSample?.bytesByType ?? {},
    peakSampleProcessCount: peakSample?.processCount ?? null,
    ocrMs: startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null,
    ocrPages: num(probe.ocrPageCount),
    busyRecognizersPeak: num(probe.effectiveBusyRecognizersPeak),
    busyOsdPeak: num(probe.effectiveBusyOsdPeak),
    configuredRecognizerPoolSize: num(probe.effectiveConfiguredRecognizerPoolSize),
    effectiveMaxLiveImageBytes: num(probe.effectiveMaxLiveImageBytes),
    workerPeakByType: workerPeaks(events),
    nerJobsDispatchedDuringOcr: inWindow("ner-page"),
    renderJobsDispatchedDuringOcr: inWindow("render-page"),
    effectiveProfile: data.effectiveProfile as EffectiveProfileEvidence,
    host: data.host ?? null,
  };
}

export function summarizeLow({
  rounds,
  smoke = false,
  readRun,
  validity = {},
  sleepDetection,
  caveats = [],
}: LowRunInput): LowSummary {
  const missingRuns: string[] = [];
  const invalidRuns: { runId: string; reason: string }[] = [];
  const runs: LowRunSummary[] = [];
  const probes: Array<Readonly<Record<string, unknown>>> = [];
  for (const round of rounds) {
    const id = lowRunId(round);
    const data = readRun(round);
    if (data === null) {
      missingRuns.push(id);
      continue;
    }
    const extracted = extract(id, data);
    if (typeof extracted === "string") {
      invalidRuns.push({ runId: id, reason: extracted });
      continue;
    }
    runs.push(extracted);
    if (data.probe !== undefined) probes.push(data.probe);
  }
  const peaks = runs.map((run) => run.rssPeakDuringOcrBytes);
  const maxRssPeakBytes = peaks.length > 0 ? Math.max(...peaks) : null;
  const fingerprintsIdentical =
    probes.length < 2
      ? null
      : FINGERPRINT_KEYS.every((key) => {
          const first = probes[0]?.[key];
          return (
            typeof first === "string" && first.length > 0 && probes.every((p) => p[key] === first)
          );
        });
  const detection = sleepDetection ?? NOT_REPORTED;
  return {
    phase: "low-memory",
    smoke,
    arm: LOW_MEMORY_ARM,
    profile: LOW_MEMORY_PROFILE,
    expectedRounds: rounds,
    runs,
    maxRssPeakBytes,
    maxRssPeakGbDecimal: maxRssPeakBytes === null ? null : toDecimalGb(maxRssPeakBytes),
    minRssPeakBytes: peaks.length > 0 ? Math.min(...peaks) : null,
    medianRssPeakBytes: median(peaks),
    ceiling: {
      bytes: LOW_MEMORY_CEILING_BYTES,
      gbDecimal: toDecimalGb(LOW_MEMORY_CEILING_BYTES),
      source: "ADR-194 §7",
      maxExceedsCeiling:
        maxRssPeakBytes === null ? null : maxRssPeakBytes > LOW_MEMORY_CEILING_BYTES,
      marginBytes: maxRssPeakBytes === null ? null : LOW_MEMORY_CEILING_BYTES - maxRssPeakBytes,
    },
    fingerprintsIdenticalAcrossRuns: fingerprintsIdentical,
    sleepDetection: detection,
    validityCaveats: validityCaveatsOf(detection, caveats),
    excludedInvalidatedRunIds: [...(validity.affectedRunIds ?? [])].sort(),
    invalidationReasons: validity.reasonsByRunId ?? {},
    invalidRuns,
    missingRuns,
    complete: rounds.length > 0 && missingRuns.length === 0 && invalidRuns.length === 0,
  };
}

/** Línea final de la corrida: lo que decide, en una línea. */
export function lowResultLine(summary: LowSummary): string {
  const codes = summary.validityCaveats.map((caveat) => caveat.split(":")[0] ?? caveat);
  const max =
    summary.maxRssPeakGbDecimal === null ? "n/a" : `${summary.maxRssPeakGbDecimal.toFixed(3)}GB`;
  const exceeds =
    summary.ceiling.maxExceedsCeiling === null ? "n/a" : String(summary.ceiling.maxExceedsCeiling);
  return `complete=${summary.complete}${summary.smoke ? " (humo)" : ""} max=${max} techo=${summary.ceiling.gbDecimal.toFixed(1)}GB supera=${exceeds} salvedades=${codes.length}${codes.length > 0 ? ` [${codes.join(", ")}]` : ""}`;
}
