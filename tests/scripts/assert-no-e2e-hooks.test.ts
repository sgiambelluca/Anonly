/**
 * `scripts/ci/assert-no-e2e-hooks.mjs`: el paso del workflow de release que
 * impide empaquetar un renderer construido con `VITE_E2E=1`. Se corre como lo
 * corre el workflow (un proceso de Node contra un directorio), con directorios
 * sintéticos. La verificación contra los builds reales (producción: pasa;
 * `VITE_E2E=1`: falla) es manual y está en el informe de la ronda C.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/ci/assert-no-e2e-hooks.mjs");
const root = mkdtempSync(join(tmpdir(), "assert-no-e2e-hooks-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function dist(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

function run(dir: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf-8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("assert-no-e2e-hooks", () => {
  it("pasa con un bundle de producción limpio", () => {
    const dir = dist("clean", {
      "index.html": "<html></html>",
      "assets/index-abc.js": "export const x = 1; // createCore()",
    });
    const { status, output } = run(dir);
    expect(status).toBe(0);
    expect(output).toContain("OK: 2 archivo(s)");
  });

  it.each(["anonly:engine-overrides", "__anonlyCore", "VITE_E2E"])(
    "falla si el bundle contiene %s",
    (marker) => {
      const dir = dist(`hit-${marker.replace(/\W/g, "_")}`, {
        "assets/index-abc.js": `globalThis.${"x"} = "${marker}";`,
      });
      const { status, output } = run(dir);
      expect(status).toBe(1);
      expect(output).toContain(`PROHIBIDO: "${marker}"`);
    },
  );

  it("encuentra el marcador en subdirectorios", () => {
    const dir = dist("nested", { "assets/deep/worker.mjs": "window.__anonlyCore = core;" });
    expect(run(dir).status).toBe(1);
  });

  it("ignora los sourcemaps: llevan el texto fuente, no el código que se ejecuta", () => {
    const dir = dist("map-only", {
      "assets/index-abc.js": "export const x = 1;",
      "assets/index-abc.js.map": '{"sourcesContent":["if (import.meta.env.VITE_E2E) {}"]}',
    });
    expect(run(dir).status).toBe(0);
  });

  it("falla (inconcluso) si el directorio no existe o no tiene archivos que revisar", () => {
    const missing = run(join(root, "no-existe"));
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("INCONCLUSO");

    const onlyBinary = dist("only-binary", { "assets/font.woff2": "\u0000\u0001" });
    const empty = run(onlyBinary);
    expect(empty.status).toBe(1);
    expect(empty.output).toContain("INCONCLUSO");
  });
});
