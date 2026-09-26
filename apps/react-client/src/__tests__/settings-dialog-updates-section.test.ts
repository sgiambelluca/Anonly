/**
 * `SettingsDialog` no tiene tests de render (sin jsdom/testing-library,
 * R-12), así que lo que ADR-188 §5 pide de la sección «Actualizaciones» —dos
 * interruptores, en ESE orden, y el nuevo con el label de `settingsCopy.ts`—
 * se verifica leyendo el propio fuente del componente, mismo mecanismo que
 * `bootstrap-order.test.ts` en `apps/desktop-shell`.
 *
 * Se sacan los comentarios antes de buscar: un comentario que mencione
 * `settings-check-updates` o `settings-auto-update` (como los que documentan
 * esta misma sección) haría pasar el test en falso si se buscara sobre el
 * texto crudo.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { UPDATE_CHECK_LABEL } from "../components/toolbar/settingsCopy.js";

const SETTINGS_DIALOG_PATH = fileURLToPath(
  new URL("../components/toolbar/SettingsDialog.tsx", import.meta.url),
);

/** Igual que `sinComentarios` de `apps/desktop-shell` (no se comparte entre paquetes). */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("sección «Actualizaciones» de SettingsDialog (ADR-188 §5)", () => {
  const fuente = sinComentarios(readFileSync(SETTINGS_DIALOG_PATH, "utf8"));

  it("el interruptor de búsqueda automática aparece antes que el de instalar", () => {
    const checkUpdatesIndex = fuente.indexOf('id="settings-check-updates"');
    const autoUpdateIndex = fuente.indexOf('id="settings-auto-update"');

    expect(checkUpdatesIndex, "falta el control settings-check-updates").toBeGreaterThan(-1);
    expect(autoUpdateIndex, "falta el control settings-auto-update").toBeGreaterThan(-1);
    expect(
      checkUpdatesIndex,
      "ADR-188 §5: «Buscar actualizaciones automáticamente» va ANTES que «Actualizar automáticamente»",
    ).toBeLessThan(autoUpdateIndex);
  });

  it("el interruptor nuevo usa la constante de settingsCopy, no un literal", () => {
    const checkUpdatesIndex = fuente.indexOf('id="settings-check-updates"');
    expect(checkUpdatesIndex).toBeGreaterThan(-1);

    // El `label` del control está a pocas líneas del `id`, dentro del mismo
    // elemento JSX: una ventana generosa alcanza sin depender del formato
    // exacto del componente.
    const cercaDelControl = fuente.slice(checkUpdatesIndex, checkUpdatesIndex + 300);
    expect(cercaDelControl).toContain("label={UPDATE_CHECK_LABEL}");
    expect(cercaDelControl).not.toContain(`label="${UPDATE_CHECK_LABEL}"`);
  });
});
