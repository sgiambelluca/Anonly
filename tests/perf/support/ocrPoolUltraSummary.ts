/**
 * Agregador puro de la fase `ultra` de run-ocr-pool.sh. Sin filesystem: quien lo llama inyecta la
 * lectura de corridas, para poder probarlo con datos en memoria.
 */

import {
  estimateContradictedByOccupancy,
  impliedMaxReservationBytesPerPage,
  pagesAdmittedByBudget,
  RESERVATION_ESTIMATE_BASIS,
} from "./ocrReservation.js";

export const ULTRA_ARMS: ReadonlyArray<string> = ["2", "4", "4b", "6", "6b"];
export const ULTRA_ROUNDS = 3;
export const CANCELLATION_SLA_MS = 200;
const FINGERPRINT_KEYS = ["ocrQualitySha256", "occurrenceSha256", "groupSha256"] as const;

export interface UltraReservationSummary {
  readonly basis: string;
  readonly pagesObserved: number;
  /** null si ninguna corrida trae estimaciones completas; el motivo queda en `unavailableReason`. */
  readonly perPageBytes: {
    readonly min: number;
    readonly median: number;
    readonly max: number;
  } | null;
  readonly pagesAdmittedByBudget: Readonly<
    Record<
      string,
      {
        readonly budgetBytes: number;
        readonly atMin: number | null;
        readonly atMedian: number | null;
        readonly atMax: number | null;
      }
    >
  > | null;
  readonly unavailableReason: string | null;
}

/** `available: null` = la tanda no informó (anterior al campo): no es "sin suspensión". */
export interface UltraSleepDetection {
  readonly available: boolean | null;
  readonly note: string | null;
}

export interface UltraCaveat {
  readonly id: string;
  readonly note: string;
}

const SLEEP_NOT_REPORTED: UltraSleepDetection = {
  available: null,
  note: "tanda anterior al campo: no se sabe si la detección de suspensión estuvo activa",
};

export type UltraKind = "time" | "memory" | "cancel";

export interface UltraRunData {
  readonly runId?: string;
  readonly probe?: Readonly<Record<string, unknown>>;
  readonly timed?: Readonly<Record<string, unknown>>;
  readonly natural?: Readonly<Record<string, unknown>>;
}

export interface UltraCorpus {
  readonly profiles: ReadonlyArray<string>;
  readonly r2Present: boolean;
  readonly r2Note: string | null;
}

export interface UltraValidity {
  readonly affectedRunIds?: ReadonlyArray<string>;
  readonly reasonsByRunId?: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface UltraArmSummary {
  readonly configuredPoolSize: number | null;
  readonly effectiveMaxLiveImageBytes: number | null;
  readonly time: {
    readonly runs: ReadonlyArray<{
      readonly runId: string;
      readonly readyMs: number;
      readonly ocrMs: number;
      readonly busyRecognizersPeak: number | null;
    }>;
    readonly medianReadyMs: number | null;
    readonly medianOcrMs: number | null;
  };
  readonly memory: {
    readonly runs: ReadonlyArray<{
      readonly runId: string;
      readonly rssPeakDuringOcrBytes: number;
      readonly busyRecognizersPeak: number | null;
    }>;
    readonly medianRssPeakDuringOcrBytes: number | null;
  };
  readonly occupancy: {
    readonly busyRecognizersPeakMax: number | null;
    readonly busyRecognizersPeakMin: number | null;
    readonly reachedPoolSize: boolean | null;
    /** floor(presupuesto / pico de ocupados): tope de lo que pudo reservar cada página, por observación. */
    readonly impliedMaxReservationBytesPerPage: number | null;
    /** true: la ocupación demuestra que la estimación con el DPI configurado sobreestima. */
    readonly estimateContradictedByOccupancy: boolean | null;
  };
  readonly fingerprints: {
    readonly identicalToArm2: boolean;
    readonly comparedPairs: number;
    readonly mismatches: ReadonlyArray<{ readonly runId: string; readonly key: string }>;
  };
  readonly cancellation: {
    readonly runId: string;
    readonly activeOcrJobsAtCancellation: number;
    readonly cancelLatencyMs: number | null;
    readonly withinSla: boolean;
  } | null;
}

export interface UltraSummary {
  readonly phase: "ultra";
  readonly corpus: UltraCorpus;
  readonly cancellationSlaMs: number;
  readonly byCorpus: Readonly<
    Record<
      string,
      {
        readonly arms: Readonly<Record<string, UltraArmSummary>>;
        readonly reservation: UltraReservationSummary;
      }
    >
  >;
  /** null si la plataforma no informó (macOS, donde la detección no cambió). */
  readonly sleepDetection: UltraSleepDetection;
  readonly validityCaveats: ReadonlyArray<string>;
  readonly excludedInvalidatedRunIds: ReadonlyArray<string>;
  readonly invalidationReasons: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly invalidRuns: ReadonlyArray<{ readonly runId: string; readonly reason: string }>;
  readonly missingRuns: ReadonlyArray<string>;
  /** Brazos que no tienen ninguna corrida en ningún corpus (p. ej. una tanda anterior a `4b`). */
  readonly missingArms: ReadonlyArray<string>;
  readonly qualityExactAcrossArms: boolean;
  readonly complete: boolean;
}

export interface UltraInput {
  readonly readRun: (
    kind: UltraKind,
    arm: string,
    profile: string,
    round: number,
  ) => { readonly data: UltraRunData; readonly source: string } | null;
  readonly corpus: UltraCorpus;
  readonly validity?: UltraValidity;
  readonly sleepDetection?: UltraSleepDetection;
  /** Salvedades registradas por el runner (guardas o prevención de suspensión no disponibles). */
  readonly caveats?: ReadonlyArray<UltraCaveat>;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function median(values: ReadonlyArray<number>): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const upper = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[sorted.length / 2 - 1] ?? 0) + upper) / 2;
}

