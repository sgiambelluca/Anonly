/**
 * Pruebas estáticas de ADR-197: el instalador NSIS lleva el script que borra la
 * entrada `RunOnce` de recuperación, y el cableado del contenedor existe donde
 * debe. `main.ts` no se puede montar sin Electron real (ver
 * `network-destinations.test.ts`), así que se lee el fuente.
 */

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RUN_ONCE_KEY, RUN_ONCE_VALUE } from "../pending-install";

import { desdeLaRaiz } from "./repoRoot";
import { functionBody, sinComentarios } from "./sourceText";

const SHELL = "apps/desktop-shell";

const leer = (ruta: string): Promise<string> => readFile(desdeLaRaiz(`${SHELL}/${ruta}`), "utf8");

describe("script de NSIS (ADR-197 §5.c)", () => {
  it("electron-builder.yml incluye el script dentro de nsis", async () => {
    const builder = await leer("electron-builder.yml");
    const nsis = /^nsis:\n((?: {2}.*\n|\n)+)/m.exec(builder)?.[1] ?? "";
    expect(nsis).toMatch(/^ {2}include: assets\/installer\.nsh$/m);
  });

  it("el script define customInstall y borra el valor AnonlyUpdateRecovery de RunOnce", async () => {
    const nsh = sinComentariosNsis(await leer("assets/installer.nsh"));
    expect(nsh).toMatch(/!macro customInstall[\s\S]*!macroend/);
    expect(nsh).toContain(
      `DeleteRegValue HKCU "${RUN_ONCE_KEY.replace(/^HKCU\\/, "")}" "${RUN_ONCE_VALUE}"`,
    );
  });

  it("el instalador sigue siendo de tipo asistente para la primera instalación", async () => {
    expect(await leer("electron-builder.yml")).toMatch(/^ {2}oneClick: false$/m);
  });
});

/** Saca los comentarios `;` de NSIS. */
function sinComentariosNsis(texto: string): string {
  return texto.replace(/^\s*;.*$/gm, "");
}

describe("cableado del contenedor (ADR-197 §2, §3, §6)", () => {
  it("el preload expone setInstallOnQuit y manda updater:set-install-on-quit", async () => {
    const preload = sinComentarios(await leer("src/preload.ts"));
    expect(preload).toMatch(/setInstallOnQuit\(enabled: boolean\)/);
    expect(preload).toContain('ipcRenderer.send("updater:set-install-on-quit", enabled)');
  });

  it("main.ts: en Windows el mensaje llega a la política y el cierre pasa por onBeforeQuit", async () => {
    const main = sinComentarios(await leer("src/main.ts"));
    const startUpdater = functionBody(main, "startUpdater");
    const macStart = startUpdater.indexOf("const bridge = loadBridge(");
    const windows = startUpdater.slice(0, macStart);
    expect(windows).toContain('ipcMain.on("updater:set-install-on-quit"');
    expect(windows).toContain("windowsUpdater.setInstallOnQuit(payload)");
    expect(windows).toContain('app.on("before-quit"');
    expect(windows).toContain("windowsUpdater.onBeforeQuit(event)");
    expect(windows).toContain('ipcMain.on("updater:install", () => windowsUpdater.installNow())');
    expect(windows).toContain("cleanupInstallRecovery(");
  });

  it("main.ts: en macOS el mensaje se recibe y se ignora, sin tocar el puente", async () => {
    const main = sinComentarios(await leer("src/main.ts"));
    const startUpdater = functionBody(main, "startUpdater");
    const mac = startUpdater.slice(startUpdater.indexOf("const bridge = loadBridge("));
    expect(mac).toContain('ipcMain.on("updater:set-install-on-quit", () => undefined)');
    expect(mac).not.toContain("onBeforeQuit");
  });

  it("windows-updater.ts no deja instalar a electron-updater por su cuenta y no usa quitAndInstall sin argumentos", async () => {
    const fuente = sinComentarios(await leer("src/windows-updater.ts"));
    expect(fuente).toMatch(/autoInstallOnAppQuit\s*=\s*false/);
    expect(fuente).not.toMatch(/autoInstallOnAppQuit\s*=\s*true/);
    expect(fuente).not.toMatch(/quitAndInstall\(\s*\)/);
    expect(fuente).toContain('quitAndInstall(true, mode === "restart")');
  });

  it("el motor de instalación y la recuperación no importan Electron", async () => {
    for (const archivo of [
      "update-install-policy.ts",
      "update-install-flow.ts",
      "pending-install.ts",
      "windows-install-recovery.ts",
    ]) {
      expect(sinComentarios(await leer(`src/${archivo}`)), archivo).not.toMatch(/from "electron"/);
    }
  });

  it("reg.exe se invoca con argumentos en lista y sin shell", async () => {
    const fuente = sinComentarios(await leer("src/windows-install-recovery.ts"));
    expect(fuente).toContain("execFileSync(");
    expect(fuente).toContain("shell: false");
    expect(fuente).not.toMatch(/\bexec\(|execSync\(|spawn\(/);
  });
});
