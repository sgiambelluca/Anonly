/**
 * `support/aggregateHotBaselineReports.ts` — agrega las corridas de T-7
 * (`tests/perf/hot-baseline-attribution.spec.ts`,
 * `.measure/base-caliente/<timestamp>/hot-baseline-<perfil>-<ner-on|ner-off>-run<N>.json`)
 * en una tabla legible: la curva completa por corrida (C-1/C-2) y la base
 * caliente estándar por condición (C-3).
 *
 * **Solo agrega y formatea — no interpreta.** La curva se imprime
 * corrida por corrida, nunca promediada entre sí (mismo principio que
 * ADR-159 §3 aplica al piso: promediar una serie temporal esconde justo la
 * forma que se está buscando). Si hay un escalón cerca de los 60s
 * (`idleDisposeMs`, ADR-080) o no, y qué fracción del hueco de 700 MB–1,2 GB
 * queda sin atribuir, es una lectura del informe final
 * (`docs/roadmap/Perfilado_Base_Caliente_Medicion.md`), no de este script.
 *
 *   pnpm tsx tests/perf/support/aggregateHotBaselineReports.ts <dir>
 *
 * Escribe `<dir>/summary.json` (datos) y `<dir>/summary.txt` (mismo texto
 * que imprime a stdout), para no tener que releer los 12+ JSON crudos al
 * escribir el informe.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { HotBaselineCurveReport, ReleaseCurvePoint } from "./hotBaselineCurve.js";

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatSignedMB(bytes: number): string {
  const sign = bytes >= 0 ? "+" : "";
  return `${sign}${formatMB(bytes)}`;
}

function stats(values: ReadonlyArray<number>): { min: number; max: number; avg: number } {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

/**
 * Delta entre el primer y el último checkpoint con muestra real (C-1: "el
 * delta entre t=5s y t=120s"). `null` si cualquiera de los dos extremos no
 * tiene muestra — nunca un delta calculado sobre un `null` disfrazado de 0.
 */
export interface CurveDelta {
  readonly fromTargetMs: number;
  readonly toTargetMs: number;
  readonly deltaBytes: number;
}

export function computeCurveDelta(curve: ReadonlyArray<ReleaseCurvePoint>): CurveDelta | null {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    first.sumBytes === null ||
    last.sumBytes === null
  )
    return null;
  return {
    fromTargetMs: first.targetMs,
    toTargetMs: last.targetMs,
    deltaBytes: last.sumBytes - first.sumBytes,
  };
}

/**
 * El paso consecutivo de mayor magnitud dentro de la curva (candidato a
 * "escalón", plan §3 C-1) — solo compara checkpoints adyacentes con muestra
 * en ambos lados. No afirma que sea un escalón real: eso pide juicio sobre
 * la serie completa y el contraste entre corridas, que es del informe.
 */
export interface CurveStep {
  readonly fromTargetMs: number;
  readonly toTargetMs: number;
  readonly deltaBytes: number;
}

export function computeLargestStep(curve: ReadonlyArray<ReleaseCurvePoint>): CurveStep | null {
  let largest: CurveStep | null = null;
  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const b = curve[i + 1];
    if (a === undefined || b === undefined || a.sumBytes === null || b.sumBytes === null) continue;
    const deltaBytes = b.sumBytes - a.sumBytes;
    if (largest === null || Math.abs(deltaBytes) > Math.abs(largest.deltaBytes)) {
      largest = { fromTargetMs: a.targetMs, toTargetMs: b.targetMs, deltaBytes };
    }
  }
  return largest;
}

function formatCurvePoint(point: ReleaseCurvePoint): string {
  const label = `t=${(point.targetMs / 1000).toFixed(0)}s`;
  if (point.sumBytes === null) return `      ${label}: sin muestra`;
  const breakdown = point.perProcessType.map((b) => `${b.type}=${formatMB(b.bytes)}`).join(" ");
  return `      ${label}: suma=${formatMB(point.sumBytes)}  [${breakdown}]`;
}

interface ReportEntry {
  readonly file: string;
  readonly report: HotBaselineCurveReport;
}

