/**
 * `support/memoryProfile.ts` — lo compartido entre `memory.spec.ts` (H-10,
 * ADR-146) y `memory-attribution.spec.ts` (atribución del exceso de P2
 * sobre 512 MB): el collector de fases del pipeline, el ciclo
 * frío→cerrar→caliente dentro de la misma instancia de Electron, y el
 * formato de reporte. Separado de `memory.spec.ts` para que los dos
 * archivos de test reusen exactamente el mismo instrumento — ninguna
 * corrida de atribución mide con una vara distinta de la caracterización
 * base.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ElectronApplication, Page } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import {
  minSumBytes,
  peakSumBytes,
  sampleNear,
  samplesBetween,
  samplesSince,
  startMemorySampling,
  type MemorySample,
  type MemorySampler,
} from "./memorySampler.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../../.measure");

export const SAMPLE_INTERVAL_MS = 150;
/** Gracia tras `PIPELINE_READY` antes de tomar el pico (ADR-146 §15.3 punto 8: el seed/precalentado de ADR-151 sigue corriendo un instante más). */
const SETTLE_GRACE_MS = 600;
/**
 * Asentamiento del RSS tras `closeDocument()` para la línea de base caliente
 * (ADR-146 §7bis): un residuo del documento anterior que todavía no decayó
 * puede quedar por encima de cualquier cosa que el documento siguiente
 * produzca — medido en 2 de 3 corridas de P2, donde el máximo de todo el run
 * caliente cayó antes de `DOCUMENT_IMPORTED`. "Asentado" = `
 * HOT_BASELINE_SETTLE_WINDOW_SAMPLES` muestras consecutivas dentro de
 * `±HOT_BASELINE_SETTLE_TOLERANCE` de su mediana (ver `lastSettledWindow`).
 * No fuerza GC (ADR-146 §6 ya anticipa que no hay forma de forzarlo desde el
 * arnés): solo espera, sondeando el sampler de fondo que ya corre
 * (`startMemorySampling`).
 */
const HOT_BASELINE_SETTLE_WINDOW_SAMPLES = 5;
const HOT_BASELINE_SETTLE_TOLERANCE = 0.02;
/** Si no asienta en este tiempo, la corrida sigue igual — no se descarta — y el reporte queda marcado (`RunReport.hotBaselineSettled: false`) para no promediarse a ciegas. */
const HOT_BASELINE_SETTLE_CEILING_MS = 30_000;

declare global {
  var __anonlyMemoryRun:
    | {
        documentId?: string;
        phases: Record<string, number>;
        /**
         * Mismo evento que `phases`, pero en `Date.now()` (reloj de pared)
         * en vez de `performance.now()` (que arranca en la navegación de la
         * página, un origen distinto). El proceso de Node/Playwright y el
         * renderer de Electron comparten el reloj del sistema operativo —
         * eso es lo que permite convertir un límite de fase a un `atMs`
         * comparable contra las muestras del sampler (`computePhaseSegments`
         * más abajo), sin necesidad de reconciliar dos orígenes de
         * `performance.now()` distintos.
         */
        phasesEpochMs: Record<string, number>;
        groupCount: number;
        entityCount: number;
        failedAt?: number;
        workerPeakByType: Record<string, number>;
        /**
         * Cada `WORKER_JOB_DISPATCHED` (+1) y su evento terminal (-1),
         * con el `Date.now()` del handler (P3 de H-10: `workerPeakByType`
         * es un máximo plano de toda la corrida, sin ventana temporal — esto
         * es lo que falta para acotar la concurrencia a una fase).
         * `IEventBus.emit` despacha en línea (`04_Event_System.md` §13), así
         * que ese `Date.now()` es el momento real del despacho.
         */
        workerEvents: WorkerJobEvent[];
      }
    | undefined;
}

/** Un evento de concurrencia de worker, con el reloj de pared del handler — mismo origen que `phasesEpochMs` (ver `computePhaseSegments`). */
export interface WorkerJobEvent {
  readonly type: string;
  readonly epochMs: number;
  readonly delta: 1 | -1;
}

