import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findPackageDir,
  formatDuration,
  formatReport,
  modulePlan,
  parseArgs,
  stripAnsi,
  summarizeFailure,
  type GateResult,
} from "../../scripts/gates.js";

const ESLINT_RED = [
  "\u001b[4m/repo/packages/x/src/a.ts\u001b[24m",
  "  \u001b[2m12:5\u001b[22m  \u001b[31merror\u001b[39m  Unexpected any  \u001b[2m@typescript-eslint/no-explicit-any\u001b[22m",
  "  3:1  error  Unexpected console statement  no-console",
  "",
  "\u001b[31m✖ 2 problems (2 errors, 0 warnings)\u001b[39m",
].join("\n");

const TSC_RED = [
  "> pkg@0.0.0 typecheck",
  "packages/x/src/a.ts(10,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  "  detalle indentado",
  "Found 1 error.",
].join("\n");

const VITEST_RED = [
  " RUN  v4.1.12",
  " FAIL  tests/a.test.ts > suma > suma dos números",
  "AssertionError: expected 3 to be 4",
  "- Expected",
  "+ Received",
  " ❯ tests/a.test.ts:7:19",
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯",
  " Test Files  1 failed | 4 passed (5)",
  "      Tests  1 failed | 20 passed (21)",
].join("\n");

const PRETTIER_RED = [
  "Checking formatting...",
  "[warn] scripts/a.ts",
  "[warn] scripts/b.ts",
  "[warn] Code style issues found in 2 files. Run Prettier with --write to fix.",
].join("\n");

describe("scripts/gates: summarizeFailure (camino rojo)", () => {
  it("eslint: archivo:línea regla, sin colores", () => {
    const out = summarizeFailure("eslint", ESLINT_RED);
    expect(out).toContain(
      "/repo/packages/x/src/a.ts:12 @typescript-eslint/no-explicit-any - Unexpected any",
    );
    expect(out).toContain("/repo/packages/x/src/a.ts:3 no-console - Unexpected console statement");
    expect(out.some((l) => l.startsWith("✖ 2 problems"))).toBe(true);
    expect(out.join("\n")).not.toContain("\u001b");
  });

  it("tsc: solo las líneas de error", () => {
    const out = summarizeFailure("tsc", TSC_RED);
    expect(out).toEqual([
      "packages/x/src/a.ts(10,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it("vitest: test que falla con su aserción y los totales", () => {
    const out = summarizeFailure("vitest", VITEST_RED);
    expect(out[0]).toBe("FAIL  tests/a.test.ts > suma > suma dos números");
    expect(out).toContain("  AssertionError: expected 3 to be 4");
    expect(out).toContain("Test Files  1 failed | 4 passed (5)");
    expect(out).toContain("Tests  1 failed | 20 passed (21)");
  });

  it("vitest: unhandled error sin líneas FAIL muestra la causa, no solo los totales", () => {
    const raw = [
      " Test Files  5 passed (5)",
      "      Tests  21 passed (21)",
      "⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯",
      "Vitest caught 1 unhandled error during the test run.",
      "Error: boom en un timer",
      " ❯ src/x.ts:3:9",
    ].join("\n");
    const out = summarizeFailure("vitest", raw);
    expect(out.some((l) => l.includes("Unhandled Errors"))).toBe(true);
    expect(out).toContain("Error: boom en un timer");
    expect(out).toContain(" ❯ src/x.ts:3:9");
  });

  it("vitest: threshold de cobertura no alcanzado sin líneas FAIL", () => {
    const raw = [
      " Test Files  5 passed (5)",
      "      Tests  21 passed (21)",
      "ERROR: Coverage for lines (80.1%) does not meet global threshold (85%)",
    ].join("\n");
    const out = summarizeFailure("vitest", raw);
    expect(out).toContain("ERROR: Coverage for lines (80.1%) does not meet global threshold (85%)");
  });

  it("prettier: lista de archivos", () => {
    const out = summarizeFailure("prettier", PRETTIER_RED);
    expect(out).toContain("[warn] scripts/a.ts");
    expect(out).toContain("[warn] scripts/b.ts");
    expect(out).not.toContain("Checking formatting...");
  });

  it("si el filtro no reconoce nada, devuelve las últimas 40 líneas tal cual", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `linea ${i + 1}`).join("\n");
    const out = summarizeFailure("tsc", raw);
    expect(out).toHaveLength(40);
    expect(out[0]).toBe("linea 61");
    expect(out[39]).toBe("linea 100");
  });

  it("acota el detalle a 40 líneas e indica cuántas faltan", () => {
    const raw = Array.from({ length: 60 }, (_, i) => `a.ts(${i + 1},1): error TS1: x`).join("\n");
    const out = summarizeFailure("tsc", raw);
    expect(out).toHaveLength(41);
    expect(out[40]).toContain("+20 líneas más");
  });
});

