/**
 * Pruebas exigidas por ADR-197 §5.c sobre la parte pura de la recuperación:
 * la marca, la decisión de arranque y el armado de los argumentos de
 * `reg.exe`. Sin Windows, sin registro, sin Electron.
 */

import { describe, expect, it } from "vitest";

import {
  decideStartupRecovery,
  parsePendingInstallMark,
  recoveryCommand,
  regExePath,
  runOnceAddArgs,
  runOnceDeleteArgs,
  RUN_ONCE_KEY,
  RUN_ONCE_VALUE,
  serializePendingInstallMark,
} from "../pending-install";

const INSTALLER =
  "C:\\Users\\Usuario Prueba\\AppData\\Local\\anonly-updater\\pending\\Anonly-Setup-1.0.1.exe";

describe("marca pending-install.json", () => {
  it("ida y vuelta", () => {
    const mark = { version: "1.0.1", installerPath: INSTALLER };
    expect(parsePendingInstallMark(serializePendingInstallMark(mark))).toEqual(mark);
  });

  it.each([
    ["no es JSON", "{"],
    ["no es un objeto", "42"],
    ["null", "null"],
    ["sin versión", JSON.stringify({ installerPath: INSTALLER })],
    ["sin ruta", JSON.stringify({ version: "1.0.1" })],
    ["versión que no es texto", JSON.stringify({ version: 1, installerPath: INSTALLER })],
    ["versión vacía", JSON.stringify({ version: "", installerPath: INSTALLER })],
  ])("%s: no se lee", (_caso, texto) => {
    expect(parsePendingInstallMark(texto)).toBeNull();
  });
});

describe("decisión de arranque sobre la marca (ADR-197 §5.c)", () => {
  const mark = serializePendingInstallMark({ version: "1.0.1", installerPath: INSTALLER });

  it("sin marca no hace nada", () => {
    expect(decideStartupRecovery(null, "1.0.1")).toEqual({ kind: "none" });
  });

  it("arrancó la versión nueva: la instalación terminó, se limpia", () => {
    expect(decideStartupRecovery(mark, "1.0.1")).toEqual({ kind: "cleanup", outcome: "installed" });
  });

  it("arrancó la anterior: el instalador no tocó nada, se limpia igual", () => {
    expect(decideStartupRecovery(mark, "1.0.0")).toEqual({
      kind: "cleanup",
      outcome: "not-installed",
    });
  });

  it("una marca ilegible también se limpia", () => {
    expect(decideStartupRecovery("basura", "1.0.0")).toEqual({
      kind: "cleanup",
      outcome: "unreadable",
    });
  });
});

describe("reg.exe", () => {
  it("la ruta es absoluta, dentro de System32 de %SystemRoot%", () => {
    expect(regExePath("D:\\Windows")).toBe("D:\\Windows\\System32\\reg.exe");
  });

  it("sin SystemRoot, o con uno relativo, usa C:\\Windows y no resuelve nada por PATH", () => {
    expect(regExePath(undefined)).toBe("C:\\Windows\\System32\\reg.exe");
    expect(regExePath("Windows")).toBe("C:\\Windows\\System32\\reg.exe");
  });

  it("los argumentos para escribir son una lista con el comando entre comillas", () => {
    expect(runOnceAddArgs(INSTALLER)).toEqual([
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
      "/v",
      "AnonlyUpdateRecovery",
      "/t",
      "REG_SZ",
      "/d",
      `"${INSTALLER}" --updated /S`,
      "/f",
    ]);
    expect(RUN_ONCE_KEY).toContain("RunOnce");
    expect(RUN_ONCE_VALUE).toBe("AnonlyUpdateRecovery");
  });

  it("los argumentos para borrar apuntan al mismo valor", () => {
    expect(runOnceDeleteArgs()).toEqual([
      "delete",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
      "/v",
      "AnonlyUpdateRecovery",
      "/f",
    ]);
  });

  it("el comando es el mismo instalador, en silencio", () => {
    expect(recoveryCommand(INSTALLER)).toBe(`"${INSTALLER}" --updated /S`);
  });

  it.each([
    ["relativa", "pending\\Anonly-Setup.exe"],
    ["con comillas", 'C:\\a"b\\Anonly-Setup.exe'],
    ["con salto de línea", "C:\\a\nb\\Anonly-Setup.exe"],
  ])("una ruta %s no se registra", (_caso, ruta) => {
    expect(() => recoveryCommand(ruta)).toThrow();
    expect(() => runOnceAddArgs(ruta)).toThrow();
  });
});
