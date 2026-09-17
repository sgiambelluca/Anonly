/**
 * `support/aggregateMemoryReports.ts` — agrega las corridas de
 * `tests/perf/memory.spec.ts` (`.measure/memory-<perfil>-run<N>.json`) en el
 * reporte de caracterización que pide ADR-146 §15.4: máximo, mínimo y
 * variabilidad por perfil/temperatura, sin promediar un OOM (acá no hay OOM
 * que promediar — si `ok` es `false` en alguna corrida, se lista aparte y no
 * entra en los agregados numéricos).
 *
 * No es parte de la suite de Playwright: se corre a mano después de
 * `pnpm test:perf -g memory --repeat-each=N` (o del subset de perfiles que
 * corrió), leyendo lo que haya en `.measure/`.
 *
 *   pnpm tsx tests/perf/support/aggregateMemoryReports.ts
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  classifyPeakPosition,
  computeM2WithinPhases,
  computePostReadyPeakBytes,
  type PeakPosition,
  type ProfileReport,
  type RunReport,
} from "./memoryProfile.js";
import { peakSumBytes } from "./memorySampler.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../../.measure");

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function stats(values: ReadonlyArray<number>): { min: number; max: number; avg: number } {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/**
 * El piso de una fase, por proceso (ADR-159 §3): mínimo del primer cuarto de
 * la ventana de la fase contra mínimo del último cuarto — el estadístico que
 * ADR-159 §1 encontró que sí sirve para "¿se retiene algo por página?",
 * contra la regresión sobre la nube de RSS completa, que **no** se publica
 * como pendiente de acumulación (misma sección). Positivo = el piso subió
 * durante la fase; negativo = bajó.
 */
export interface ProcessFloor {
  readonly processType: string;
  readonly fromEvent: string;
  readonly toEvent: string;
  readonly firstQuarterMinBytes: number;
  readonly lastQuarterMinBytes: number;
  readonly floorDeltaBytes: number;
}

/**
 * Calcula el piso por proceso de CADA `PhaseSegment` de una corrida
 * individual — nunca promediado entre corridas (ADR-159 §3: "reportado por
 * corrida individual"). Usa `RunReport.samples` (la serie cruda que ya
 * persiste `memoryProfile.ts`, sin volver a correr nada) y agrupa por
 * `ProcessMemorySample.type` (`"Tab"`, `"GPU"`, …) sumando el RSS de todos
 * los procesos de ese tipo en cada muestra — mismo criterio de suma que usa
 * `sumWorkingSetSizeBytes` para el total, acotado a un tipo.
 *
 * Una fase con menos de una muestra en alguno de los dos cuartos queda
 * afuera (no hay piso que calcular con cero muestras) en vez de dividir por
 * cero o inventar un valor.
 */
export function computeProcessFloors(run: RunReport): ReadonlyArray<ProcessFloor> {
  // `phaseSegments`/`samples` no existen en reportes escritos antes de
  // ADR-146 §7 punto 3 (mismo criterio que `peakWithinPhases`/
  // `hotBaselineSettled` más abajo: el tipo los declara requeridos porque lo
  // son desde hoy, pero un JSON viejo en `.measure/` no los tiene — `[]` en
  // vez de reventar sobre un `.json` de antes de este campo). `=== undefined`
  // y no `Array.isArray`: sobre un tipo ya declarado `ReadonlyArray<T>`,
  // `Array.isArray` angosta la rama a `any[]` (pierde `T` — un defecto
  // conocido de sus tipos en lib.es5.d.ts), lo que corriente abajo vuelve
  // implícito el tipo de cada elemento.
  if (run.phaseSegments === undefined || run.samples === undefined) return [];

  const floors: ProcessFloor[] = [];

  for (const segment of run.phaseSegments) {
    const windowSamples = run.samples.filter(
      (s) => s.atMs >= segment.fromAtMs && s.atMs <= segment.toAtMs,
    );
    if (windowSamples.length === 0) continue;

    const processTypes = new Set<string>();
    for (const sample of windowSamples) {
      for (const p of sample.perProcess) processTypes.add(p.type);
    }

    const duration = segment.toAtMs - segment.fromAtMs;
    const firstQuarterEnd = segment.fromAtMs + duration / 4;
    const lastQuarterStart = segment.toAtMs - duration / 4;
    const firstQuarterSamples = windowSamples.filter((s) => s.atMs <= firstQuarterEnd);
    const lastQuarterSamples = windowSamples.filter((s) => s.atMs >= lastQuarterStart);
    if (firstQuarterSamples.length === 0 || lastQuarterSamples.length === 0) continue;

    for (const processType of processTypes) {
      const bytesForType = (samples: typeof windowSamples): number[] =>
        samples.map((s) =>
          s.perProcess
            .filter((p) => p.type === processType)
            .reduce((acc, p) => acc + p.workingSetSizeBytes, 0),
        );
      const firstQuarterMinBytes = Math.min(...bytesForType(firstQuarterSamples));
      const lastQuarterMinBytes = Math.min(...bytesForType(lastQuarterSamples));

      floors.push({
        processType,
        fromEvent: segment.fromEvent,
        toEvent: segment.toEvent,
        firstQuarterMinBytes,
        lastQuarterMinBytes,
        floorDeltaBytes: lastQuarterMinBytes - firstQuarterMinBytes,
      });
    }
  }

  return floors;
}

