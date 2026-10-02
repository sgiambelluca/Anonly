/**
 * `support/leakCycles.ts` — instrumento de T-9
 * (`docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md` §2): diez open/close en
 * una sola instancia de Electron, para saber si el reposo de la app sigue
 * subiendo después del primer documento.
 *
 * Tres señales por ciclo, porque cada una ve una clase distinta de fuga:
 *
 * - **Workers vivos** (CDP, incluidos los hijos): un worker que no termina.
 * - **Heap de JS del hilo principal con GC forzado** (ADR-159): retención en JS.
 *   Es la única de las tres que la presión del sistema no mueve.
 * - **RSS en reposo** (mediana de una ventana fija tras el cierre): todo lo
 *   demás, incluido WASM, que ninguna de las otras dos ve (ADR-159 §8).
 *
 * El colector de fases se instala **una vez** y cada ciclo reemplaza el objeto
 * donde escribe (`resetCycleRun`). `installRunCollector` se reinstala en cada
 * import y sus listeners viejos retienen el reporte anterior: en diez ciclos, el
 * propio instrumento sería una fuga (plan §2.4).
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";

import type { ElectronApplication, Page } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import { startHeapSampling, type ClassifiedTargetHeapSample } from "./cdpHeap.js";
import {
  closeDocument,
  computeRunDurations,
  formatMB,
  PHASE_EVENTS,
  readRun,
  SETTLE_GRACE_MS,
  waitForRunSettled,
} from "./memoryProfile.js";
import {
  samplesBetween,
  startMemorySampling,
  type MemorySample,
  type MemorySampler,
} from "./memorySampler.js";
import {
  readSystemMemoryPressure,
  type SystemMemoryPressureSample,
} from "./systemMemoryPressure.js";

/** Plan §2.5: diez ciclos, fijos. Es la regla de parada, no un parámetro. */
export const LEAK_CYCLE_COUNT = 10;

/** ADR-146 §5 deja el intervalo entre 100 y 250 ms; acá las ventanas son de segundos. */
export const LEAK_SAMPLE_INTERVAL_MS = 250;

/** El sampler de heap solo se usa a demanda: con este intervalo no dispara solo (tope de `setInterval`: 2^31−1). */
const HEAP_ON_DEMAND_INTERVAL_MS = 2_000_000_000;

export type LeakRegime = "chained" | "rested";

/** Ventana de reposo, relativa al cierre (plan §2.4 punto 3). */
export interface RestWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/** Encadenado: antes de los 15 s de NER (ADR-167). Con reposo: después de la liberación más lenta de T-7 (~75 s). */
export const REST_WINDOW_BY_REGIME: Readonly<Record<LeakRegime, RestWindow>> = {
  chained: { fromMs: 2_000, toMs: 6_000 },
  rested: { fromMs: 80_000, toMs: 90_000 },
};

/** Ciclo 0: la app recién abierta, medida desde que muestra "Elegir archivo". */
export const FRESH_WINDOW: RestWindow = { fromMs: 10_000, toMs: 20_000 };

// ─── Partes puras (tests en `leakCycles.test.ts`) ───────────────────────────

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

export interface WindowMedian {
  readonly sampleCount: number;
  readonly sumBytes: number;
  /** Mediana por `type` de proceso, sumando los procesos del mismo tipo dentro de cada muestra. */
  readonly byTypeBytes: Readonly<Record<string, number>>;
}