/** `WorkerJobEvent` con `atMs` ya relativo al sampler (`epochMs - samplerStartedAtMs`) — mismo origen que `MemorySample.atMs`, comparable contra `samples`/`phaseSegments`. */
export interface WorkerJobEventAtMs {
  readonly type: string;
  readonly atMs: number;
  readonly delta: 1 | -1;
}

const PHASE_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ["pipeline", "DOCUMENT_IMPORTED"],
  ["pdf", "DOCUMENT_PARSED"],
  ["ocr", "OCR_STARTED"],
  ["ocr", "OCR_FINISHED"],
  ["ner", "NER_MODEL_READY"],
  ["ner", "NER_FINISHED"],
  ["grouping", "GROUPING_FINISHED"],
  ["pipeline", "PIPELINE_READY"],
  ["pipeline", "PIPELINE_FAILED"],
];

/**
 * Eventos de fin de job (`docs/core/Contracts.md`) que liberan el slot de
 * concurrencia que `WORKER_JOB_DISPATCHED` ocupó — ver el conteo de workers
 * más abajo.
 */
const WORKER_TERMINAL_EVENTS: ReadonlyArray<string> = [
  "WORKER_JOB_COMPLETED",
  "WORKER_JOB_FAILED",
  "WORKER_JOB_CANCELLED",
  "WORKER_JOB_TIMEOUT",
];

async function installRunCollector(page: Page): Promise<void> {
  await page.evaluate(
    ({ phaseEvents, workerTerminalEvents }) => {
      const core = globalThis.__anonlyCore;
      if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");

      const run: NonNullable<typeof globalThis.__anonlyMemoryRun> = {
        phases: {},
        phasesEpochMs: {},
        groupCount: 0,
        entityCount: 0,
        workerPeakByType: {},
        workerEvents: [],
      };
      globalThis.__anonlyMemoryRun = run;

      for (const [channel, event] of phaseEvents) {
        core.bus.on(channel, event, (payload: unknown) => {
          if (!(event in run.phases)) {
            run.phases[event] = performance.now();
            run.phasesEpochMs[event] = Date.now();
          }
          if (event === "DOCUMENT_IMPORTED") {
            run.documentId = (payload as { documentId: string }).documentId;
          }
          if (event === "PIPELINE_FAILED") run.failedAt = performance.now();
        });
      }
      core.bus.on("grouping", "ENTITY_GROUP_CREATED", () => {
        run.groupCount += 1;
      });
      core.bus.on("regex", "ENTITY_FOUND", () => {
        run.entityCount += 1;
      });
      core.bus.on("ner", "ENTITY_FOUND", () => {
        run.entityCount += 1;
      });

      // Conteo de workers vivos por pool en el pico, sin tocar el Core
      // (`packages/anonymization-core/src/worker-pool.ts`, leído para esto:
      // `workerId` en el payload es `${poolKey}-pool`, una constante por
      // pool, inútil para contar). `WORKER_JOB_DISPATCHED` se emite desde
      // `entry.execute()` -cuando el job empieza a correr, no al encolarse-
      // y los workers remotos se crean perezosamente por slot de
      // concurrencia (`workerForSlot`): un slot solo se ocupa mientras un
      // job corre, así que el máximo de jobs concurrentes por `type` a lo
      // largo de la corrida ES el número de workers que ese pool llegó a
      // crear. `broadcast()` (los controles load-document/unload-document de
      // RenderPool) crea el slot 0 sin pasar por `dispatch()` -sin
      // DISPATCHED-, así que este conteo no ve ese piso de 1 worker por pool
      // con documento cargado; ninguno de los perfiles de H-10 depende de
      // distinguir 0 de 1 workers, así que no hace falta corregirlo acá.
      const inFlightByType = new Map<string, number>();
      const typeByJobId = new Map<string, string>();

      function decrement(jobId: string): void {
        const type = typeByJobId.get(jobId);
        // Sin tipo registrado: evento tardío de un job que ya se decrementó,
        // o -caso real, ver abajo- un job cancelado a mitad de ejecución
        // (el motor observa `ctx.abortSignal` y lanza `CancelledError`
        // directo, sin pasar por el WORKER_JOB_CANCELLED de la punta
        // superior del loop de `runWithRetry`): esos nunca decrementan por
        // evento. Ninguno de los perfiles de H-10 cancela un job en vuelo
        // (cierran el documento recién después de PIPELINE_READY), así que
        // esta corrida no lo dispara.
        if (type === undefined) return;
        typeByJobId.delete(jobId);
        const current = inFlightByType.get(type) ?? 0;
        inFlightByType.set(type, Math.max(0, current - 1));
        run.workerEvents.push({ type, epochMs: Date.now(), delta: -1 });
      }

      core.bus.on("workers", "WORKER_JOB_DISPATCHED", (payload: unknown) => {
        const { jobId, type } = payload as { jobId: string; type: string };
        typeByJobId.set(jobId, type);
        const next = (inFlightByType.get(type) ?? 0) + 1;
        inFlightByType.set(type, next);
        run.workerPeakByType[type] = Math.max(run.workerPeakByType[type] ?? 0, next);
        run.workerEvents.push({ type, epochMs: Date.now(), delta: 1 });
      });
      // Las cuatro decrementan igual. WORKER_JOB_TIMEOUT no siempre es
      // terminal -un job puede reintentar tras un timeout, sin un nuevo
      // DISPATCHED, dentro del mismo slot- así que un timeout seguido de
      // reintento decrementa de más por un instante; no infla el pico
      // (`pump()` sigue topeado por el tamaño del pool, así que un slot
      // "liberado de más" no habilita un DISPATCHED nuevo que no hubiera
      // cabido igual) y ningún perfil de H-10 corre con reintentos por
      // timeout en un camino feliz (`ok: true` en todas las corridas hasta
      // ahora).
      for (const event of workerTerminalEvents) {
        core.bus.on("workers", event, (payload: unknown) => {
          decrement((payload as { jobId: string }).jobId);
        });
      }
    },
    { phaseEvents: PHASE_EVENTS, workerTerminalEvents: WORKER_TERMINAL_EVENTS },
  );
}

