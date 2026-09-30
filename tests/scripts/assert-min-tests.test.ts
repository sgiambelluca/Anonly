/**
 * `scripts/ci/assert-min-tests.mjs` (ADR-149 §1): el script que impide que un
 * gate de CI salga verde sin haber ejecutado nada. Se prueba corriéndolo como
 * lo corre el workflow (un proceso de Node contra un reporte JSON), con
 * reportes sintéticos del shape real de Playwright y de Vitest.
 *
 * Los tres casos que el gate no puede dejar pasar: reporte ausente, tests
 * salteados y menos tests ejecutados que el mínimo.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/ci/assert-min-tests.mjs");
const dir = mkdtempSync(join(tmpdir(), "assert-min-tests-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: ReadonlyArray<string>): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeReport(name: string, report: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof report === "string" ? report : JSON.stringify(report));
  return path;
}

/** Shape de `playwright test --reporter=json` (`stats`). */
function playwrightReport(stats: {
  expected: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
}): unknown {
  return {
    stats: { unexpected: 0, flaky: 0, skipped: 0, ...stats },
    suites: [],
  };
}

describe("assert-min-tests --format playwright", () => {
  it("pasa con el mínimo ejecutado y cero salteados", () => {
    const report = writeReport("ok.json", playwrightReport({ expected: 4 }));
    const { status, output } = run(["--report", report, "--min", "4", "--format", "playwright"]);
    expect(status).toBe(0);
    expect(output).toContain("OK: 4 test(s) ejecutado(s)");
  });

  it("cuenta como ejecutados los que fallaron y los flaky (corrieron de verdad)", () => {
    const report = writeReport(
      "mixed.json",
      playwrightReport({ expected: 2, unexpected: 1, flaky: 1 }),
    );
    expect(run(["--report", report, "--min", "4", "--format", "playwright"]).status).toBe(0);
  });

  it("falla con un solo test salteado", () => {
    const report = writeReport("skipped.json", playwrightReport({ expected: 4, skipped: 1 }));
    const { status, output } = run(["--report", report, "--min", "4", "--format", "playwright"]);
    expect(status).toBe(1);
    expect(output).toContain("1 test(s) salteado(s)");
  });

  it("falla sin reporte (el runner no corrió)", () => {
    const { status, output } = run([
      "--report",
      join(dir, "no-existe.json"),
      "--min",
      "4",
      "--format",
      "playwright",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("INCONCLUSO");
  });

  it("falla con menos tests ejecutados que el mínimo, y con cero", () => {
    const few = writeReport("few.json", playwrightReport({ expected: 3 }));
    expect(run(["--report", few, "--min", "4", "--format", "playwright"]).status).toBe(1);
    const none = writeReport("none.json", playwrightReport({ expected: 0 }));
    const { status, output } = run(["--report", none, "--min", "1", "--format", "playwright"]);
    expect(status).toBe(1);
    expect(output).toContain("0 test(s) ejecutado(s) < mínimo exigido 1");
  });

  it("falla con un reporte que no es JSON o no tiene la forma de Playwright", () => {
    const garbage = writeReport("garbage.json", "esto no es json");
    expect(run(["--report", garbage, "--min", "1", "--format", "playwright"]).status).toBe(1);
    const noStats = writeReport("no-stats.json", { suites: [] });
    const { status, output } = run(["--report", noStats, "--min", "1", "--format", "playwright"]);
    expect(status).toBe(1);
    expect(output).toContain("INCONCLUSO");
  });
});

describe("assert-min-tests --format vitest (default)", () => {
  it("pasa y falla igual: los pendientes cuentan como salteados", () => {
    const ok = writeReport("v-ok.json", {
      numTotalTests: 4,
      numPendingTests: 0,
      numTodoTests: 0,
    });
    expect(run(["--report", ok, "--min", "4"]).status).toBe(0);
    const skipped = writeReport("v-skip.json", {
      numTotalTests: 4,
      numPendingTests: 1,
      numTodoTests: 0,
    });
    expect(run(["--report", skipped, "--min", "1"]).status).toBe(1);
  });
});

describe("assert-min-tests, argumentos", () => {
  it("exige --report y --min", () => {
    expect(run(["--min", "1"]).status).not.toBe(0);
    const report = writeReport("args.json", playwrightReport({ expected: 1 }));
    expect(run(["--report", report]).status).not.toBe(0);
    expect(run(["--report", report, "--min", "1", "--format", "otro"]).status).not.toBe(0);
  });
});