/** Mediana de las muestras en `[fromMs, toMs]` (origen del sampler). `null` si no cayó ninguna: nunca un 0 inventado. */
export function medianOverWindow(
  samples: ReadonlyArray<MemorySample>,
  fromMs: number,
  toMs: number,
): WindowMedian | null {
  const inWindow = samplesBetween(samples, fromMs, toMs);
  const sum = median(inWindow.map((s) => s.sumWorkingSetSizeBytes));
  if (sum === null) return null;
  const perType = new Map<string, number[]>();
  for (const sample of inWindow) {
    const bySample = new Map<string, number>();
    for (const p of sample.perProcess) {
      bySample.set(p.type, (bySample.get(p.type) ?? 0) + p.workingSetSizeBytes);
    }
    for (const [type, bytes] of bySample) {
      const list = perType.get(type) ?? [];
      list.push(bytes);
      perType.set(type, list);
    }
  }
  const byTypeBytes: Record<string, number> = {};
  for (const [type, values] of [...perType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const m = median(values);
    if (m !== null) byTypeBytes[type] = m;
  }
  return { sampleCount: inWindow.length, sumBytes: sum, byTypeBytes };
}

export interface LinearTrend {
  readonly n: number;
  readonly slope: number;
  readonly intercept: number;
  /** Error estándar de la pendiente; `null` con menos de 3 puntos (no hay grados de libertad). */
  readonly slopeStdErr: number | null;
}

/** Mínimos cuadrados ordinarios. `null` con menos de 2 puntos o con todas las `x` iguales. */
export function linearTrend(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): LinearTrend | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((acc, p) => acc + p.x, 0) / n;
  const meanY = points.reduce((acc, p) => acc + p.y, 0) / n;
  const sxx = points.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((acc, p) => acc + (p.x - meanX) * (p.y - meanY), 0);
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  if (n < 3) return { n, slope, intercept, slopeStdErr: null };
  const ssr = points.reduce((acc, p) => acc + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return { n, slope, intercept, slopeStdErr: Math.sqrt(ssr / (n - 2) / sxx) };
}

/** Lo que el heap con GC forzado dice de un instante: el hilo principal y los workers vivos. */
export interface HeapCheckpoint {
  readonly pageUsedBytes: number | null;
  readonly pageBackingBytes: number | null;
  /** Targets de tipo `worker`, a cualquier profundidad (hilos de ONNX e hijos de Tesseract incluidos). */
  readonly workerCount: number;
  readonly workerLabels: ReadonlyArray<string>;
  /** Targets que no contestaron a tiempo (ADR-159 §6): si no es 0, el checkpoint es parcial. */
  readonly unreadableCount: number;
}

export function summarizeHeap(targets: ReadonlyArray<ClassifiedTargetHeapSample>): HeapCheckpoint {
  const pages = targets.filter((t) => t.type === "page");
  const workers = targets.filter((t) => t.type === "worker");
  const sumOrNull = (values: ReadonlyArray<number | undefined>): number | null =>
    values.length === 0 || values.some((v) => v === undefined)
      ? null
      : values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  return {
    pageUsedBytes: sumOrNull(pages.map((t) => t.usedSizeBytes)),
    pageBackingBytes: sumOrNull(pages.map((t) => t.backingStorageSizeBytes)),
    workerCount: workers.length,
    workerLabels: workers.map((t) => t.label).sort(),
    unreadableCount: targets.filter((t) => t.readError !== undefined).length,
  };
}

export interface CycleRecord {
  /** 0 = la app recién abierta, sin documento. */
  readonly cycle: number;
  /** `null` en el ciclo 0. */
  readonly ok: boolean | null;
  readonly importToReadyMs: number | null;
  readonly peakSumBytes: number | null;
  readonly peakTabBytes: number | null;
  readonly groupCount: number | null;
  readonly entityCount: number | null;
  readonly ocrPageCount: number | null;
  /**
   * `NER_MODEL_READY` en este ciclo: el modelo se cargó (ADR-167 §3 hace que toda
   * recarga lo emita). En el régimen encadenado de P1 tiene que ser `false` del
   * ciclo 2 en adelante: si no, el mismo worker no atendió los diez documentos.
   */
  readonly nerModelLoaded: boolean | null;
  readonly rest: WindowMedian | null;
  readonly heap: HeapCheckpoint;
  readonly postGcSumBytes: number;
  readonly systemPressureAtStart: SystemMemoryPressureSample;
  readonly systemPressureAtEnd: SystemMemoryPressureSample;
}

export type LeakMetric =
  | "workerCount"
  | "heapPageUsedBytes"
  | "heapPageBackingBytes"
  | "restSumBytes"
  | "restTabBytes"
  | "postGcSumBytes"
  | "peakSumBytes"
  | "importToReadyMs";

export function metricValue(record: CycleRecord, metric: LeakMetric): number | null {
  switch (metric) {
    case "workerCount":
      return record.heap.workerCount;
    case "heapPageUsedBytes":
      return record.heap.pageUsedBytes;
    case "heapPageBackingBytes":
      return record.heap.pageBackingBytes;
    case "restSumBytes":
      return record.rest?.sumBytes ?? null;
    case "restTabBytes":
      return record.rest?.byTypeBytes.Tab ?? null;
    case "postGcSumBytes":
      return record.postGcSumBytes;
    case "peakSumBytes":
      return record.peakSumBytes;
    case "importToReadyMs":
      return record.importToReadyMs;
  }
}

export const LEAK_METRICS: ReadonlyArray<LeakMetric> = [
  "workerCount",
  "heapPageUsedBytes",
  "heapPageBackingBytes",
  "restSumBytes",
  "restTabBytes",
  "postGcSumBytes",
  "peakSumBytes",
  "importToReadyMs",
];

/** Plan §2.5: la pendiente va sobre los ciclos 2 a 10; el 1 concentra los costos de una sola vez. */
export const TREND_FIRST_CYCLE = 2;

export interface MetricTrend {
  readonly metric: LeakMetric;
  readonly trend: LinearTrend | null;
  /** Ciclos excluidos de la pendiente por fallar (`ok: false`) o por no tener el valor. */
  readonly excludedCycles: ReadonlyArray<number>;
}

export function computeTrends(records: ReadonlyArray<CycleRecord>): ReadonlyArray<MetricTrend> {
  return LEAK_METRICS.map((metric) => {
    const points: Array<{ x: number; y: number }> = [];
    const excludedCycles: number[] = [];
    for (const r of records) {
      if (r.cycle < TREND_FIRST_CYCLE) continue;
      const y = metricValue(r, metric);
      if (r.ok !== true || y === null) {
        excludedCycles.push(r.cycle);
        continue;
      }
      points.push({ x: r.cycle, y });
    }
    return { metric, trend: linearTrend(points), excludedCycles };
  });
}

/** Los umbrales de plan §2.5, escritos antes de medir. */
export const HEAP_GROWTH_THRESHOLD_BYTES = 5_000_000;
export const RSS_SLOPE_THRESHOLD_BYTES = 10_000_000;
export const PRESSURE_CONFOUND_BYTES = 500_000_000;

export interface LeakVerdict {
  readonly workersGrow: boolean;
  readonly heapGrows: boolean;
  readonly rssGrows: boolean;
  /** La presión del sistema se movió más que `PRESSURE_CONFOUND_BYTES`: la pendiente de RSS no se lee. */
  readonly rssConfounded: boolean;
  readonly pressureDeltaBytes: { readonly compressor: number | null; readonly swap: number | null };
}

function exceedsTwoStdErr(trend: LinearTrend | null): boolean {
  return (
    trend !== null &&
    trend.slopeStdErr !== null &&
    trend.slope > 0 &&
    trend.slope > 2 * trend.slopeStdErr
  );
}

function pressureDelta(
  start: SystemMemoryPressureSample,
  end: SystemMemoryPressureSample,
): { compressor: number | null; swap: number | null } {
  if (!start.available || !end.available) return { compressor: null, swap: null };
  const compressor =
    start.compressorBytes === undefined || end.compressorBytes === undefined
      ? null
      : end.compressorBytes - start.compressorBytes;
  return { compressor, swap: end.swapUsedBytes - start.swapUsedBytes };
}

export function judgeLeak(
  records: ReadonlyArray<CycleRecord>,
  trends: ReadonlyArray<MetricTrend>,
): LeakVerdict {
  const trendOf = (metric: LeakMetric): LinearTrend | null =>
    trends.find((t) => t.metric === metric)?.trend ?? null;

  const workersAt = (cycles: ReadonlyArray<number>): ReadonlyArray<number> =>
    records.filter((r) => cycles.includes(r.cycle)).map((r) => r.heap.workerCount);
  const early = workersAt([2, 3, 4]);
  const last = workersAt([LEAK_CYCLE_COUNT]);
  const lastCount = last[0];
  const workersGrow = early.length > 0 && lastCount !== undefined && lastCount > Math.max(...early);

  const heapTrend = trendOf("heapPageUsedBytes");
  const heapSpan = LEAK_CYCLE_COUNT - TREND_FIRST_CYCLE;
  const heapGrows =
    exceedsTwoStdErr(heapTrend) &&
    heapTrend !== null &&
    heapTrend.slope * heapSpan > HEAP_GROWTH_THRESHOLD_BYTES;

  const rssGrows = (["restSumBytes", "restTabBytes"] as const).some((metric) => {
    const t = trendOf(metric);
    return exceedsTwoStdErr(t) && t !== null && t.slope >= RSS_SLOPE_THRESHOLD_BYTES;
  });

  const withDocs = records.filter((r) => r.cycle >= 1);
  const first = withDocs[0];
  const final = withDocs.at(-1);
  const delta =
    first === undefined || final === undefined
      ? { compressor: null, swap: null }
      : pressureDelta(first.systemPressureAtStart, final.systemPressureAtEnd);
  const rssConfounded =
    (delta.compressor !== null && Math.abs(delta.compressor) > PRESSURE_CONFOUND_BYTES) ||
    (delta.swap !== null && Math.abs(delta.swap) > PRESSURE_CONFOUND_BYTES);

  return { workersGrow, heapGrows, rssGrows, rssConfounded, pressureDeltaBytes: delta };
}

// ─── Colector de fases, instalado una vez ──────────────────────────────────

/** Instala los listeners una sola vez. Escriben en el `__anonlyMemoryRun` vigente en el momento del evento. */
export async function installCycleCollector(page: Page): Promise<void> {
  await page.evaluate((phaseEvents) => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente: ¿VITE_E2E=1 en el build?");
    for (const [channel, event] of phaseEvents) {
      core.bus.on(channel, event, (payload: unknown) => {
        const run = globalThis.__anonlyMemoryRun;
        if (run === undefined) return;
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
      const run = globalThis.__anonlyMemoryRun;
      if (run !== undefined) run.groupCount += 1;
    });
    for (const channel of ["regex", "ner"] as const) {
      core.bus.on(channel, "ENTITY_FOUND", () => {
        const run = globalThis.__anonlyMemoryRun;
        if (run !== undefined) run.entityCount += 1;
      });
    }
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      const run = globalThis.__anonlyMemoryRun;
      const p = payload as { pageIndex?: unknown; wordCount?: unknown; confidence?: unknown };
      if (
        run === undefined ||
        typeof p.pageIndex !== "number" ||
        typeof p.wordCount !== "number" ||
        typeof p.confidence !== "number"
      )
        return;
      run.ocrPages.push({
        pageIndex: p.pageIndex,
        wordCount: p.wordCount,
        confidence: p.confidence,
      });
    });
  }, PHASE_EVENTS);
}