async function waitForRunSettled(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const r = globalThis.__anonlyMemoryRun;
      return r !== undefined && ("PIPELINE_READY" in r.phases || r.failedAt !== undefined);
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function readRun(page: Page): Promise<NonNullable<typeof globalThis.__anonlyMemoryRun>> {
  return page.evaluate(() => {
    const r = globalThis.__anonlyMemoryRun;
    if (r === undefined) throw new Error("__anonlyMemoryRun ausente");
    return {
      ...r,
      phases: { ...r.phases },
      phasesEpochMs: { ...r.phasesEpochMs },
      workerPeakByType: { ...r.workerPeakByType },
      workerEvents: [...r.workerEvents],
    };
  });
}

/**
 * Máximo de jobs concurrentes por `type` durante `[fromAtMs, toAtMs]` — P3 de
 * H-10 (ADR-146 §7bis): a diferencia de `workerPeakByType` (máximo de toda la
 * corrida), esto acota la concurrencia a una fase.
 *
 * Dos pasadas sobre los eventos ordenados: la primera reproduce todo lo
 * anterior a la ventana para saber cuántos jobs ya estaban en vuelo al
 * entrar — ese conteo es un candidato a pico **aunque ningún evento propio
 * caiga adentro** (un job largo que arrancó antes de la ventana y sigue
 * corriendo durante toda ella no dispararía ningún evento dentro de
 * `[fromAtMs, toAtMs]`, y contarlo en cero sería el bug). La segunda
 * reproduce los eventos que sí caen dentro, actualizando el pico en cada
 * transición.
 */
export function computeWorkerPeakByTypeInWindow(
  events: ReadonlyArray<WorkerJobEventAtMs>,
  fromAtMs: number,
  toAtMs: number,
): Record<string, number> {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const counts = new Map<string, number>();
  const peaks: Record<string, number> = {};

  for (const event of sorted) {
    if (event.atMs >= fromAtMs) break;
    counts.set(event.type, Math.max(0, (counts.get(event.type) ?? 0) + event.delta));
  }
  for (const [type, count] of counts) {
    if (count > 0) peaks[type] = count;
  }

  for (const event of sorted) {
    if (event.atMs < fromAtMs || event.atMs > toAtMs) continue;
    const next = Math.max(0, (counts.get(event.type) ?? 0) + event.delta);
    counts.set(event.type, next);
    peaks[event.type] = Math.max(peaks[event.type] ?? 0, next);
  }

  return peaks;
}

/**
 * Atribución intra-corrida, por fase (ADR-146 §7 punto 3, reemplaza el
 * método de comparar M2 entre corridas — ver `tests/perf/README.md` y
 * `memory-attribution.spec.ts` por qué: restar corridas no puede resolver
 * levers de 50-400 MB contra un ruido entre corridas de ~345 MB). Convierte
 * cada límite de fase (`phasesEpochMs`, reloj de pared) a un `atMs`
 * comparable contra `samples` restando `samplerStartedAtMs` — el origen que
 * `MemorySampler` ya expone —, ordena los eventos por ese `atMs` y arma un
 * segmento por cada par consecutivo. Sin ordenar por declaración: un
 * perfil sin OCR (P1, texto nativo) nunca emite `OCR_STARTED`, así que la
 * lista de fases presentes varía corrida a corrida.
 */
function computePhaseSegments(
  phasesEpochMs: Readonly<Record<string, number>>,
  samples: ReadonlyArray<MemorySample>,
  samplerStartedAtMs: number,
  workerEvents: ReadonlyArray<WorkerJobEvent>,
): ReadonlyArray<PhaseSegment> {
  const boundaries = Object.entries(phasesEpochMs)
    .map(([event, epochMs]) => ({ event, atMs: epochMs - samplerStartedAtMs }))
    .sort((a, b) => a.atMs - b.atMs);
  const workerEventsAtMs = workerEvents.map((e) => ({
    type: e.type,
    atMs: e.epochMs - samplerStartedAtMs,
    delta: e.delta,
  }));

  const segments: PhaseSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    if (from === undefined || to === undefined) continue;

    const entry = sampleNear(samples, from.atMs);
    const exit = sampleNear(samples, to.atMs);
    const entryBytes = entry?.sumWorkingSetSizeBytes ?? 0;
    const exitBytes = exit?.sumWorkingSetSizeBytes ?? 0;

    segments.push({
      fromEvent: from.event,
      toEvent: to.event,
      fromAtMs: from.atMs,
      toAtMs: to.atMs,
      rssAtEntryBytes: entryBytes,
      rssAtExitBytes: exitBytes,
      peakInternalBytes: peakSumBytes(samplesBetween(samples, from.atMs, to.atMs)),
      deltaBytes: exitBytes - entryBytes,
      workerPeakByType: computeWorkerPeakByTypeInWindow(workerEventsAtMs, from.atMs, to.atMs),
    });
  }
  return segments;
}