describe("scripts/gates: formatReport (camino verde y rojo)", () => {
  const green: GateResult = { name: "lint", status: "ok", durationMs: 1500, detail: [] };
  const red: GateResult = {
    name: "typecheck",
    status: "FALLA",
    durationMs: 65000,
    detail: ["a.ts(1,1): error TS1: x"],
    logFile: ".gates-logs/02-typecheck.log",
  };

  it("verde: una línea por gate y el total", () => {
    const text = formatReport([green], [], ".gates-logs/");
    expect(text.split("\n")).toEqual([
      "ok     lint  1.5s",
      "gates: 1 ok, 0 FALLA",
      "logs completos: .gates-logs/",
    ]);
  });

  it("rojo: detalle, ruta del log y gates omitidos", () => {
    const text = formatReport([green, red], ["test"], ".gates-logs/");
    expect(text).toContain("FALLA  typecheck  1m05s");
    expect(text).toContain("    a.ts(1,1): error TS1: x");
    expect(text).toContain("    log: .gates-logs/02-typecheck.log");
    expect(text).toContain("omitidos tras la falla: test");
    expect(text).toContain("gates: 1 ok, 1 FALLA, 1 omitidos");
  });

  it("un gate que no aplica se dice explícitamente, nunca verde", () => {
    const na: GateResult = {
      name: "typecheck",
      status: "n/a",
      durationMs: 0,
      detail: ["no aplica: sin paquete"],
    };
    const text = formatReport([na], [], ".gates-logs/");
    expect(text).toContain("n/a    typecheck");
    expect(text).toContain("no aplica: sin paquete");
    expect(text).toContain("1 n/a");
  });
});

describe("scripts/gates: helpers", () => {
  it("parseArgs", () => {
    expect(parseArgs([])).toEqual({ keepGoing: false });
    expect(parseArgs(["--keep-going"])).toEqual({ keepGoing: true });
    expect(parseArgs(["--module", "packages/x"])).toEqual({
      module: "packages/x",
      keepGoing: false,
    });
    expect(parseArgs(["--module=packages/x", "--keep-going"])).toEqual({
      module: "packages/x",
      keepGoing: true,
    });
    expect(() => parseArgs(["--module"])).toThrow();
    expect(() => parseArgs(["--nope"])).toThrow();
  });

  it("stripAnsi y formatDuration", () => {
    expect(stripAnsi("\u001b[31mrojo\u001b[39m")).toBe("rojo");
    expect(formatDuration(900)).toBe("0.9s");
    expect(formatDuration(125000)).toBe("2m05s");
  });

  describe("modulePlan", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "gates-"));
      await mkdir(join(root, "packages", "p", "src"), { recursive: true });
      await mkdir(join(root, "tests", "t"), { recursive: true });
      await writeFile(
        join(root, "packages", "p", "package.json"),
        JSON.stringify({ scripts: { typecheck: "tsc" } }),
      );
      await writeFile(join(root, "package.json"), "{}");
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("arma los cuatro gates con el filtro por ruta de pnpm", () => {
      const plan = modulePlan("packages\\p\\src", root);
      expect(plan.map((g) => g.name)).toEqual(["eslint", "typecheck", "vitest", "prettier"]);
      expect(plan[1]).toMatchObject({ pnpmArgs: ["--filter", "./packages/p", "typecheck"] });
      expect(plan[2]).toMatchObject({ pnpmArgs: ["exec", "vitest", "run", "packages/p/src"] });
    });

    it("typecheck n/a si la ruta no cae en un paquete", () => {
      const plan = modulePlan("tests/t", root);
      expect(plan[1]).toHaveProperty("notApplicable");
    });

    it("falla si la ruta no existe", () => {
      expect(() => modulePlan("nada", root)).toThrow(/no existe/);
    });

    it("findPackageDir no devuelve la raíz", () => {
      expect(findPackageDir(join(root, "tests", "t"), root)).toBeUndefined();
      expect(findPackageDir(join(root, "packages", "p", "src"), root)).toBe(
        join(root, "packages", "p"),
      );
    });
  });
});
