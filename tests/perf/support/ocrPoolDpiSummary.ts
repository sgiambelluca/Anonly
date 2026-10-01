/**
 * Agregador puro de la fase 2 (tiempo y memoria) de la campaña de DPI descendente
 * (docs/roadmap/OCR_DPI_Descendente_Campana_Plan.md §5.2), sobre las corridas de `ocr-pool.spec.ts`
 * con DPI pedido. Mismo criterio que el de `ultra`: nada ausente se convierte en cero, y una
 * corrida sin DPI efectivo demostrado es inválida. Sin filesystem.
 */

import type { DispatchEvidence, ChainEvidence } from "./ocrDpiDownChain.js";
import {
  CANCELLATION_SLA_MS,
  completeEstimates,
  median,
  summarizeReservation,
  validityCaveatsOf,
  type UltraCaveat,
  type UltraReservationSummary,
  type UltraRunData,
  type UltraSleepDetection,
  type UltraValidity,
} from "./ocrPoolUltraSummary.js";
import {
  estimateContradictedByOccupancy,
  impliedMaxReservationBytesPerPage,
} from "./ocrReservation.js";

export const DPI_POOL_ARMS: ReadonlyArray<string> = ["2", "4", "6"];
export const DPI_ROUNDS = 3;
export const REFERENCE_DPI = 300;
export const REFERENCE_ARM = "2";
const FINGERPRINT_KEYS = ["ocrQualitySha256", "occurrenceSha256", "groupSha256"] as const;
const BUDGET_128_MIB = 128 * 1024 * 1024;

export type DpiRunKind = "time" | "memory" | "cancel";

export interface DpiRunData extends UltraRunData {
  readonly requestedDpi?: number | null;
  readonly dpiEvidence?: {
    readonly dispatch?: DispatchEvidence;
    readonly chain?: ChainEvidence;
  };
}

export interface DpiPoolInput {
  readonly readRun: (
    kind: DpiRunKind,
    arm: string,
    profile: string,
    dpi: number,
    round: number,
  ) => { readonly data: DpiRunData; readonly source: string } | null;
  readonly profiles: ReadonlyArray<string>;
  readonly profileNotes: ReadonlyArray<{ readonly profile: string; readonly note: string }>;
  /** Pools a medir (por defecto 2, 4 y 6). */
  readonly arms: ReadonlyArray<string>;
  /** DPI a medir; el 300 tiene que estar: es el control. */
  readonly dpis: ReadonlyArray<number>;
  readonly validity?: UltraValidity;
  readonly sleepDetection?: UltraSleepDetection;
  readonly caveats?: ReadonlyArray<UltraCaveat>;
}

export interface DpiArmSummary {
  readonly dpi: number;
  readonly pool: string;
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
    readonly impliedMaxReservationBytesPerPage: number | null;
    readonly estimateContradictedByOccupancy: boolean | null;
  };
  /** DPI efectivo demostrado por despacho en todas las corridas de la combinación. */
  readonly dpiEvidence: {
    readonly runsWithEvidence: number;
    readonly effectiveDpis: ReadonlyArray<number>;
    readonly allDispatchesAtExpectedDpi: boolean | null;
    readonly allDispatchesAtRequestedDpi: boolean | null;
    readonly recoverySteps: number | null;
    readonly upscaledDispatches: number | null;
    readonly unreadableInkPages: number | null;
  };
  /** Huellas contra `dpi 300` con dos reconocedores del mismo corpus (misma ronda). */
  readonly fingerprintsVsReference: {
    /** Con el DPI de control las huellas tienen que coincidir; con otro DPI distinguen o no, y se informa. */
    readonly expectedIdentical: boolean;
    readonly comparedPairs: number;
    readonly identical: boolean | null;
    readonly mismatchedKeys: ReadonlyArray<string>;
  };
  readonly cancellation: {
    readonly runId: string;
    readonly activeOcrJobsAtCancellation: number;
    readonly cancelLatencyMs: number | null;
    readonly withinSla: boolean;
  } | null;
  /** Contra el mismo pool a 300 dpi: lo que se ahorra (cociente < 1) o no. */
  readonly versusControlDpi: {
    readonly rssPeakRatio: number | null;
    readonly rssPeakDeltaBytes: number | null;
    readonly ocrMsRatio: number | null;
    readonly readyMsRatio: number | null;
  } | null;
}