/**
 * Un tramo entre dos eventos de fase consecutivos (ADR-146 §7 punto 3):
 * cuánto sube o baja el RSS durante esa etapa del pipeline, dentro de una
 * sola corrida — inmune a la deriva entre corridas que hundió el método de
 * comparar M2 entre configuraciones (ver `memory-attribution.spec.ts`).
 */
export interface PhaseSegment {
  readonly fromEvent: string;
  readonly toEvent: string;
  readonly fromAtMs: number;
  readonly toAtMs: number;
  readonly rssAtEntryBytes: number;
  readonly rssAtExitBytes: number;
  /** Pico dentro del tramo — puede superar tanto la entrada como la salida (p. ej. un pico intermedio que ya bajó al llegar a `toEvent`). */
  readonly peakInternalBytes: number;
  /** `rssAtExitBytes - rssAtEntryBytes`. Negativo = el RSS bajó durante este tramo. */
  readonly deltaBytes: number;
  /** Máximo de jobs concurrentes por `type` **dentro de este tramo** (P3 de H-10) — ver `computeWorkerPeakByTypeInWindow`. A diferencia de `RunReport.workerPeakByType` (máximo de toda la corrida), esto ya está acotado a la fase. */
  readonly workerPeakByType: Readonly<Record<string, number>>;
}