/** Reemplaza el objeto del ciclo anterior; sin listeners que lo retengan, queda para el recolector. */
export async function resetCycleRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    globalThis.__anonlyMemoryRun = {
      phases: {},
      phasesEpochMs: {},
      groupCount: 0,
      entityCount: 0,
      ocrPages: [],
      ocrWords: [],
      workerPeakByType: {},
      workerEvents: [],
    };
  });
}

// ─── La corrida ────────────────────────────────────────────────────────────

export interface LeakCyclesReport {
  readonly runId: string;
  readonly profile: string;
  readonly regime: LeakRegime;
  readonly restWindow: RestWindow;
  readonly identity: {
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string | undefined;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly capturedAt: string;
  readonly cycles: ReadonlyArray<CycleRecord>;
  readonly trends: ReadonlyArray<MetricTrend>;
  readonly verdict: LeakVerdict;
  /** La serie cruda de RSS de toda la corrida (ADR-146 §7 punto 3: se persiste la serie, no solo lo derivado). */
  readonly samples: ReadonlyArray<MemorySample>;
}

function nowAtMs(sampler: MemorySampler): number {
  return Date.now() - sampler.startedAtMs;
}

async function waitUntilAtMs(
  page: Page,
  sampler: MemorySampler,
  targetAtMs: number,
): Promise<void> {
  const remaining = targetAtMs - nowAtMs(sampler);
  if (remaining > 0) await page.waitForTimeout(remaining);
}

export async function runLeakCycles(
  page: Page,
  electronApp: ElectronApplication,
  userDataDir: string,
  runId: string,
  profile: string,
  file: E2eFilePayload,
  regime: LeakRegime,
  runTimeoutMs: number,
): Promise<LeakCyclesReport> {
  const restWindow = REST_WINDOW_BY_REGIME[regime];
  const sampler = startMemorySampling(electronApp, LEAK_SAMPLE_INTERVAL_MS);
  const heapSampler = await startHeapSampling(userDataDir, HEAP_ON_DEMAND_INTERVAL_MS);
  const cycles: CycleRecord[] = [];
  try {
    const chooser = page.getByRole("button", { name: "Elegir archivo" });
    await chooser.waitFor({ state: "visible" });
    await installCycleCollector(page);

    // Ciclo 0: la app recién abierta.
    const freshStartPressure = await readSystemMemoryPressure();
    const readyAtMs = nowAtMs(sampler);
    await waitUntilAtMs(page, sampler, readyAtMs + FRESH_WINDOW.toMs);
    const freshRest = medianOverWindow(
      sampler.samples,
      readyAtMs + FRESH_WINDOW.fromMs,
      readyAtMs + FRESH_WINDOW.toMs,
    );
    const freshHeap = summarizeHeap((await heapSampler.sampleOnce()).targets);
    const freshPostGc = await sampler.sampleOnce();
    cycles.push({
      cycle: 0,
      ok: null,
      importToReadyMs: null,
      peakSumBytes: null,
      peakTabBytes: null,
      groupCount: null,
      entityCount: null,
      ocrPageCount: null,
      nerModelLoaded: null,
      rest: freshRest,
      heap: freshHeap,
      postGcSumBytes: freshPostGc.sumWorkingSetSizeBytes,
      systemPressureAtStart: freshStartPressure,
      systemPressureAtEnd: await readSystemMemoryPressure(),
    });

    for (let cycle = 1; cycle <= LEAK_CYCLE_COUNT; cycle++) {
      await chooser.waitFor({ state: "visible" });
      await resetCycleRun(page);
      const systemPressureAtStart = await readSystemMemoryPressure();

      await page.locator('input[type="file"]').setInputFiles(file);
      await waitForRunSettled(page, runTimeoutMs);
      await page.waitForTimeout(SETTLE_GRACE_MS);
      await sampler.sampleOnce();
      const run = await readRun(page);
      const durations = computeRunDurations(run.phasesEpochMs, sampler.startedAtMs);
      const processing =
        durations.importedAtMs === null || durations.readyAtMs === null
          ? []
          : samplesBetween(sampler.samples, durations.importedAtMs, durations.readyAtMs);
      const peak = processing.reduce<MemorySample | undefined>(
        (max, s) =>
          max === undefined || s.sumWorkingSetSizeBytes > max.sumWorkingSetSizeBytes ? s : max,
        undefined,
      );

      await closeDocument(page);
      const closedAtMs = nowAtMs(sampler);
      await waitUntilAtMs(page, sampler, closedAtMs + restWindow.toMs);
      const rest = medianOverWindow(
        sampler.samples,
        closedAtMs + restWindow.fromMs,
        closedAtMs + restWindow.toMs,
      );
      const heap = summarizeHeap((await heapSampler.sampleOnce()).targets);
      const postGc = await sampler.sampleOnce();

      cycles.push({
        cycle,
        ok: run.failedAt === undefined,
        importToReadyMs: durations.totalMs,
        peakSumBytes: peak?.sumWorkingSetSizeBytes ?? null,
        peakTabBytes:
          peak === undefined
            ? null
            : peak.perProcess
                .filter((p) => p.type === "Tab")
                .reduce((acc, p) => acc + p.workingSetSizeBytes, 0),
        groupCount: run.groupCount,
        entityCount: run.entityCount,
        ocrPageCount: run.ocrPages.length,
        nerModelLoaded: "NER_MODEL_READY" in run.phases,
        rest,
        heap,
        postGcSumBytes: postGc.sumWorkingSetSizeBytes,
        systemPressureAtStart,
        systemPressureAtEnd: await readSystemMemoryPressure(),
      });
      process.stdout.write(`  ${formatCycleLine(cycles.at(-1))}\n`);
    }

    const trends = computeTrends(cycles);
    return {
      runId,
      profile,
      regime,
      restWindow,
      identity: {
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
      },
      capturedAt: new Date().toISOString(),
      cycles,
      trends,
      verdict: judgeLeak(cycles, trends),
      samples: sampler.samples,
    };
  } finally {
    sampler.stop();
    heapSampler.stop();
  }
}

// ─── Salida ────────────────────────────────────────────────────────────────

function mbOrDash(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "—" : formatMB(bytes);
}

export function formatCycleLine(r: CycleRecord | undefined): string {
  if (r === undefined) return "";
  return (
    `ciclo ${String(r.cycle).padStart(2)}: ok=${r.ok ?? "—"} ` +
    `import→Ready=${r.importToReadyMs?.toFixed(0) ?? "—"}ms pico=${mbOrDash(r.peakSumBytes)} ` +
    `reposo=${mbOrDash(r.rest?.sumBytes)} (Tab ${mbOrDash(r.rest?.byTypeBytes.Tab)}) ` +
    `tras GC=${formatMB(r.postGcSumBytes)} heap JS=${mbOrDash(r.heap.pageUsedBytes)} ` +
    `backing=${mbOrDash(r.heap.pageBackingBytes)} workers=${r.heap.workerCount} ` +
    `modelo NER cargado=${r.nerModelLoaded ?? "—"}` +
    (r.heap.unreadableCount > 0 ? ` (sin lectura: ${r.heap.unreadableCount})` : "")
  );
}

function formatTrend(t: MetricTrend): string {
  if (t.trend === null) return `  ${t.metric}: sin datos suficientes`;
  const isBytes = t.metric !== "workerCount" && t.metric !== "importToReadyMs";
  const fmt = (v: number): string => (isBytes ? formatMB(v) : v.toFixed(2));
  const se = t.trend.slopeStdErr === null ? "?" : fmt(t.trend.slopeStdErr);
  const excluded = t.excludedCycles.length > 0 ? ` (excluidos: ${t.excludedCycles.join(",")})` : "";
  return `  ${t.metric}: ${fmt(t.trend.slope)}/ciclo ± ${se} (n=${t.trend.n})${excluded}`;
}

export function printLeakCyclesReport(report: LeakCyclesReport): void {
  const v = report.verdict;
  const lines = [
    `\n=== T-9 — ${report.runId}: ${report.profile}, ${report.regime}, ventana de reposo ` +
      `[${report.restWindow.fromMs / 1000}s, ${report.restWindow.toMs / 1000}s] ===`,
    ...report.cycles.map((r) => `  ${formatCycleLine(r)}`),
    `  pendientes, ciclos ${TREND_FIRST_CYCLE}-${LEAK_CYCLE_COUNT}:`,
    ...report.trends.map(formatTrend),
    `  veredicto (plan §2.5): workers crecen=${v.workersGrow} heap crece=${v.heapGrows} ` +
      `RSS crece=${v.rssGrows} RSS confundido=${v.rssConfounded} ` +
      `(Δ compresor ${mbOrDash(v.pressureDeltaBytes.compressor)}, Δ swap ${mbOrDash(v.pressureDeltaBytes.swap)})`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function writeLeakCyclesReport(
  report: LeakCyclesReport,
  outDir: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `leak-cycles-${report.runId}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}
