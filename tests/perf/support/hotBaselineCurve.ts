/**
 * `support/hotBaselineCurve.ts` — instrumento de T-7
 * (`docs/roadmap/Perfilado_Base_Caliente_Plan.md`): de qué está hecha la
 * base caliente que `memory.spec.ts`/`memory-attribution.spec.ts` ya miden.
 *
 * No reemplaza ni redefine `RunReport.baselineBytes` (`support/memoryProfile.ts`):
 * este archivo llama a la MISMA `waitForHotBaselineToSettle`, con el mismo
 * `HOT_BASELINE_SETTLE_CEILING_MS` de 30 s, para producir `standardBaselineBytes`
 * — el número comparable contra toda la campaña previa. La diferencia es que,
 * después de que esa función resuelve, este instrumento **sigue muestreando**
 * en vez de avanzar al import siguiente: el sampler de fondo (`memorySampler.ts`)
 * ya corre por su cuenta con un `setInterval` en el proceso de Node/Playwright,
 * así que extender la ventana de observación no toca la lógica de asentamiento
 * ni el import caliente — solo agrega lecturas posteriores.
 *
 * Los tres cortes del plan salen de una sola corrida:
 *
 * - **C-1** (`ReleaseCurvePoint[]`): `sumBytes` en cada checkpoint de
 *   `HOT_BASELINE_CURVE_CHECKPOINTS_MS`, extraídos por cercanía (`sampleNear`,
 *   ya usado por `memoryProfile.ts` para alinear límites de fase) sobre la
 *   serie cruda que el sampler ya venía acumulando — sin sondeo activo por
 *   checkpoint, así que un `evaluate()` lento no puede hacer que un checkpoint
 *   temprano contamine el tiempo de espera de uno tardío.
 * - **C-2** (`ReleaseCurvePoint.perProcessType`): las muestras de
 *   `memorySampler.ts` ya traen `perProcess` (`{pid, type, workingSetSizeBytes}`)
 *   — `aggregateByProcessType` solo agrupa por `type` (Tab/GPU/Browser/Utility),
 *   sumando cuando hay más de un proceso del mismo tipo vivo a la vez.
 * - **C-3**: no vive acá. Es el mismo `nerEnabled` de siempre
 *   (`installSettingsOverride`, precedente en `memory-attribution.spec.ts`
 *   "P2-attrib — NER apagado") aplicado antes de `openApp`, y el spec de T-7
 *   guarda qué condición corrió en `HotBaselineCurveReport.nerEnabled` para
 *   poder comparar `standardBaselineBytes` entre condiciones después.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ElectronApplication, Page } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import {
  closeDocument,
  computeRunDurations,
  formatMB,
  installRunCollector,
  readRun,
  SAMPLE_INTERVAL_MS,
  SETTLE_GRACE_MS,
  waitForHotBaselineToSettle,
  waitForRunSettled,
} from "./memoryProfile.js";
import {
  sampleNear,
  samplesSince,
  startMemorySampling,
  type MemorySample,
} from "./memorySampler.js";
import {
  formatSystemMemoryPressure,
  readSystemMemoryPressure,
  type SystemMemoryPressureSample,
} from "./systemMemoryPressure.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../../.measure/base-caliente");

/**
 * Puntos mínimos que pide el plan §3 C-1: "t = 5, 15, 30, 45, 60, 75, 90 y
 * 120 s como mínimo". `60_000` es el candidato a escalón (`idleDisposeMs`,
 * ADR-080); el resto acota la forma de la curva alrededor de él.
 */
export const HOT_BASELINE_CURVE_CHECKPOINTS_MS: ReadonlyArray<number> = [
  5_000, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 120_000,
];

/**
 * Ventana total de observación tras `closeDocument()`. Mayor que el último
 * checkpoint (120 s) para que ese punto tenga una muestra real cerca, no la
 * más próxima de un corte justo en el borde de la espera.
 */
export const HOT_BASELINE_CURVE_WINDOW_MS = 125_000;

/** RSS sumado de un `type` de proceso (Tab/GPU/Browser/Utility/...) dentro de una sola muestra — C-2. */
export interface ProcessTypeBreakdown {
  readonly type: string;
  readonly bytes: number;
}