interface Metrics {
  readonly readyMs: number;
  readonly ocrMs: number;
  readonly rssPeakBytes: number;
  readonly cancelActiveJobs: number;
  readonly cancelLatencyMs: number | null;
}

interface ValidRun<M> {
  readonly runId: string;
  readonly probe: Readonly<Record<string, unknown>>;
  readonly metrics: M;
}

type TimeMetrics = Pick<Metrics, "readyMs" | "ocrMs">;
type MemoryMetrics = Pick<Metrics, "rssPeakBytes">;
type CancelMetrics = Pick<Metrics, "cancelActiveJobs" | "cancelLatencyMs">;

/** Extrae las métricas de una corrida, o devuelve el motivo (string) por el que no sirve. */
type Extractor<M> = (data: UltraRunData, probe: Readonly<Record<string, unknown>>) => M | string;

function commonProblem(probe: Readonly<Record<string, unknown>>): string | null {
  if (probe.failed === true) return "pipeline-failed";
  if ((num(probe.ocrPageFailures) ?? 0) > 0) return "ocr-page-failures";
  if ((num(probe.missingWordCachePages) ?? 0) > 0) return "word-cache-missing";
  return null;
}

const extractTime: Extractor<TimeMetrics> = (data, probe) => {
  const problem = commonProblem(probe);
  if (problem !== null) return problem;
  if (data.timed?.ok !== true) return "timed-run-not-ok";
  const readyMs = num(data.timed.totalMs);
  if (readyMs === null) return "ready-time-missing";
  const intervals = data.timed.intervalsMs as Readonly<Record<string, unknown>> | undefined;
  const ocrMs = num(intervals?.ocrMs);
  if (ocrMs === null) return "ocr-time-missing";
  return { readyMs, ocrMs };
};

const extractMemory: Extractor<MemoryMetrics> = (data, probe) => {
  const problem = commonProblem(probe);
  if (problem !== null) return problem;
  const rssPeakBytes = num(data.natural?.rssPeakDuringOcrBytes);
  return rssPeakBytes === null ? "rss-peak-missing" : { rssPeakBytes };
};

const extractCancel: Extractor<CancelMetrics> = (_data, probe) => {
  if (probe.failed === true) return "pipeline-failed";
  const cancelActiveJobs = num(probe.cancelActiveOcrJobs);
  if (cancelActiveJobs === null) return "cancel-active-jobs-missing";
  return { cancelActiveJobs, cancelLatencyMs: num(probe.cancelLatencyMs) };
};

const BUDGETS = {
  "128MiB": 128 * 1024 * 1024,
  "136MiB": 136 * 1024 * 1024,
  "200MiB": 200 * 1024 * 1024,
} as const;

