/**
 * La superficie del preload tras ADR-194 §4 (ADR-132 §3): dos objetos,
 * `anonlyUpdater` y `anonlyDevice`, este último con un único campo y solo si el
 * main pasó la RAM como argumento válido. Sin canal de IPC nuevo.
 *
 * El preload se ejecuta de verdad con `electron` simulado, para ver qué
 * expone; el main no se puede montar (ver `network-destinations.test.ts`) y se
 * verifica por texto.
 */

import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { desdeLaRaiz } from "./repoRoot";
import { sinComentarios } from "./sourceText";

const exposeInMainWorld = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args) },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
}));

const ORIGINAL_ARGV = process.argv;

async function runPreload(argv: ReadonlyArray<string>): Promise<Map<string, unknown>> {
  process.argv = [...ORIGINAL_ARGV, ...argv];
  exposeInMainWorld.mockClear();
  vi.resetModules();
  await import("../preload");
  return new Map(exposeInMainWorld.mock.calls.map(([name, api]) => [name as string, api]));
}

describe("preload: anonlyDevice (ADR-194 §4)", () => {
  beforeEach(() => {
    exposeInMainWorld.mockClear();
  });
  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
  });

  it("expone anonlyUpdater y anonlyDevice, y ningún otro objeto", async () => {
    const exposed = await runPreload(["--anonly-total-memory-bytes=17179869184"]);
    expect([...exposed.keys()].sort()).toEqual(["anonlyDevice", "anonlyUpdater"]);
  });

  it("anonlyDevice tiene solo totalMemoryBytes, con el valor del argumento", async () => {
    const exposed = await runPreload(["--anonly-total-memory-bytes=17179869184"]);
    expect(exposed.get("anonlyDevice")).toEqual({ totalMemoryBytes: 17179869184 });
    expect(Object.keys(exposed.get("anonlyDevice") as object)).toEqual(["totalMemoryBytes"]);
  });

  it("sin el argumento no expone anonlyDevice, y anonlyUpdater sigue", async () => {
    const exposed = await runPreload([]);
    expect([...exposed.keys()]).toEqual(["anonlyUpdater"]);
  });

  it.each([
    ["vacío", "--anonly-total-memory-bytes="],
    ["no numérico", "--anonly-total-memory-bytes=mucha"],
    ["cero", "--anonly-total-memory-bytes=0"],
    ["negativo", "--anonly-total-memory-bytes=-8"],
    ["decimal", "--anonly-total-memory-bytes=8.5"],
    ["con sufijo", "--anonly-total-memory-bytes=16GB"],
    ["notación científica", "--anonly-total-memory-bytes=1e10"],
    ["fuera de rango entero seguro", "--anonly-total-memory-bytes=99999999999999999999"],
  ])("con un argumento inválido (%s) no expone anonlyDevice", async (_caso, argumento) => {
    const exposed = await runPreload([argumento]);
    expect(exposed.has("anonlyDevice")).toBe(false);
  });
});

describe("main: la RAM va por argumento, sin IPC nuevo (ADR-194 §4)", () => {
  const leer = async (archivo: string) =>
    sinComentarios(await readFile(desdeLaRaiz("apps/desktop-shell/src", archivo), "utf8"));

  it("pasa os.totalmem() en webPreferences.additionalArguments", async () => {
    const main = await leer("main.ts");
    expect(main).toMatch(
      /additionalArguments:\s*\[`--anonly-total-memory-bytes=\$\{.*totalmem\(\).*\}`\]/,
    );
  });

  it("los únicos canales de IPC son los tres del actualizador", async () => {
    const canales = new Set<string>();
    for (const archivo of ["main.ts", "preload.ts"]) {
      const fuente = await leer(archivo);
      for (const match of fuente.matchAll(
        /(?:ipcMain|ipcRenderer)\.(?:on|once|handle|send|invoke)\(\s*"([^"]+)"/g,
      )) {
        canales.add(match[1] ?? "");
      }
    }
    expect([...canales].sort()).toEqual([
      "updater:check",
      "updater:event",
      "updater:install",
      "updater:set-automatic-checks",
    ]);
  });
});