function formatSignedMB(bytes: number): string {
  const sign = bytes >= 0 ? "+" : "";
  return `${sign}${formatMB(bytes)}`;
}

/** Una línea por `ProcessFloor` — SIN promediar entre corridas (ADR-159 §3), por eso se llama con una sola corrida a la vez. */
function formatProcessFloors(floors: ReadonlyArray<ProcessFloor>): string {
  if (floors.length === 0) return "";
  return floors
    .map(
      (f) =>
        `         piso ${f.processType} (${f.fromEvent} → ${f.toEvent}): ` +
        `1er cuarto ${formatMB(f.firstQuarterMinBytes)} → ultimo cuarto ${formatMB(f.lastQuarterMinBytes)}, ` +
        `delta ${formatSignedMB(f.floorDeltaBytes)}\n`,
    )
    .join("");
}

async function main(): Promise<void> {
  const entries = await readdir(OUT_DIR);
  const reportFiles = entries.filter((f) => /^memory-.+-run\d+\.json$/.test(f));
  if (reportFiles.length === 0) {
    process.stdout.write(`Nada en ${OUT_DIR} todavía — corré tests/perf/memory.spec.ts primero.\n`);
    return;
  }

  // `runLabel` viaja pegado al reporte (no solo el objeto) para poder
  // imprimir el piso de ADR-159 §3 "por corrida individual" con una etiqueta
  // legible (`run0`, `run1`, …) en vez de un índice de array que no dice
  // nada del archivo de origen.
  interface LabeledReport {
    readonly report: ProfileReport;
    readonly runLabel: string;
  }

  const byProfile = new Map<string, LabeledReport[]>();
  for (const file of reportFiles) {
    const raw = await readFile(resolve(OUT_DIR, file), "utf-8");
    const report = JSON.parse(raw) as ProfileReport;
    const runLabel = /-(run\d+)\.json$/.exec(file)?.[1] ?? file;
    const list = byProfile.get(report.profile) ?? [];
    list.push({ report, runLabel });
    byProfile.set(report.profile, list);
  }

  for (const [profile, reports] of [...byProfile.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const first = reports[0]!.report;
    process.stdout.write(
      `\n=== ${profile} — ${reports.length} corrida(s) — ${first.identity.platform}/${first.identity.arch}, ` +
        `${first.identity.cpuCount} CPUs (${first.identity.cpuModel ?? "?"}), ` +
        `${formatMB(first.identity.totalMemBytes)} RAM ===\n`,
    );

    for (const temperature of ["cold", "hot"] as const) {
      const runs = reports.map(({ report, runLabel }) => ({ run: report[temperature], runLabel }));
      const failed = runs.filter((r) => !r.run.ok);
      const ok = runs.filter((r) => r.run.ok);

      // ADR-146 §7ter (plan A-2): la posición se RECALCULA desde `samples`/
      // `phaseSegments` crudos, nunca leída de un campo `peakPosition`/
      // `peakWithinPhases` que puede no existir en un `.json` escrito antes
      // de esta enmienda (`.measure/` es gitignoreado; un reporte viejo en
      // disco no tiene por qué haberse vuelto a correr). Recalcular desde la
      // serie persistida es justamente lo que permite reclasificar sin
      // re-correr nada — las 12 corridas del 2026-09-17 se validan así.
      // Mismo criterio, M2 y el pico posterior a Ready también se
      // recalculan: un reporte viejo tiene en `peakSumBytes` el pico GLOBAL
      // sin acotar (la definición pre-§7ter), no el de la ventana de fases.
      const withMetrics = ok.map((r) => {
        const samples = r.run.samples ?? [];
        const segments = r.run.phaseSegments ?? [];
        const peakPosition: PeakPosition = classifyPeakPosition(samples, segments);
        const m2Bytes = computeM2WithinPhases(samples, segments) ?? r.run.peakSumBytes;
        const postReadyPeakBytes = computePostReadyPeakBytes(samples, segments);
        const m1Bytes = temperature === "hot" ? m2Bytes - r.run.baselineBytes : null;
        return { ...r, peakPosition, m2Bytes, postReadyPeakBytes, m1Bytes };
      });
      // Solo "antes de DOCUMENT_IMPORTED" invalida (ADR-146 §7ter) — el caso
      // de residuo del documento anterior que motivó §7bis. "Después de la
      // última fase" pasa a ser válida desde §7ter.
      const invalidPeak = withMetrics.filter((r) => r.peakPosition === "before-imported");
      const valid = withMetrics.filter((r) => r.peakPosition !== "before-imported");

      if (failed.length > 0) {
        process.stdout.write(
          `  ${temperature}: ${failed.length}/${runs.length} corridas NO ok (PIPELINE_FAILED) — no promediadas.\n`,
        );
      }
      if (invalidPeak.length > 0) {
        process.stdout.write(
          `  ${temperature}: ${invalidPeak.length}/${runs.length} corridas con el máximo antes de ` +
            `DOCUMENT_IMPORTED (ADR-146 §7bis/§7ter — residuo del documento anterior) — no promediadas: ` +
            `${invalidPeak.map((r) => formatMB(peakSumBytes(r.run.samples ?? []))).join(", ")}.\n`,
        );
      }
      if (temperature === "hot") {
        const unsettled = ok.filter((r) => r.run.hotBaselineSettled === false);
        if (unsettled.length > 0) {
          process.stdout.write(
            `  ${temperature}: ${unsettled.length}/${runs.length} corridas con línea de base caliente ` +
              `sin asentar (venció el techo de 30s, ADR-146 §7bis) — no se descartan, pero su M1 es menos confiable.\n`,
          );
        }
      }
      if (valid.length === 0) continue;

      const afterLastPhase = valid.filter((r) => r.peakPosition === "after-last-phase");
      if (afterLastPhase.length > 0) {
        process.stdout.write(
          `  ${temperature}: ${afterLastPhase.length}/${runs.length} corridas con el máximo después de ` +
            `Ready (ADR-146 §7ter — válidas; M2 es el máximo dentro de fase, el pico posterior se reporta aparte).\n`,
        );
      }

      const m2 = stats(valid.map((r) => r.m2Bytes));
      const totals = valid.map((r) => r.run.totalMs).filter((v): v is number => v !== null);
      const timeStats = totals.length > 0 ? stats(totals) : null;
      const groupCounts = valid.map((r) => r.run.groupCount);

      process.stdout.write(
        `  ${temperature.padEnd(4)} — M2 pico (dentro de fase): min ${formatMB(m2.min)} / avg ${formatMB(m2.avg)} / max ${formatMB(m2.max)}` +
          (timeStats
            ? `  |  tiempo: min ${timeStats.min.toFixed(0)}ms / avg ${timeStats.avg.toFixed(0)}ms / max ${timeStats.max.toFixed(0)}ms`
            : "") +
          `  |  grupos: ${groupCounts.join(", ")}\n`,
      );

      // ADR-146 §7ter: métrica obligatoria, siempre al lado de M2 — nunca
      // fundida ni omitida, aunque ninguna corrida la dispare (`.length === 0`).
      const postReadyValues = valid
        .map((r) => r.postReadyPeakBytes)
        .filter((v): v is number => v !== null);
      if (postReadyValues.length > 0) {
        const postReady = stats(postReadyValues);
        process.stdout.write(
          `       pico posterior a Ready (ADR-146 §7ter, no fundido con M2): ` +
            `min ${formatMB(postReady.min)} / avg ${formatMB(postReady.avg)} / max ${formatMB(postReady.max)} ` +
            `(${postReadyValues.length}/${valid.length} corridas con muestras posteriores a Ready)\n`,
        );
      }

      if (temperature === "hot") {
        const m1Values = valid.map((r) => r.m1Bytes).filter((v): v is number => v !== null);
        if (m1Values.length > 0) {
          const m1 = stats(m1Values);
          process.stdout.write(
            `       M1 (atribuible al documento): min ${formatMB(m1.min)} / avg ${formatMB(m1.avg)} / max ${formatMB(m1.max)}\n`,
          );
        }
      }

      // ADR-159 §3: el piso, por corrida individual — nunca promediado. Es
      // deliberado que esto vaya DESPUÉS de los agregados de arriba (que sí
      // promedian M2/M1/tiempo): mezclar los dos estilos en una sola tabla
      // invitaría a leer el piso como si fuera otro promedio más.
      const floorsByRun = valid.map((r) => ({
        runLabel: r.runLabel,
        floors: computeProcessFloors(r.run),
      }));
      if (floorsByRun.some((f) => f.floors.length > 0)) {
        process.stdout.write(`       piso por proceso (ADR-159 §3, por corrida, sin promediar):\n`);
        for (const { runLabel, floors } of floorsByRun) {
          if (floors.length === 0) continue;
          process.stdout.write(`       ${runLabel}:\n${formatProcessFloors(floors)}`);
        }
      }
    }
  }
}

// Corre `main()` solo cuando este archivo es el entrypoint (`pnpm tsx
// tests/perf/support/aggregateMemoryReports.ts`), no cuando otro módulo lo
// importa por sus funciones puras (`computeProcessFloors`, exportada para
// `aggregateMemoryReports.test.ts`) — sin esto, importar el archivo para
// testear dispararía una lectura de `.measure/` como efecto de lado.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
