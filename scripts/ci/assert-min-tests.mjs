#!/usr/bin/env node
/**
 * ADR-149 §1: "un gate que no ejecuta nada es rojo". Este script cierra el
 * agujero que motivó el ADR — un job de CI que sale verde con `has_tests=false`
 * cuando el directorio no existe o cuando Vitest saltea todos los tests — leyendo
 * el reporte JSON real del runner (Vitest hoy; Playwright, para perf/leak/stress,
 * queda soportado desde el día uno aunque la ronda A solo lo cablea para
 * `test:cancel` — Performance/Leak/Stress se cablean en la ronda C) y
 * comparando contra un mínimo explícito.
 *
 * Falla (`process.exitCode = 1`) si:
 *   - el archivo de reporte no existe o no es JSON válido ("inconcluso" — el
 *     job no corrió, no que el gate detectó una regresión);
 *   - los tests EJECUTADOS (sin contar los salteados) son menos que `--min`;
 *   - hay algún test salteado (`skipped > 0`) — un `.skip`/`.todo` que se cuela
 *     produce el mismo verde falso que un directorio ausente.
 *
 * Uso:
 *   node scripts/ci/assert-min-tests.mjs --report <path> --min <n> [--format vitest|playwright]
 *
 * `--format` default `vitest`. El propio caller (el step de CI) es responsable
 * de correr el runner con el reporter JSON apuntando a `--report` ANTES de
 * invocar este script — no lo hace por sí solo, para no atarse a un comando de
 * runner particular (Vitest hoy, Playwright en la ronda C).
 */
import { readFile } from "node:fs/promises";

/** @typedef {{ readonly executed: number; readonly skipped: number }} Counts */

/**
 * Vitest `--reporter=json`: `numTotalTests` YA incluye los salteados
 * (`numPendingTests`) y los `todo` (`numTodoTests`) — "ejecutados" es el
 * total menos esos dos.
 * @param {unknown} report
 * @returns {Counts}
 */
function countsFromVitestReport(report) {
  if (typeof report !== "object" || report === null) {
    throw new Error("El reporte de Vitest no es un objeto JSON.");
  }
  const r = /** @type {Record<string, unknown>} */ (report);
  const total = r.numTotalTests;
  const pending = r.numPendingTests;
  const todo = r.numTodoTests;
  if (typeof total !== "number" || typeof pending !== "number" || typeof todo !== "number") {
    throw new Error(
      "El reporte de Vitest no tiene la forma esperada " +
        "(numTotalTests/numPendingTests/numTodoTests numéricos).",
    );
  }
  const skipped = pending + todo;
  return { executed: total - skipped, skipped };
}

/**
 * Playwright `--reporter=json`: `stats.expected`/`unexpected`/`flaky` son
 * ejecutados (corrieron de verdad, hayan pasado o no); `stats.skipped` no.
 * Sin cablear a ningún job todavía (ronda C) — implementado para que el
 * script no cambie de forma cuando llegue ese cableado.
 * @param {unknown} report
 * @returns {Counts}
 */
function countsFromPlaywrightReport(report) {
  if (typeof report !== "object" || report === null) {
    throw new Error("El reporte de Playwright no es un objeto JSON.");
  }
  const stats = /** @type {Record<string, unknown>} */ (report).stats;
  if (typeof stats !== "object" || stats === null) {
    throw new Error("El reporte de Playwright no tiene 'stats'.");
  }
  const s = /** @type {Record<string, unknown>} */ (stats);
  const { expected, unexpected, flaky, skipped } = s;
  if (
    typeof expected !== "number" ||
    typeof unexpected !== "number" ||
    typeof flaky !== "number" ||
    typeof skipped !== "number"
  ) {
    throw new Error(
      "El reporte de Playwright no tiene la forma esperada " +
        "(stats.expected/unexpected/flaky/skipped numéricos).",
    );
  }
  return { executed: expected + unexpected + flaky, skipped };
}

/**
 * @param {ReadonlyArray<string>} argv
 * @returns {{ readonly report: string; readonly min: number; readonly format: "vitest" | "playwright" }}
 */
function parseArgs(argv) {
  /** @type {string | undefined} */
  let report;
  /** @type {number | undefined} */
  let min;
  /** @type {string} */
  let format = "vitest";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") {
      report = argv[i + 1];
      i += 1;
    } else if (arg === "--min") {
      const raw = argv[i + 1];
      min = raw === undefined ? undefined : Number(raw);
      i += 1;
    } else if (arg === "--format") {
      format = argv[i + 1] ?? format;
      i += 1;
    }
  }
  if (report === undefined) throw new Error("Falta --report <path>.");
  if (min === undefined || !Number.isInteger(min) || min < 1) {
    throw new Error("Falta --min <n> (entero ≥ 1).");
  }
  if (format !== "vitest" && format !== "playwright") {
    throw new Error(`--format desconocido: "${format}" (esperado "vitest" o "playwright").`);
  }
  return { report, min, format };
}

async function main() {
  const { report: reportPath, min, format } = parseArgs(process.argv.slice(2));

  /** @type {unknown} */
  let raw;
  try {
    raw = await readFile(reportPath, "utf-8");
  } catch (err) {
    console.error(
      `INCONCLUSO: no se pudo leer el reporte "${reportPath}" (${err instanceof Error ? err.message : String(err)}). ` +
        "El job no corrió el runner, o el runner no escribió el reporte — no es lo mismo que una regresión.",
    );
    process.exitCode = 1;
    return;
  }

  /** @type {unknown} */
  let report;
  try {
    report = JSON.parse(/** @type {string} */ (raw));
  } catch (err) {
    console.error(
      `INCONCLUSO: el reporte "${reportPath}" no es JSON válido (${err instanceof Error ? err.message : String(err)}).`,
    );
    process.exitCode = 1;
    return;
  }

  /** @type {Counts} */
  let counts;
  try {
    counts =
      format === "vitest" ? countsFromVitestReport(report) : countsFromPlaywrightReport(report);
  } catch (err) {
    console.error(`INCONCLUSO: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const reasons = [];
  if (counts.skipped > 0) {
    reasons.push(`${counts.skipped} test(s) salteado(s) — se exige 0 (ADR-149 §1).`);
  }
  if (counts.executed < min) {
    reasons.push(`${counts.executed} test(s) ejecutado(s) < mínimo exigido ${min}.`);
  }

  if (reasons.length > 0) {
    console.error(`NO CUMPLE: ${reasons.join(" ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `OK: ${counts.executed} test(s) ejecutado(s) (mínimo ${min}), 0 salteado(s) — "${reportPath}".`,
  );
}

await main();