/** Estimaciones por página de la primera corrida que las trae completas, o el motivo de que no haya. */
export function completeEstimates(probes: ReadonlyArray<Readonly<Record<string, unknown>>>): {
  readonly bytes: ReadonlyArray<number> | null;
  readonly reason: string | null;
} {
  let firstReason: string | null = null;
  for (const probe of probes) {
    const estimates = Array.isArray(probe.pageRgbaEstimates) ? probe.pageRgbaEstimates : [];
    const bytes = estimates.map((item: unknown) =>
      typeof item === "object" && item !== null
        ? num((item as Record<string, unknown>).estimatedBytes)
        : null,
    );
    if (bytes.length === 0 || bytes.some((value) => value === null)) {
      firstReason ??=
        bytes.length === 0 ? "sin paginas OCR observadas" : "estimatedBytes null en alguna pagina";
      continue;
    }
    return { bytes: bytes.filter((value): value is number => value !== null), reason: null };
  }
  return { bytes: null, reason: firstReason ?? "sin corridas validas" };
}

/** Reserva estimada por página (cota superior al DPI configurado) y cuántas caben en cada presupuesto. */
export function summarizeReservation(
  probes: ReadonlyArray<Readonly<Record<string, unknown>>>,
): UltraReservationSummary {
  const base = { basis: RESERVATION_ESTIMATE_BASIS };
  const { bytes: known, reason } = completeEstimates(probes);
  if (known === null) {
    return {
      ...base,
      pagesObserved: 0,
      perPageBytes: null,
      pagesAdmittedByBudget: null,
      unavailableReason: reason,
    };
  }
  const perPage = {
    min: Math.min(...known),
    median: median([...known]) ?? 0,
    max: Math.max(...known),
  };
  return {
    ...base,
    pagesObserved: known.length,
    perPageBytes: perPage,
    pagesAdmittedByBudget: Object.fromEntries(
      Object.entries(BUDGETS).map(([label, budgetBytes]) => [
        label,
        {
          budgetBytes,
          atMin: pagesAdmittedByBudget(budgetBytes, perPage.min),
          atMedian: pagesAdmittedByBudget(budgetBytes, perPage.median),
          atMax: pagesAdmittedByBudget(budgetBytes, perPage.max),
        },
      ]),
    ),
    unavailableReason: null,
  };
}

/** Todas las salvedades de validez: la de la detección de suspensión y las del runner. */
export function validityCaveatsOf(
  sleepDetection: UltraSleepDetection,
  caveats: ReadonlyArray<UltraCaveat>,
): string[] {
  return [...sleepCaveats(sleepDetection), ...caveats.map((item) => `${item.id}: ${item.note}`)];
}

/**
 * Línea final de la corrida: `complete` no cambia de significado, y las salvedades se ven al lado
 * (cantidad y códigos). `complete: null` es el humo, que no agrega corridas.
 */
export function ultraResultLine(input: {
  readonly complete: boolean | null;
  readonly validityCaveats: ReadonlyArray<string>;
}): string {
  const codes = input.validityCaveats.map((caveat) => caveat.split(":")[0] ?? caveat);
  const complete = input.complete === null ? "n/a" : String(input.complete);
  return `complete=${complete} salvedades=${codes.length}${codes.length > 0 ? ` [${codes.join(", ")}]` : ""}`;
}

function sleepCaveats(detection: UltraSleepDetection): string[] {
  if (detection.available === true) return [];
  const id =
    detection.available === false ? "sleep-detection-unavailable" : "sleep-detection-unknown";
  return [`${id}: ${detection.note ?? "no se pudo descartar una suspension durante las corridas"}`];
}

function armHasNoRuns(missingRuns: ReadonlyArray<string>, arm: string, profile: string): boolean {
  const missing = new Set(missingRuns);
  const expected: string[] = [`cancel-${arm}-${profile}-r0`];
  for (let round = 0; round < ULTRA_ROUNDS; round += 1) {
    expected.push(`time-${arm}-${profile}-r${round}`, `memory-${arm}-${profile}-r${round}`);
  }
  return expected.every((id) => missing.has(id));
}