export interface RunReport {
  readonly temperature: "cold" | "hot";
  readonly baselineBytes: number;
  readonly peakSumBytes: number;
  /**
   * `peakSumBytes - baselineBytes` — solo tiene sentido en caliente
   * (ADR-146 §1). `null` en frío. **Puede dar levemente negativo**: la
   * línea de base caliente se muestrea justo después de `closeDocument()`,
   * antes de que el GC libere la basura del documento recién cerrado — no
   * es un bug del instrumento, es inherente a muestrear RSS crudo sin
   * forzar GC (anticipado por ADR-146 §6). Visto en la práctica: -16.4 MB
   * en un perfil de 10 páginas nativas, contra un M1 esperado de ~30 MB —
   * define el piso de ruido del método en ±40 MB aprox.
   */
  readonly m1Bytes: number | null;
  readonly phases: Readonly<Record<string, number>>;
  /**
   * Máximo de jobs concurrentes por `WorkerJobType` (`pdf-parse`/`ocr-page`/
   * `ner-page`/`render-page`/`export-page`) durante esta corrida — ver el
   * comentario de `installRunCollector`. Es el número de workers que ese
   * pool llegó a crear, no un tamaño de pool configurado: un pool con
   * `size: 4` que nunca recibió 4 jobs a la vez cuenta menos de 4 acá.
   */
  readonly workerPeakByType: Readonly<Record<string, number>>;
  readonly startedAtMs: number;
  readonly readyAtMs: number | null;
  readonly totalMs: number | null;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly ok: boolean;
  /** Atribución por fase, dentro de esta corrida (ADR-146 §7 punto 3) — ver `PhaseSegment`. */
  readonly phaseSegments: ReadonlyArray<PhaseSegment>;
  /**
   * La serie temporal cruda de esta corrida (ADR-146 §7 punto 3: "hay que
   * persistir la serie, no solo el máximo") — mismas muestras que
   * `computePhaseSegments` ya usó, guardadas para poder re-analizar sin
   * volver a correr el import (p. ej. otra segmentación de fases, un
   * gráfico). Acotada a esta corrida (`samplesSince(sinceMs)`), no a toda la
   * sesión de Electron.
   */
  readonly samples: ReadonlyArray<MemorySample>;
  /**
   * Los eventos crudos de concurrencia de worker de esta corrida, con `atMs`
   * ya relativo al sampler (mismo origen que `samples`/`phaseSegments`) —
   * persistidos por la misma razón que `samples` (ADR-146 §7 punto 3), para
   * poder recalcular `workerPeakByType` sobre cualquier ventana sin volver a
   * correr el import.
   */
  readonly workerEvents: ReadonlyArray<WorkerJobEventAtMs>;
  /**
   * `false` si el pico de esta corrida (`peakSumBytes`) cae fuera de
   * `[primera fase, última fase]` — ADR-146 §7bis: un run caliente cuyo
   * máximo es en realidad el residuo del documento anterior, no algo que
   * este documento produjo. Una corrida con `peakWithinPhases: false` se
   * reporta, no se descarta, pero no debe promediarse con las demás.
   */
  readonly peakWithinPhases: boolean;
  /**
   * `null` en frío (no aplica). En caliente: si `waitForHotBaselineToSettle`
   * encontró una ventana asentada dentro de `HOT_BASELINE_SETTLE_CEILING_MS`
   * antes de tomar `baselineBytes` (ADR-146 §7bis). `false` no invalida la
   * corrida — la deja marcada como de línea de base menos confiable.
   */
  readonly hotBaselineSettled: boolean | null;
}

/**
 * Corre un import de punta a punta (`file`, ya en memoria) y devuelve su
 * reporte. `sinceMs` acota el pico de memoria a las muestras posteriores a
 * ese punto del muestreo continuo (para no mezclar el pico de una corrida
 * fría con el de la caliente que le sigue en el mismo `MemorySampler`).
 */