export interface DpiPoolSummary {
  readonly phase: "ultra-dpi";
  readonly cancellationSlaMs: number;
  readonly profiles: ReadonlyArray<string>;
  readonly profileNotes: ReadonlyArray<{ readonly profile: string; readonly note: string }>;
  readonly dpis: ReadonlyArray<number>;
  readonly pools: ReadonlyArray<string>;
  readonly byProfile: Readonly<
    Record<
      string,
      {
        readonly byDpi: Readonly<
          Record<
            string,
            {
              readonly pools: Readonly<Record<string, DpiArmSummary>>;
              readonly reservation: UltraReservationSummary;
              /** Cuántas páginas de la reserva estimada de este DPI entran en 128 MiB (mediana de página). */
              readonly pagesAdmittedAt128MiB: number | null;
            }
          >
        >;
      }
    >
  >;
  readonly sleepDetection: UltraSleepDetection;
  readonly validityCaveats: ReadonlyArray<string>;
  readonly excludedInvalidatedRunIds: ReadonlyArray<string>;
  readonly invalidationReasons: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly invalidRuns: ReadonlyArray<{ readonly runId: string; readonly reason: string }>;
  readonly missingRuns: ReadonlyArray<string>;
  /** Las huellas con el DPI de control y distinto pool coinciden con las del pool 2. */
  readonly qualityExactAtControlDpi: boolean;
  readonly complete: boolean;
}

const SLEEP_NOT_REPORTED: UltraSleepDetection = {
  available: null,
  note: "tanda anterior al campo: no se sabe si la detección de suspensión estuvo activa",
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function dpiRunId(
  kind: DpiRunKind,
  arm: string,
  profile: string,
  dpi: number,
  round: number,
): string {
  return `${kind}-${arm}-${profile}-d${dpi}-r${round}`;
}

/** La memoria sale de la fase `pool-rss` del spec; su artefacto lleva otro nombre que el run ID. */
export function dpiArtifactName(kind: DpiRunKind, runId: string): string {
  return kind === "memory"
    ? `ocr-pool-pool-rss-${runId.slice("memory-".length)}.json`
    : `ocr-pool-${runId}.json`;
}

type Probe = Readonly<Record<string, unknown>>;
interface ValidRun<M> {
  readonly runId: string;
  readonly probe: Probe;
  readonly metrics: M;
  readonly evidence: DpiRunData["dpiEvidence"];
}
type Extractor<M> = (data: DpiRunData, probe: Probe, dpi: number) => M | string;

function commonProblem(data: DpiRunData, probe: Probe, dpi: number): string | null {
  if (probe.failed === true) return "pipeline-failed";
  if ((num(probe.ocrPageFailures) ?? 0) > 0) return "ocr-page-failures";
  if ((num(probe.missingWordCachePages) ?? 0) > 0) return "word-cache-missing";
  if (num(probe.requestedDpi) !== dpi && num(data.requestedDpi) !== dpi)
    return "requested-dpi-not-recorded";
  const dispatch = data.dpiEvidence?.dispatch;
  if (dispatch === undefined) return "dpi-evidence-missing";
  if (dispatch.issues.length > 0) return `dpi-evidence: ${dispatch.issues.join("; ")}`;
  if (!dispatch.dispatchesAtExpectedDpi) return "effective-dpi-differs-from-expected";
  return null;
}

const extractTime: Extractor<{ readyMs: number; ocrMs: number }> = (data, probe, dpi) => {
  const problem = commonProblem(data, probe, dpi);
  if (problem !== null) return problem;
  if (data.timed?.ok !== true) return "timed-run-not-ok";
  const readyMs = num(data.timed.totalMs);
  if (readyMs === null) return "ready-time-missing";
  const intervals = data.timed.intervalsMs as Readonly<Record<string, unknown>> | undefined;
  const ocrMs = num(intervals?.ocrMs);
  if (ocrMs === null) return "ocr-time-missing";
  return { readyMs, ocrMs };
};

const extractMemory: Extractor<{ rssPeakBytes: number }> = (data, probe, dpi) => {
  const problem = commonProblem(data, probe, dpi);
  if (problem !== null) return problem;
  const rssPeakBytes = num(data.natural?.rssPeakDuringOcrBytes);
  return rssPeakBytes === null ? "rss-peak-missing" : { rssPeakBytes };
};

const extractCancel: Extractor<{ activeJobs: number; latencyMs: number | null }> = (
  _data,
  probe,
) => {
  if (probe.failed === true) return "pipeline-failed";
  const activeJobs = num(probe.cancelActiveOcrJobs);
  if (activeJobs === null) return "cancel-active-jobs-missing";
  return { activeJobs, latencyMs: num(probe.cancelLatencyMs) };
};

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0
    ? null
    : numerator / denominator;
}

