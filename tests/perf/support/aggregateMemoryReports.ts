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
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../../.measure");

interface RunReport {
  readonly temperature: "cold" | "hot";
  readonly baselineBytes: number;
  readonly peakSumBytes: number;
  readonly m1Bytes: number | null;
  readonly totalMs: number | null;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly ok: boolean;
  /** ADR-146 §7bis: `false` si el pico de la corrida cae fuera de toda fase (residuo del documento anterior, no de este) — no se promedia. `undefined` en reportes de antes de este campo. */
  readonly peakWithinPhases?: boolean;
  /** ADR-146 §7bis: `false` si la línea de base caliente no llegó a asentar dentro del techo de 30s — la corrida sigue en pie, solo queda marcada. `undefined`/`null` en frío o en reportes de antes de este campo. */
  readonly hotBaselineSettled?: boolean | null;
}

interface ProfileReport {
  readonly profile: string;
  readonly identity: {
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

async function main(): Promise<void> {
  const entries = await readdir(OUT_DIR);
  const reportFiles = entries.filter((f) => /^memory-.+-run\d+\.json$/.test(f));
  if (reportFiles.length === 0) {
    process.stdout.write(`Nada en ${OUT_DIR} todavía — corré tests/perf/memory.spec.ts primero.\n`);
    return;
  }

  const byProfile = new Map<string, ProfileReport[]>();
  for (const file of reportFiles) {
    const raw = await readFile(resolve(OUT_DIR, file), "utf-8");
    const report = JSON.parse(raw) as ProfileReport;
    const list = byProfile.get(report.profile) ?? [];
    list.push(report);
    byProfile.set(report.profile, list);
  }

  for (const [profile, reports] of [...byProfile.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const first = reports[0]!;
    process.stdout.write(
      `\n=== ${profile} — ${reports.length} corrida(s) — ${first.identity.platform}/${first.identity.arch}, ` +
        `${first.identity.cpuCount} CPUs (${first.identity.cpuModel ?? "?"}), ` +
        `${formatMB(first.identity.totalMemBytes)} RAM ===\n`,
    );

    for (const temperature of ["cold", "hot"] as const) {
      const runs = reports.map((r) => r[temperature]);
      const failed = runs.filter((r) => !r.ok);
      const ok = runs.filter((r) => r.ok);
      // ADR-146 §7bis: un pico fuera de toda fase es el residuo del
      // documento anterior, no de este — se reporta, no se promedia.
      // `peakWithinPhases === false` explícito la invalida; `undefined`
      // (reportes de antes de este campo) se trata como válida.
      const invalidPeak = ok.filter((r) => r.peakWithinPhases === false);
      const valid = ok.filter((r) => r.peakWithinPhases !== false);

      if (failed.length > 0) {
        process.stdout.write(
          `  ${temperature}: ${failed.length}/${runs.length} corridas NO ok (PIPELINE_FAILED) — no promediadas.\n`,
        );
      }
      if (invalidPeak.length > 0) {
        process.stdout.write(
          `  ${temperature}: ${invalidPeak.length}/${runs.length} corridas con pico fuera de toda fase ` +
            `(ADR-146 §7bis — residuo del documento anterior) — no promediadas: ` +
            `${invalidPeak.map((r) => formatMB(r.peakSumBytes)).join(", ")}.\n`,
        );
      }
      if (temperature === "hot") {
        const unsettled = ok.filter((r) => r.hotBaselineSettled === false);
        if (unsettled.length > 0) {
          process.stdout.write(
            `  ${temperature}: ${unsettled.length}/${runs.length} corridas con línea de base caliente ` +
              `sin asentar (venció el techo de 30s, ADR-146 §7bis) — no se descartan, pero su M1 es menos confiable.\n`,
          );
        }
      }
      if (valid.length === 0) continue;

      const m2 = stats(valid.map((r) => r.peakSumBytes));
      const totals = valid.map((r) => r.totalMs).filter((v): v is number => v !== null);
      const timeStats = totals.length > 0 ? stats(totals) : null;
      const groupCounts = valid.map((r) => r.groupCount);

      process.stdout.write(
        `  ${temperature.padEnd(4)} — M2 pico: min ${formatMB(m2.min)} / avg ${formatMB(m2.avg)} / max ${formatMB(m2.max)}` +
          (timeStats
            ? `  |  tiempo: min ${timeStats.min.toFixed(0)}ms / avg ${timeStats.avg.toFixed(0)}ms / max ${timeStats.max.toFixed(0)}ms`
            : "") +
          `  |  grupos: ${groupCounts.join(", ")}\n`,
      );

      if (temperature === "hot") {
        const m1Values = valid.map((r) => r.m1Bytes).filter((v): v is number => v !== null);
        if (m1Values.length > 0) {
          const m1 = stats(m1Values);
          process.stdout.write(
            `       M1 (atribuible al documento): min ${formatMB(m1.min)} / avg ${formatMB(m1.avg)} / max ${formatMB(m1.max)}\n`,
          );
        }
      }
    }
  }
}

await main();