/** Agrupa `MemorySample.perProcess` por `type`, sumando cuando hay más de un proceso del mismo tipo vivo. Orden estable (alfabético) para diffs legibles entre puntos. */
export function aggregateByProcessType(sample: MemorySample): ReadonlyArray<ProcessTypeBreakdown> {
  const byType = new Map<string, number>();
  for (const p of sample.perProcess) {
    byType.set(p.type, (byType.get(p.type) ?? 0) + p.workingSetSizeBytes);
  }
  return [...byType.entries()]
    .map(([type, bytes]) => ({ type, bytes }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/**
 * Un punto de la curva de liberación (C-1/C-2). `sumBytes`/`perProcessType`
 * son `null`/`[]` cuando no hay ninguna muestra todavía a esa distancia del
 * cierre — nunca un 0 fabricado (mismo criterio que `PhaseSegment.measurable`
 * en `memoryProfile.ts`: declarar "no medible" en vez de inventar un valor).
 */
export interface ReleaseCurvePoint {
  /** El checkpoint pedido, p. ej. `60_000` para "60 s tras el cierre". */
  readonly targetMs: number;
  /** Cuándo cayó la muestra usada, relativo al cierre — `null` si no hay muestra. */
  readonly relativeAtMs: number | null;
  /** Distancia entre `targetMs` y la muestra usada — cuán exacto es este punto. `null` sin muestra. */
  readonly lagMs: number | null;
  readonly sumBytes: number | null;
  readonly perProcessType: ReadonlyArray<ProcessTypeBreakdown>;
}

/**
 * Extrae un `ReleaseCurvePoint` por checkpoint desde la serie cruda del
 * sampler — `samples` es la serie COMPLETA (no pre-filtrada), porque
 * `MemorySample.atMs` es relativo al arranque del sampler, no al cierre del
 * documento; `sinceMs` es el `atMs` de esa serie que corresponde al cierre
 * (`sampler.samples.at(-1)?.atMs` justo después de `closeDocument()`).
 */
export function computeReleaseCurve(
  samples: ReadonlyArray<MemorySample>,
  sinceMs: number,
  checkpoints: ReadonlyArray<number> = HOT_BASELINE_CURVE_CHECKPOINTS_MS,
): ReadonlyArray<ReleaseCurvePoint> {
  return checkpoints.map((targetMs) => {
    const absoluteTargetMs = sinceMs + targetMs;
    const sample = sampleNear(samples, absoluteTargetMs);
    if (sample === undefined) {
      return { targetMs, relativeAtMs: null, lagMs: null, sumBytes: null, perProcessType: [] };
    }
    return {
      targetMs,
      relativeAtMs: sample.atMs - sinceMs,
      lagMs: Math.abs(sample.atMs - absoluteTargetMs),
      sumBytes: sample.sumWorkingSetSizeBytes,
      perProcessType: aggregateByProcessType(sample),
    };
  });
}

/** Resumen de la corrida fría única de esta medición — sin corrida caliente: T-7 no reprocesa un segundo documento, solo observa lo que queda tras cerrar el primero. */
export interface HotBaselineColdRun {
  readonly ok: boolean;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly totalMs: number | null;
}

export interface HotBaselineCurveReport {
  readonly profile: string;
  /** La condición de C-3 — `installSettingsOverride({nerEnabled})` aplicado antes de `openApp`. */
  readonly nerEnabled: boolean;
  readonly identity: {
    readonly commit: string | undefined;
    readonly platform: string;
    readonly arch: string;
    readonly cpuModel: string | undefined;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly capturedAt: string;
  /** Presión de memoria del sistema (ADR-146 §7ter) — obligatoria para que dos sesiones sean comparables. */
  readonly systemPressureAtStart: SystemMemoryPressureSample;
  readonly systemPressureAtEnd: SystemMemoryPressureSample;
  readonly cold: HotBaselineColdRun;
  /**
   * Misma definición que `RunReport.baselineBytes`/`hotBaselineSettled`
   * (ADR-146 §7bis) — calculada por la MISMA función (`waitForHotBaselineToSettle`),
   * no reimplementada. Es el número que se compara contra la campaña previa
   * y entre condiciones de C-3.
   */
  readonly standardBaselineBytes: number;
  readonly standardBaselineSettled: boolean;
  readonly curve: ReadonlyArray<ReleaseCurvePoint>;
  /**
   * La serie cruda completa desde el cierre (ADR-146 §7 punto 3: "hay que
   * persistir la serie, no solo el máximo") — permite re-segmentar con otros
   * checkpoints o graficar sin volver a correr el import.
   */
  readonly samplesSinceClose: ReadonlyArray<MemorySample>;
}

/**
 * Corre UN import (frío) y observa la ventana posterior al cierre — sin
 * import caliente: T-7 pregunta qué queda retenido después de cerrar el
 * primer documento, no cómo procesa el segundo. `nerEnabled` es solo para
 * que el reporte quede rotulado; instalar el override real
 * (`installSettingsOverride`) es responsabilidad del caller, antes de
 * `openApp` — igual que el resto del arnés (ADR-155).
 */
export async function measureHotBaselineCurve(
  page: Page,
  electronApp: ElectronApplication,
  profile: string,
  nerEnabled: boolean,
  file: E2eFilePayload,
  runTimeoutMs = 180_000,
  sampleIntervalMs = SAMPLE_INTERVAL_MS,
  observationWindowMs = HOT_BASELINE_CURVE_WINDOW_MS,
  checkpoints: ReadonlyArray<number> = HOT_BASELINE_CURVE_CHECKPOINTS_MS,
): Promise<HotBaselineCurveReport> {
  const sampler = startMemorySampling(electronApp, sampleIntervalMs);
  try {
    await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
    await installRunCollector(page);

    const systemPressureAtStart = await readSystemMemoryPressure();

    await page.locator('input[type="file"]').setInputFiles(file);
    await waitForRunSettled(page, runTimeoutMs);
    await page.waitForTimeout(SETTLE_GRACE_MS);
    await sampler.sampleOnce();
    const run = await readRun(page);
    const durations = computeRunDurations(run.phasesEpochMs, sampler.startedAtMs);

    await closeDocument(page);
    const sinceMs = sampler.samples.at(-1)?.atMs ?? 0;

    // Mismo techo de 30s, misma función — ver el comentario de cabecera.
    const { baselineBytes: standardBaselineBytes, settled: standardBaselineSettled } =
      await waitForHotBaselineToSettle(page, sampler, sinceMs);

    // El asentamiento estándar ya consumió parte de la ventana (hasta 30s);
    // solo se espera lo que falte para llegar a `observationWindowMs` desde
    // el cierre, nunca una ventana adicional completa encima.
    const elapsedSoFarMs = (sampler.samples.at(-1)?.atMs ?? sinceMs) - sinceMs;
    const remainingMs = Math.max(0, observationWindowMs - elapsedSoFarMs);
    if (remainingMs > 0) await page.waitForTimeout(remainingMs);
    await sampler.sampleOnce();

    const systemPressureAtEnd = await readSystemMemoryPressure();

    const curve = computeReleaseCurve(sampler.samples, sinceMs, checkpoints);
    const samplesSinceClose = samplesSince(sampler.samples, sinceMs);

    return {
      profile,
      nerEnabled,
      identity: {
        commit: process.env.GITHUB_SHA,
        platform: os.platform(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
      },
      capturedAt: new Date().toISOString(),
      systemPressureAtStart,
      systemPressureAtEnd,
      cold: {
        ok: run.failedAt === undefined,
        groupCount: run.groupCount,
        entityCount: run.entityCount,
        totalMs: durations.totalMs,
      },
      standardBaselineBytes,
      standardBaselineSettled,
      curve,
      samplesSinceClose,
    };
  } finally {
    sampler.stop();
  }
}

function formatCurvePoint(point: ReleaseCurvePoint): string {
  const label = `t=${(point.targetMs / 1000).toFixed(0)}s`;
  if (point.sumBytes === null) return `    ${label}: sin muestra en esta ventana`;
  const breakdown = point.perProcessType.map((b) => `${b.type}=${formatMB(b.bytes)}`).join(" ");
  const actualS = point.relativeAtMs === null ? "?" : (point.relativeAtMs / 1000).toFixed(1);
  const lagLabel = point.lagMs === null ? "?" : point.lagMs.toFixed(0);
  return (
    `    ${label} (muestra real a ${actualS}s, lag ${lagLabel}ms): ` +
    `suma=${formatMB(point.sumBytes)}  [${breakdown}]`
  );
}

export function printHotBaselineCurveReport(report: HotBaselineCurveReport): void {
  const lines = [
    `\n=== T-7 — curva de base caliente — ${report.profile} (NER ${report.nerEnabled ? "ON" : "OFF"}) ===`,
    `  ${report.identity.platform}/${report.identity.arch}, ${report.identity.cpuCount} CPUs, ` +
      `${formatMB(report.identity.totalMemBytes)} RAM`,
    `  frío: ok=${report.cold.ok} grupos=${report.cold.groupCount} entidades=${report.cold.entityCount} ` +
      `total=${report.cold.totalMs?.toFixed(0) ?? "?"}ms`,
    `  presión del sistema — apertura: ${formatSystemMemoryPressure(report.systemPressureAtStart)}`,
    `                         cierre:   ${formatSystemMemoryPressure(report.systemPressureAtEnd)}`,
    `  base caliente estándar (ventana ≤30s, ADR-146 §7bis): ${formatMB(report.standardBaselineBytes)} ` +
      `(asentada: ${report.standardBaselineSettled ? "sí" : "NO — venció el techo de 30s"})`,
    `  curva de liberación tras cerrar el documento:`,
    ...report.curve.map(formatCurvePoint),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Un archivo por corrida, bajo `outDir` (default `.measure/base-caliente/`) — mismo criterio que `writeReport` de `memoryProfile.ts`: nunca pisar corridas anteriores. */
export async function writeHotBaselineCurveReport(
  report: HotBaselineCurveReport,
  runLabel: string,
  outDir: string = OUT_DIR,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const nerLabel = report.nerEnabled ? "ner-on" : "ner-off";
  const outFile = resolve(outDir, `hot-baseline-${report.profile}-${nerLabel}-${runLabel}.json`);
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Medición escrita en ${outFile}\n`);
}
