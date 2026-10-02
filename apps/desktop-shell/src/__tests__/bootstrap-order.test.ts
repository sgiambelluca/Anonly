/**
 * `startUpdater` tiene que registrar sus `ipcMain.on` ANTES de que la página
 * cargue, no después (ADR-188 §2).
 *
 * `App.tsx` manda `updater:set-automatic-checks` apenas monta, justo después
 * de `settings.load()` — típicamente antes de que `window.loadURL(...)`
 * resuelva, porque esa promesa recién cierra en `did-finish-load`. Si
 * `startUpdater` corriera después del `await window.loadURL(...)`, ese primer
 * mensaje llegaría sin ningún listener escuchando y se perdería: la app se
 * quedaría sin buscar actualizaciones automáticas para toda la ejecución, sin
 * ningún aviso.
 *
 * Este test no puede montar Electron real (ver la nota de
 * `network-destinations.test.ts`), así que verifica la propiedad por texto,
 * igual que ese gate: `startUpdater(` tiene que aparecer antes que
 * `loadURL(` dentro del cuerpo de `bootstrap`. Se sacan los comentarios antes
 * de buscar (`sinComentarios`): el comentario que documenta esta misma regla,
 * a pocas líneas de la llamada real, menciona los dos nombres y daría un
 * falso positivo si se buscara sobre el texto crudo.
 */

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";
import { functionBody, sinComentarios } from "./sourceText";

const MAIN = desdeLaRaiz("apps/desktop-shell/src/main.ts");

describe("orden de arranque del actualizador (ADR-188 §2)", () => {
  it("startUpdater se registra antes de loadURL dentro de bootstrap", async () => {
    const fuente = sinComentarios(await readFile(MAIN, "utf8"));
    const bootstrapBody = functionBody(fuente, "bootstrap");

    const startUpdaterIndex = bootstrapBody.indexOf("startUpdater(");
    const loadUrlIndex = bootstrapBody.indexOf("loadURL(");

    expect(startUpdaterIndex, "bootstrap no llama a startUpdater").toBeGreaterThan(-1);
    expect(loadUrlIndex, "bootstrap no llama a loadURL").toBeGreaterThan(-1);
    expect(
      startUpdaterIndex,
      "startUpdater tiene que registrarse antes de loadURL: si loadURL resuelve " +
        "primero, el renderer puede mandar updater:set-automatic-checks antes de " +
        "que exista el listener, y el mensaje se pierde (ADR-188 §2)",
    ).toBeLessThan(loadUrlIndex);
  });
});