async function main(): Promise<void> {
  const dirArg = process.argv[2];
  if (dirArg === undefined) {
    process.stderr.write("Uso: pnpm tsx tests/perf/support/aggregateHotBaselineReports.ts <dir>\n");
    process.exitCode = 1;
    return;
  }
  const dir = resolve(dirArg);
  const entries = await readdir(dir);
  const reportFiles = entries.filter((f) => /^hot-baseline-.+-run\d+\.json$/.test(f)).sort();
  if (reportFiles.length === 0) {
    process.stdout.write(`Nada en ${dir} todavía.\n`);
    return;
  }

  const reports: ReportEntry[] = [];
  for (const file of reportFiles) {
    const raw = await readFile(resolve(dir, file), "utf-8");
    reports.push({ file, report: JSON.parse(raw) as HotBaselineCurveReport });
  }

  const byKey = new Map<string, ReportEntry[]>();
  for (const entry of reports) {
    const key = `${entry.report.profile}__${entry.report.nerEnabled ? "ner-on" : "ner-off"}`;
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }

  const lines: string[] = [];
  const summaryJson: Record<string, unknown> = {};

  for (const [key, group] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`\n=== ${key} — ${group.length} corrida(s) ===`);
    const failed = group.filter((e) => !e.report.cold.ok);
    if (failed.length > 0) {
      lines.push(`  ${failed.length}/${group.length} corridas NO ok — no entran en los agregados.`);
    }
    const ok = group.filter((e) => e.report.cold.ok);

    const baselineStats =
      ok.length > 0 ? stats(ok.map((e) => e.report.standardBaselineBytes)) : null;
    if (baselineStats !== null) {
      lines.push(
        `  base caliente estándar (≤30s, ADR-146 §7bis): min ${formatMB(baselineStats.min)} / ` +
          `avg ${formatMB(baselineStats.avg)} / max ${formatMB(baselineStats.max)}`,
      );
    }
    const unsettled = ok.filter((e) => !e.report.standardBaselineSettled);
    if (unsettled.length > 0) {
      lines.push(
        `  ${unsettled.length}/${ok.length} corridas con la base estándar SIN asentar (venció el techo de 30s).`,
      );
    }

    const perRun: unknown[] = [];
    for (const { file, report } of ok) {
      lines.push(`  ${file}:`);
      lines.push(
        `    standardBaselineBytes=${formatMB(report.standardBaselineBytes)} ` +
          `settled=${report.standardBaselineSettled} groupCount=${report.cold.groupCount}`,
      );
      lines.push(...report.curve.map(formatCurvePoint));

      const delta = computeCurveDelta(report.curve);
      if (delta !== null) {
        lines.push(
          `      delta t=${(delta.fromTargetMs / 1000).toFixed(0)}s → t=${(delta.toTargetMs / 1000).toFixed(0)}s: ${formatSignedMB(delta.deltaBytes)}`,
        );
      }
      const step = computeLargestStep(report.curve);
      if (step !== null) {
        lines.push(
          `      paso consecutivo de mayor magnitud: t=${(step.fromTargetMs / 1000).toFixed(0)}s → t=${(step.toTargetMs / 1000).toFixed(0)}s: ${formatSignedMB(step.deltaBytes)}`,
        );
      }

      perRun.push({
        file,
        standardBaselineBytes: report.standardBaselineBytes,
        standardBaselineSettled: report.standardBaselineSettled,
        systemPressureAtStart: report.systemPressureAtStart,
        systemPressureAtEnd: report.systemPressureAtEnd,
        curve: report.curve,
        curveDelta: delta,
        largestStep: step,
      });
    }

    summaryJson[key] = {
      runCount: group.length,
      failedCount: failed.length,
      standardBaselineStats: baselineStats,
      runs: perRun,
    };
  }

  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  await writeFile(resolve(dir, "summary.txt"), text);
  await writeFile(resolve(dir, "summary.json"), `${JSON.stringify(summaryJson, null, 2)}\n`);
  process.stdout.write(`\nResumen escrito en ${resolve(dir, "summary.json")} / summary.txt\n`);
}

// Mismo guard que `aggregateMemoryReports.ts`: solo corre `main()` como
// entrypoint (`pnpm tsx .../aggregateHotBaselineReports.ts <dir>`), no
// cuando otro módulo importa `computeCurveDelta`/`computeLargestStep` para
// testearlas.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