export function summarizeUltra({
  readRun,
  corpus,
  validity = {},
  sleepDetection,
  caveats = [],
}: UltraInput): UltraSummary {
  const missingRuns: string[] = [];
  const invalidRuns: { runId: string; reason: string }[] = [];
  let exact = true;
  const byCorpus: Record<
    string,
    { arms: Record<string, UltraArmSummary>; reservation: UltraReservationSummary }
  > = {};

  const load = <M>(
    kind: UltraKind,
    arm: string,
    profile: string,
    round: number,
    extract: Extractor<M>,
  ): ValidRun<M> | null => {
    const id = `${kind}-${arm}-${profile}-r${round}`;
    const found = readRun(kind, arm, profile, round);
    if (found === null) {
      missingRuns.push(id);
      return null;
    }
    const probe = found.data.probe;
    const extracted = probe === undefined ? "probe-missing" : extract(found.data, probe);
    if (typeof extracted === "string" || probe === undefined) {
      invalidRuns.push({
        runId: id,
        reason: typeof extracted === "string" ? extracted : "probe-missing",
      });
      return null;
    }
    return { runId: String(found.data.runId ?? id), probe, metrics: extracted };
  };
  const present = <M>(runs: ReadonlyArray<ValidRun<M> | null>): ValidRun<M>[] =>
    runs.filter((run): run is ValidRun<M> => run !== null);

  for (const profile of corpus.profiles) {
    const timeRuns: Record<string, Array<ValidRun<TimeMetrics> | null>> = {};
    const memoryRuns: Record<string, Array<ValidRun<MemoryMetrics> | null>> = {};
    const cancelRuns: Record<string, ValidRun<CancelMetrics> | null> = {};
    for (const arm of ULTRA_ARMS) {
      timeRuns[arm] = [];
      memoryRuns[arm] = [];
      for (let round = 0; round < ULTRA_ROUNDS; round += 1) {
        timeRuns[arm]?.push(load("time", arm, profile, round, extractTime));
        memoryRuns[arm]?.push(load("memory", arm, profile, round, extractMemory));
      }
      cancelRuns[arm] = load("cancel", arm, profile, 0, extractCancel);
    }

    const allRuns = ULTRA_ARMS.flatMap((arm) => [
      ...present(timeRuns[arm] ?? []),
      ...present(memoryRuns[arm] ?? []),
    ]);
    const allProbes = allRuns.map((run) => run.probe);
    const corpusEstimates = completeEstimates(allProbes).bytes;
    const arms: Record<string, UltraArmSummary> = {};
    for (const arm of ULTRA_ARMS) {
      const time = present(timeRuns[arm] ?? []);
      const memory = present(memoryRuns[arm] ?? []);
      const cancel = cancelRuns[arm] ?? null;

      const mismatches: { runId: string; key: string }[] = [];
      let comparedPairs = 0;
      if (arm !== "2") {
        const compare = (byArm: Record<string, ReadonlyArray<ValidRun<unknown> | null>>): void => {
          for (let round = 0; round < ULTRA_ROUNDS; round += 1) {
            const base = byArm["2"]?.[round]?.probe;
            const candidateRun = byArm[arm]?.[round];
            if (base === undefined || candidateRun === undefined || candidateRun === null) continue;
            comparedPairs += 1;
            for (const key of FINGERPRINT_KEYS) {
              const reference = base[key];
              const same =
                typeof reference === "string" &&
                reference.length > 0 &&
                candidateRun.probe[key] === reference;
              if (!same) mismatches.push({ runId: candidateRun.runId, key });
            }
          }
        };
        compare(timeRuns);
        compare(memoryRuns);
      }
      if (mismatches.length > 0) exact = false;

      const busyPeaks = [...time, ...memory].flatMap((run) => {
        const peak = num(run.probe.effectiveBusyRecognizersPeak);
        return peak === null ? [] : [peak];
      });
      const busyPeakMax = busyPeaks.length > 0 ? Math.max(...busyPeaks) : null;
      const anyProbe = [...time, ...memory][0]?.probe;
      const budgetBytes = num(anyProbe?.effectiveMaxLiveImageBytes);

      arms[arm] = {
        configuredPoolSize: num(anyProbe?.effectiveConfiguredRecognizerPoolSize),
        effectiveMaxLiveImageBytes: num(anyProbe?.effectiveMaxLiveImageBytes),
        time: {
          runs: time.map((run) => ({
            runId: run.runId,
            readyMs: run.metrics.readyMs,
            ocrMs: run.metrics.ocrMs,
            busyRecognizersPeak: num(run.probe.effectiveBusyRecognizersPeak),
          })),
          medianReadyMs: median(time.map((run) => run.metrics.readyMs)),
          medianOcrMs: median(time.map((run) => run.metrics.ocrMs)),
        },
        memory: {
          runs: memory.map((run) => ({
            runId: run.runId,
            rssPeakDuringOcrBytes: run.metrics.rssPeakBytes,
            busyRecognizersPeak: num(run.probe.effectiveBusyRecognizersPeak),
          })),
          medianRssPeakDuringOcrBytes: median(memory.map((run) => run.metrics.rssPeakBytes)),
        },
        occupancy: {
          busyRecognizersPeakMax: busyPeakMax,
          busyRecognizersPeakMin: busyPeaks.length > 0 ? Math.min(...busyPeaks) : null,
          reachedPoolSize: busyPeakMax === null ? null : busyPeakMax >= Number.parseInt(arm, 10),
          impliedMaxReservationBytesPerPage:
            budgetBytes === null
              ? null
              : impliedMaxReservationBytesPerPage(budgetBytes, busyPeakMax),
          estimateContradictedByOccupancy:
            corpusEstimates === null || budgetBytes === null
              ? null
              : estimateContradictedByOccupancy(corpusEstimates, busyPeakMax, budgetBytes),
        },
        fingerprints: {
          identicalToArm2: arm === "2" ? true : mismatches.length === 0 && comparedPairs > 0,
          comparedPairs,
          mismatches,
        },
        cancellation:
          cancel === null
            ? null
            : {
                runId: cancel.runId,
                activeOcrJobsAtCancellation: cancel.metrics.cancelActiveJobs,
                cancelLatencyMs: cancel.metrics.cancelLatencyMs,
                withinSla:
                  cancel.metrics.cancelActiveJobs > 0 &&
                  cancel.metrics.cancelLatencyMs !== null &&
                  cancel.metrics.cancelLatencyMs <= CANCELLATION_SLA_MS,
              },
      };
    }
    byCorpus[profile] = {
      arms,
      reservation: summarizeReservation(allProbes),
    };
  }

  return {
    phase: "ultra",
    corpus,
    cancellationSlaMs: CANCELLATION_SLA_MS,
    byCorpus,
    sleepDetection: sleepDetection ?? SLEEP_NOT_REPORTED,
    validityCaveats: validityCaveatsOf(sleepDetection ?? SLEEP_NOT_REPORTED, caveats),
    excludedInvalidatedRunIds: [...(validity.affectedRunIds ?? [])].sort(),
    invalidationReasons: validity.reasonsByRunId ?? {},
    invalidRuns,
    missingRuns,
    missingArms: ULTRA_ARMS.filter(
      (arm) =>
        corpus.profiles.length > 0 &&
        corpus.profiles.every((profile) => armHasNoRuns(missingRuns, arm, profile)),
    ),
    qualityExactAcrossArms: exact,
    complete:
      missingRuns.length === 0 && invalidRuns.length === 0 && exact && corpus.profiles.length > 0,
  };
}

/** La memoria de ultra sale de la fase `pool-rss` del spec: su artefacto lleva otro nombre que el run ID. */
export function ultraArtifactName(kind: UltraKind, runId: string): string {
  return kind === "memory"
    ? `ocr-pool-pool-rss-${runId.slice("memory-".length)}.json`
    : `ocr-pool-${runId}.json`;
}

export interface UltraSource {
  readonly name: string;
  readonly invalidRunIds: ReadonlySet<string>;
}

/** Busca la corrida en las carpetas por orden de prioridad, saltando los run IDs invalidados de cada una. */
export function createUltraReader(
  sources: ReadonlyArray<UltraSource>,
  readJson: (sourceName: string, fileName: string) => UltraRunData | null,
): UltraInput["readRun"] {
  return (kind, arm, profile, round) => {
    const id = `${kind}-${arm}-${profile}-r${round}`;
    for (const source of sources) {
      if (source.invalidRunIds.has(id)) continue;
      const data = readJson(source.name, ultraArtifactName(kind, id));
      if (data !== null) return { data, source: source.name };
    }
    return null;
  };
}
