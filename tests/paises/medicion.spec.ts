/**
 * Medición de la tanda 1 de la campaña de países de la 1.1.1 (CL, UY, PY, BO y
 * los tipos nuevos de AR). Plan_1.1.1.md §2, paso 2: «se mide con prototipos
 * fuera de los motores».
 *
 * NO es un gate: no afirma umbrales, no falla por un número. Imprime y guarda
 * las tablas. El nombre `.spec.ts` y el config propio dejan este archivo fuera
 * de `pnpm test` (cuyo include es `tests/**\/*.test.ts`).
 *
 *   pnpm exec vitest run --config tests/paises/vitest.paises.config.ts
 *
 * Salida: `PAISES_OUT` (por defecto, el directorio temporal del sistema).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildReport } from "./lib/report.js";

describe("medición tanda 1 (CL, UY, PY, BO, AR nuevos)", () => {
  it("arma el informe de datos", () => {
    const out = process.env["PAISES_OUT"] ?? join(tmpdir(), "anonly-paises");
    mkdirSync(out, { recursive: true });
    const { markdown, json } = buildReport();
    writeFileSync(join(out, "medicion-tablas.md"), markdown, "utf8");
    writeFileSync(join(out, "medicion-datos.json"), JSON.stringify(json, null, 2), "utf8");
    process.stdout.write(`\nMedición escrita en ${out}\n`);
    expect(markdown.length).toBeGreaterThan(0);
  });
});