export function summarizeDpiPool(input: DpiPoolInput): DpiPoolSummary {
  const { arms, profiles } = input;
  // El control (300) primero: los demás DPI se comparan contra su resumen.
  const dpis = [...input.dpis].sort((a, b) =>
    a === REFERENCE_DPI ? -1 : b === REFERENCE_DPI ? 1 : b - a,
  );
  const validity = input.validity ?? {};
  const missingRuns: string[] = [];
  const invalidRuns: { runId: string; reason: string }[] = [];
  let qualityExact = true;

  const load = <M>(
    kind: DpiRunKind,
    arm: string,
    profile: string,
    dpi: number,
    round: number,
    extract: Extractor<M>,
  ): ValidRun<M> | null => {
    const id = dpiRunId(kind, arm, profile, dpi, round);
    const found = input.readRun(kind, arm, profile, dpi, round);
    if (found === null) {
      missingRuns.push(id);
      return null;
    }
    const probe = found.data.probe;
    const extracted = probe === undefined ? "probe-missing" : extract(found.data, probe, dpi);
    if (typeof extracted === "string" || probe === undefined) {
      invalidRuns.push({
        runId: id,
        reason: typeof extracted === "string" ? extracted : "probe-missing",
      });
      return null;
    }
    return {
      runId: String(found.data.runId ?? id),
      probe,
      metrics: extracted,
      evidence: found.data.dpiEvidence,
    };
  };
  const present = <M>(runs: ReadonlyArray<ValidRun<M> | null>): ValidRun<M>[] =>
    runs.filter((run): run is ValidRun<M> => run !== null);

  const byProfile: Record<
    string,
    { byDpi: Record<string, DpiPoolSummary["byProfile"][string]["byDpi"][string]> }
  > = {};
  for (const profile of profiles) {
    // Corridas por (dpi, pool): se cargan todas primero, porque las huellas comparan contra 300/2.
    const time: Record<string, Array<ValidRun<{ readyMs: number; ocrMs: number }> | null>> = {};
    const memory: Record<string, Array<ValidRun<{ rssPeakBytes: number }> | null>> = {};
    const cancel: Record<
      string,
      ValidRun<{ activeJobs: number; latencyMs: number | null }> | null
    > = {};
    const key = (dpi: number, arm: string): string => `${dpi}/${arm}`;
    for (const dpi of dpis)
      for (const arm of arms) {
        time[key(dpi, arm)] = [];
        memory[key(dpi, arm)] = [];
        for (let round = 0; round < DPI_ROUNDS; round += 1) {
          time[key(dpi, arm)]?.push(load("time", arm, profile, dpi, round, extractTime));
          memory[key(dpi, arm)]?.push(load("memory", arm, profile, dpi, round, extractMemory));
        }
        cancel[key(dpi, arm)] = load("cancel", arm, profile, dpi, 0, extractCancel);
      }

    const summaries: Record<string, DpiArmSummary> = {};
    for (const dpi of dpis)
      for (const arm of arms) {
        const timeRuns = present(time[key(dpi, arm)] ?? []);
        const memoryRuns = present(memory[key(dpi, arm)] ?? []);
        const cancelRun = cancel[key(dpi, arm)] ?? null;
        const runs = [...timeRuns, ...memoryRuns];

        const mismatched: string[] = [];
        let comparedPairs = 0;
        if (!(dpi === REFERENCE_DPI && arm === REFERENCE_ARM)) {
          const compare = (
            byKey: Record<string, ReadonlyArray<ValidRun<unknown> | null>>,
          ): void => {
            for (let round = 0; round < DPI_ROUNDS; round += 1) {
              const base = byKey[key(REFERENCE_DPI, REFERENCE_ARM)]?.[round]?.probe;
              const candidate = byKey[key(dpi, arm)]?.[round];
              if (base === undefined || candidate === undefined || candidate === null) continue;
              comparedPairs += 1;
              for (const fingerprint of FINGERPRINT_KEYS) {
                const reference = base[fingerprint];
                const same =
                  typeof reference === "string" &&
                  reference.length > 0 &&
                  candidate.probe[fingerprint] === reference;
                if (!same) mismatched.push(`${candidate.runId}:${fingerprint}`);
              }
            }
          };
          compare(time);
          compare(memory);
        }
        if (dpi === REFERENCE_DPI && mismatched.length > 0) qualityExact = false;

        const busyPeaks = runs.flatMap((run) => {
          const peak = num(run.probe.effectiveBusyRecognizersPeak);
          return peak === null ? [] : [peak];
        });
        const busyPeakMax = busyPeaks.length > 0 ? Math.max(...busyPeaks) : null;
        const anyProbe = runs[0]?.probe;
        const budgetBytes = num(anyProbe?.effectiveMaxLiveImageBytes);
        const estimates = completeEstimates(runs.map((run) => run.probe)).bytes;

        const evidences = runs.flatMap((run) =>
          run.evidence?.dispatch === undefined ? [] : [run],
        );
        const dispatches = evidences.flatMap((run) =>
          run.evidence?.dispatch ? [run.evidence.dispatch] : [],
        );
        const chains = evidences.flatMap((run) =>
          run.evidence?.chain ? [run.evidence.chain] : [],
        );
        const medianRss = median(memoryRuns.map((run) => run.metrics.rssPeakBytes));
        const medianOcr = median(timeRuns.map((run) => run.metrics.ocrMs));
        const medianReady = median(timeRuns.map((run) => run.metrics.readyMs));
        const control = summaries[key(REFERENCE_DPI, arm)];
        const delta =
          dpi === REFERENCE_DPI ||
          control === undefined ||
          medianRss === null ||
          control.memory.medianRssPeakDuringOcrBytes === null
            ? null
            : medianRss - control.memory.medianRssPeakDuringOcrBytes;

        summaries[key(dpi, arm)] = {
          dpi,
          pool: arm,
          configuredPoolSize: num(anyProbe?.effectiveConfiguredRecognizerPoolSize),
          effectiveMaxLiveImageBytes: budgetBytes,
          time: {
            runs: timeRuns.map((run) => ({
              runId: run.runId,
              readyMs: run.metrics.readyMs,
              ocrMs: run.metrics.ocrMs,
              busyRecognizersPeak: num(run.probe.effectiveBusyRecognizersPeak),
            })),
            medianReadyMs: medianReady,
            medianOcrMs: medianOcr,
          },
          memory: {
            runs: memoryRuns.map((run) => ({
              runId: run.runId,
              rssPeakDuringOcrBytes: run.metrics.rssPeakBytes,
              busyRecognizersPeak: num(run.probe.effectiveBusyRecognizersPeak),
            })),
            medianRssPeakDuringOcrBytes: medianRss,
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
              estimates === null || budgetBytes === null
                ? null
                : estimateContradictedByOccupancy(estimates, busyPeakMax, budgetBytes),
          },
          dpiEvidence: {
            runsWithEvidence: dispatches.length,
            effectiveDpis: [...new Set(dispatches.flatMap((d) => d.effectiveDpis))].sort(
              (a, b) => a - b,
            ),
            allDispatchesAtExpectedDpi:
              dispatches.length === 0 ? null : dispatches.every((d) => d.dispatchesAtExpectedDpi),
            allDispatchesAtRequestedDpi:
              dispatches.length === 0 ? null : dispatches.every((d) => d.armEffective),
            recoverySteps:
              chains.length === 0 ? null : Math.max(...chains.map((c) => c.recoverySteps)),
            upscaledDispatches:
              chains.length === 0 ? null : Math.max(...chains.map((c) => c.upscaledDispatches)),
            unreadableInkPages:
              chains.length === 0 ? null : Math.max(...chains.map((c) => c.unreadableInkPages)),
          },
          fingerprintsVsReference: {
            expectedIdentical: dpi === REFERENCE_DPI,
            comparedPairs,
            identical:
              dpi === REFERENCE_DPI && arm === REFERENCE_ARM
                ? true
                : comparedPairs === 0
                  ? null
                  : mismatched.length === 0,
            mismatchedKeys: mismatched,
          },
          cancellation:
            cancelRun === null
              ? null
              : {
                  runId: cancelRun.runId,
                  activeOcrJobsAtCancellation: cancelRun.metrics.activeJobs,
                  cancelLatencyMs: cancelRun.metrics.latencyMs,
                  withinSla:
                    cancelRun.metrics.activeJobs > 0 &&
                    cancelRun.metrics.latencyMs !== null &&
                    cancelRun.metrics.latencyMs <= CANCELLATION_SLA_MS,
                },
          versusControlDpi:
            // Un brazo cuyo DPI efectivo no es el pedido no se informa como ese brazo.
            dpi === REFERENCE_DPI ||
            control === undefined ||
            dispatches.length === 0 ||
            !dispatches.every((d) => d.armEffective)
              ? null
              : {
                  rssPeakRatio: ratio(medianRss, control.memory.medianRssPeakDuringOcrBytes),
                  rssPeakDeltaBytes: delta,
                  ocrMsRatio: ratio(medianOcr, control.time.medianOcrMs),
                  readyMsRatio: ratio(medianReady, control.time.medianReadyMs),
                },
        };
      }

    const byDpi: Record<string, DpiPoolSummary["byProfile"][string]["byDpi"][string]> = {};
    for (const dpi of dpis) {
      const probes = arms
        .flatMap((arm) => [
          ...present(time[key(dpi, arm)] ?? []),
          ...present(memory[key(dpi, arm)] ?? []),
        ])
        .map((run) => run.probe);
      const reservation = summarizeReservation(probes);
      byDpi[String(dpi)] = {
        pools: Object.fromEntries(
          arms.map((arm) => [arm, summaries[key(dpi, arm)] as DpiArmSummary]),
        ),
        reservation,
        pagesAdmittedAt128MiB:
          reservation.pagesAdmittedByBudget?.["128MiB"]?.atMedian ??
          (reservation.perPageBytes === null
            ? null
            : Math.floor(BUDGET_128_MIB / reservation.perPageBytes.median)),
      };
    }
    byProfile[profile] = { byDpi };
  }

  const sleepDetection = input.sleepDetection ?? SLEEP_NOT_REPORTED;
  return {
    phase: "ultra-dpi",
    cancellationSlaMs: CANCELLATION_SLA_MS,
    profiles,
    profileNotes: input.profileNotes,
    dpis,
    pools: arms,
    byProfile,
    sleepDetection,
    validityCaveats: validityCaveatsOf(sleepDetection, input.caveats ?? []),
    excludedInvalidatedRunIds: [...(validity.affectedRunIds ?? [])].sort(),
    invalidationReasons: validity.reasonsByRunId ?? {},
    invalidRuns,
    missingRuns,
    qualityExactAtControlDpi: qualityExact,
    complete:
      missingRuns.length === 0 &&
      invalidRuns.length === 0 &&
      qualityExact &&
      profiles.length > 0 &&
      dpis.includes(REFERENCE_DPI) &&
      arms.includes(REFERENCE_ARM),
  };
}

/** Línea final: `complete`, las huellas con DPI de control y las salvedades a la vista. */
export function dpiPoolResultLine(summary: DpiPoolSummary, smoke = false): string {
  const complete = smoke ? "n/a" : String(summary.complete);
  const codes = summary.validityCaveats.map((caveat) => caveat.split(":")[0] ?? caveat);
  return `complete=${complete} dpis=[${summary.dpis.join(",")}] pools=[${summary.pools.join(",")}] huellas-a-300-iguales=${summary.qualityExactAtControlDpi} salvedades=${codes.length}${codes.length > 0 ? ` [${codes.join(", ")}]` : ""}`;
}
