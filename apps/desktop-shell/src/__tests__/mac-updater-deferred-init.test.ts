/**
 * ADR-188 §3 para macOS: `bridge.init(...)` se difiere hasta el primer
 * mensaje `updater:set-automatic-checks`, y Sparkle ya no "chequea siempre"
 * (`setAutomaticChecks(true)` incondicional, el bug que este ADR corrige).
 *
 * `main.ts` importa `electron` directamente y tiene efectos de arranque a
 * nivel de módulo (`app.commandLine.appendSwitch`,
 * `protocol.registerSchemesAsPrivileged`, `bootstrap().catch(...)`), así que
 * no se puede importar en un test sin montar Electron real — mismo motivo por
 * el que `network-destinations.test.ts` y `bootstrap-order.test.ts` verifican
 * estas propiedades leyendo el fuente en vez de ejecutarlo.
 */

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";
import { functionBody, ipcHandlerBody, sinComentarios } from "./sourceText";

const MAIN = desdeLaRaiz("apps/desktop-shell/src/main.ts");

describe("init diferido de Sparkle (ADR-188 §3)", () => {
  it("no hay ningún setAutomaticChecks(true) literal", async () => {
    const fuente = sinComentarios(await readFile(MAIN, "utf8"));

    // El bug que ADR-188 corrige era exactamente esto: `bridge.setAutomaticChecks(true)`
    // incondicional en el cuerpo de `startUpdater`. Ahora el valor SIEMPRE
    // viene de `action.enabled`, nunca de un literal.
    expect(fuente).not.toMatch(/setAutomaticChecks\(\s*true\s*\)/);
  });

  it("bridge.init( aparece solo dentro del handler updater:set-automatic-checks", async () => {
    const fuente = sinComentarios(await readFile(MAIN, "utf8"));
    const startUpdaterBody = functionBody(fuente, "startUpdater");

    // La rama de Windows registra su PROPIO `updater:set-automatic-checks`
    // (delega a `windowsUpdater.setAutomaticChecks`, sin `bridge.init`
    // alguno); el de macOS es el segundo dentro de `startUpdater`. Se ubica
    // por un ancla exclusiva de la rama mac para no tomar el de Windows.
    const macSectionStart = startUpdaterBody.indexOf("const bridge = loadBridge(");
    expect(macSectionStart, "no se encontró la rama de macOS en startUpdater").toBeGreaterThan(-1);

    const { handlerBody, withoutHandler } = ipcHandlerBody(
      startUpdaterBody,
      "updater:set-automatic-checks",
      macSectionStart,
    );

    expect(handlerBody, "el handler de macOS no llama a bridge.init").toContain("bridge.init(");
    expect(
      withoutHandler,
      "bridge.init apareció fuera del handler updater:set-automatic-checks: " +
        "ADR-188 §3 exige que se difiera hasta el primer mensaje, no que se " +
        "llame directamente en el cuerpo de startUpdater",
    ).not.toContain("bridge.init(");
  });
});