async function runImport(
  page: Page,
  file: E2eFilePayload,
  sampler: MemorySampler,
  temperature: "cold" | "hot",
  baselineBytes: number,
): Promise<RunReport> {
  // Sincroniza con la fase "load" (`appPhase.ts`) antes de soltar el
  // archivo — necesario tras un `closeDocument()`, inocuo en la primera
  // corrida (ya arranca ahí).
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });

  await installRunCollector(page);
  const sinceMs = sampler.samples.at(-1)?.atMs ?? 0;
  const startedAtMs = Date.now();

  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForRunSettled(page, 180_000);
  await page.waitForTimeout(SETTLE_GRACE_MS);
  await sampler.sampleOnce();

  const run = await readRun(page);
  const runSamples = samplesSince(sampler.samples, sinceMs);
  const peak = peakSumBytes(runSamples);
  const readyAtMs = run.phases.PIPELINE_READY ?? null;
  const startedAtPerf = run.phases.DOCUMENT_IMPORTED ?? null;
  const phaseSegments = computePhaseSegments(
    run.phasesEpochMs,
    runSamples,
    sampler.startedAtMs,
    run.workerEvents,
  );
  const workerEventsAtMs = run.workerEvents.map((e) => ({
    type: e.type,
    atMs: e.epochMs - sampler.startedAtMs,
    delta: e.delta,
  }));

  return {
    temperature,
    baselineBytes,
    peakSumBytes: peak,
    m1Bytes: temperature === "hot" ? peak - baselineBytes : null,
    phases: run.phases,
    workerPeakByType: run.workerPeakByType,
    startedAtMs,
    readyAtMs,
    phaseSegments,
    samples: runSamples,
    workerEvents: workerEventsAtMs,
    peakWithinPhases: peakFallsWithinPhases(findPeakSample(runSamples), phaseSegments),
    hotBaselineSettled: null,
    totalMs: readyAtMs !== null && startedAtPerf !== null ? readyAtMs - startedAtPerf : null,
    groupCount: run.groupCount,
    entityCount: run.entityCount,
    ok: run.failedAt === undefined,
  };
}

/** La muestra con `sumWorkingSetSizeBytes` máximo. `undefined` si `samples` está vacío. */
function findPeakSample(samples: ReadonlyArray<MemorySample>): MemorySample | undefined {
  return samples.reduce<MemorySample | undefined>(
    (max, s) =>
      max === undefined || s.sumWorkingSetSizeBytes > max.sumWorkingSetSizeBytes ? s : max,
    undefined,
  );
}

/** `true` si `peakSample` cae dentro de `[primera fase, última fase]` (ADR-146 §7bis) — `phaseSegments` cubre ese rango sin huecos, así que "fuera de toda fase" es "fuera de ese intervalo". Sin segmentos (corrida fallida antes del segundo evento de fase), no hay nada que invalidar. */
function peakFallsWithinPhases(
  peakSample: MemorySample | undefined,
  segments: ReadonlyArray<PhaseSegment>,
): boolean {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined || peakSample === undefined) return true;
  return peakSample.atMs >= first.fromAtMs && peakSample.atMs <= last.toAtMs;
}

/**
 * Cierra por la UI real, no por `core.orchestrator.closeDocument()`
 * directo: ese método solo limpia el estado del Core — ninguno de los
 * stores de React se resetea desde un bus event (`bus-bridge.ts` no tiene
 * handler de `DOCUMENT_CLOSED`, el reset lo dispara `actions.closeDocument()`
 * en la capa de React) — así que un cierre "directo" deja `document.store.id`
 * viejo y el `<input type="file">` nunca reaparece para la corrida
 * siguiente. Mismo patrón que `tests/e2e/scenario-7-open-close-cycle.spec.ts`
 * (el ciclo de H-07/leak): botón real → `ConfirmDialog` real (ADR-051 §2).
 */
async function closeDocument(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Cerrar documento" });
  const confirmDialog = page.getByRole("dialog", { name: "Cerrar documento" });
  await closeButton.waitFor({ state: "visible", timeout: 30_000 });
  await closeButton.click();
  await confirmDialog.waitFor({ state: "visible" });
  await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();
  await confirmDialog.waitFor({ state: "hidden" });
}

export interface ProfileReport {
  readonly profile: string;
  readonly identity: {
    readonly commit: string | undefined;
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string | undefined;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly cold: RunReport;
  readonly hot: RunReport;
  readonly capturedAt: string;
}

/**
 * Espera a que el RSS se asiente antes de tomar la línea de base caliente
 * (ADR-146 §7bis) — ver `lastSettledWindow`. Si asienta, la línea de base es
 * el mínimo de esa ventana asentada (mismo criterio de mínimo que ADR-146
 * §7). Si vence `HOT_BASELINE_SETTLE_CEILING_MS` sin asentar, la corrida
 * sigue igual con el mínimo de todo lo acumulado hasta ahí, y `settled: false`
 * — no se descarta, pero queda marcada.
 */
async function waitForHotBaselineToSettle(
  page: Page,
  sampler: MemorySampler,
  sinceMs: number,
): Promise<{ baselineBytes: number; settled: boolean }> {
  const deadline = Date.now() + HOT_BASELINE_SETTLE_CEILING_MS;
  for (;;) {
    const samples = samplesSince(sampler.samples, sinceMs);
    const window = lastSettledWindow(samples);
    if (window !== undefined) {
      return { baselineBytes: minSumBytes(window), settled: true };
    }
    if (Date.now() >= deadline) {
      return { baselineBytes: minSumBytes(samples), settled: false };
    }
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
}

/**
 * Las últimas `HOT_BASELINE_SETTLE_WINDOW_SAMPLES` muestras, si todas caen
 * dentro de `±HOT_BASELINE_SETTLE_TOLERANCE` de su mediana. `undefined` si
 * todavía no hay suficientes muestras o esas últimas no asentaron.
 */
function lastSettledWindow(
  samples: ReadonlyArray<MemorySample>,
): ReadonlyArray<MemorySample> | undefined {
  if (samples.length < HOT_BASELINE_SETTLE_WINDOW_SAMPLES) return undefined;
  const window = samples.slice(-HOT_BASELINE_SETTLE_WINDOW_SAMPLES);
  const sorted = window.map((s) => s.sumWorkingSetSizeBytes).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  // No debería pasar: `window` tiene exactamente HOT_BASELINE_SETTLE_WINDOW_SAMPLES
  // elementos por el guard de arriba, así que `sorted[mid]` siempre existe en
  // tiempo de ejecución — el chequeo es para noUncheckedIndexedAccess.
  if (upper === undefined) return undefined;
  const median = sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
  const tolerance = median * HOT_BASELINE_SETTLE_TOLERANCE;
  const settled = window.every((s) => Math.abs(s.sumWorkingSetSizeBytes - median) <= tolerance);
  return settled ? window : undefined;
}

export async function measureProfile(
  page: Page,
  electronApp: ElectronApplication,
  profile: string,
  file: E2eFilePayload,
): Promise<ProfileReport> {
  const sampler = startMemorySampling(electronApp, SAMPLE_INTERVAL_MS);
  try {
    // Línea de base FRÍA: recién arrancado, sin modelos, sin documento.
    const coldBaseline = await sampler.sampleOnce();

    const cold = await runImport(page, file, sampler, "cold", coldBaseline.sumWorkingSetSizeBytes);

    await closeDocument(page);
    // Línea de base CALIENTE: los modelos que cargó la corrida fría siguen
    // retenidos (ADR-080 idle-dispose) y ya no hay documento — es la línea
    // de base que ADR-146 §1 exige para M1. Espera a que asiente (ADR-146
    // §7bis) en vez de una ventana fija: un residuo del documento anterior
    // sin decaer puede quedar por encima de todo lo que produzca el
    // siguiente, y eso ya se midió (2 de 3 corridas de P2).
    const hotBaselineSinceMs = sampler.samples.at(-1)?.atMs ?? 0;
    const { baselineBytes: hotBaselineBytes, settled: hotBaselineSettled } =
      await waitForHotBaselineToSettle(page, sampler, hotBaselineSinceMs);

    const hotRun = await runImport(page, file, sampler, "hot", hotBaselineBytes);
    const hot: RunReport = { ...hotRun, hotBaselineSettled };
    await closeDocument(page);

    return {
      profile,
      identity: {
        commit: process.env.GITHUB_SHA,
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
      },
      cold,
      hot,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    sampler.stop();
  }
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** `{ "ocr-page": 2, "ner-page": 1 }` → `"ocr-page=2 ner-page=1"`, orden estable para diffs legibles entre corridas. */
function formatWorkerPeaks(peaks: Readonly<Record<string, number>>): string {
  const entries = Object.entries(peaks).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "?";
  return entries.map(([type, count]) => `${type}=${count}`).join(" ");
}

function formatSignedMB(bytes: number): string {
  const sign = bytes >= 0 ? "+" : "";
  return `${sign}${formatMB(bytes)}`;
}

/** Una línea por `PhaseSegment`, en orden temporal — la vista que contesta "¿baja el RSS al terminar el OCR, o se queda arriba?" (ADR-154 §2 lever 3). */
function formatPhaseSegments(segments: ReadonlyArray<PhaseSegment>): string {
  if (segments.length === 0)
    return "    (sin segmentos — ¿corrida fallida antes del segundo evento de fase?)\n";
  return segments
    .map(
      (s) =>
        `    ${s.fromEvent} → ${s.toEvent}: entrada ${formatMB(s.rssAtEntryBytes)}, ` +
        `salida ${formatMB(s.rssAtExitBytes)}, pico interno ${formatMB(s.peakInternalBytes)}, ` +
        `delta ${formatSignedMB(s.deltaBytes)}, workers ${formatWorkerPeaks(s.workerPeakByType)}\n`,
    )
    .join("");
}

/** "sí" / "NO — <motivo>" / "?" (no aplica, p. ej. frío) — para `peakWithinPhases` y `hotBaselineSettled`. */
function formatFlag(value: boolean | null, invalidLabel: string): string {
  if (value === null) return "?";
  return value ? "sí" : `NO — ${invalidLabel}`;
}

export function printReport(report: ProfileReport): void {
  const { cold, hot } = report;
  process.stdout.write(
    `\n=== H-10 — perfil ${report.profile} (${report.identity.platform}/${report.identity.arch}, ` +
      `${report.identity.cpuCount} CPUs, ${formatMB(report.identity.totalMemBytes)} RAM) ===\n` +
      `  frío    — M2 (pico suma RSS): ${formatMB(cold.peakSumBytes)}  ` +
      `pico dentro de fase: ${formatFlag(cold.peakWithinPhases, "ADR-146 §7bis, no promediar")}  ` +
      `total: ${cold.totalMs?.toFixed(0) ?? "?"} ms  ok: ${cold.ok}  grupos: ${cold.groupCount}  ` +
      `workers: ${formatWorkerPeaks(cold.workerPeakByType)}\n` +
      formatPhaseSegments(cold.phaseSegments) +
      `  caliente — M2: ${formatMB(hot.peakSumBytes)}  ` +
      `M1 (atribuible al documento): ${hot.m1Bytes !== null ? formatMB(hot.m1Bytes) : "?"}  ` +
      `línea de base: ${formatMB(hot.baselineBytes)} (asentada: ${formatFlag(hot.hotBaselineSettled, "venció el techo de 30s, ADR-146 §7bis")})  ` +
      `pico dentro de fase: ${formatFlag(hot.peakWithinPhases, "ADR-146 §7bis, no promediar")}  ` +
      `total: ${hot.totalMs?.toFixed(0) ?? "?"} ms  ok: ${hot.ok}  grupos: ${hot.groupCount}  ` +
      `workers: ${formatWorkerPeaks(hot.workerPeakByType)}\n` +
      formatPhaseSegments(hot.phaseSegments),
  );
}

/**
 * Un archivo por corrida, no uno por perfil (ADR-146 §6: "guardar serie
 * temporal y máximos" — sobrescribir perdería las corridas anteriores bajo
 * `--repeat-each`). `runIndex` es `testInfo().repeatEachIndex`: 0, 1, 2...
 */
export async function writeReport(report: ProfileReport, runIndex: number): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const outFile = resolve(OUT_DIR, `memory-${report.profile}-run${runIndex}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}
