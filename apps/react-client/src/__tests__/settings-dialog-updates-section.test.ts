/**
 * `SettingsDialog` no tiene tests de render (sin jsdom/testing-library,
 * R-12), así que lo que ADR-195 §3 pide de la sección «Actualizaciones» —un
 * selector de tres opciones en lugar de los dos interruptores de ADR-188 §5—
 * se verifica leyendo el propio fuente del componente, mismo mecanismo que
 * `bootstrap-order.test.ts` en `apps/desktop-shell`.
 *
 * Se sacan los comentarios antes de buscar: un comentario que mencione los
 * controles haría pasar el test en falso si se buscara sobre el texto crudo.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  UPDATE_MODE_DESCRIPTION,
  UPDATE_MODE_LABEL,
  UPDATE_MODE_ORDER,
  UPDATE_NETWORK_NOTICE_CHECK_OFF,
  UPDATE_SECTION_SUBTITLE,
} from "../components/toolbar/settingsCopy.js";

const SETTINGS_DIALOG_PATH = fileURLToPath(
  new URL("../components/toolbar/SettingsDialog.tsx", import.meta.url),
);

/** Igual que `sinComentarios` de `apps/desktop-shell` (no se comparte entre paquetes). */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("sección «Actualizaciones» de SettingsDialog (ADR-195 §3, textos por ADR-197 §4)", () => {
  const fuente = sinComentarios(readFileSync(SETTINGS_DIALOG_PATH, "utf8"));

  it("las tres opciones van en el orden del ADR, con sus nombres", () => {
    expect(UPDATE_MODE_ORDER).toEqual(["install", "notify", "off"]);
    expect(UPDATE_MODE_ORDER.map((mode) => UPDATE_MODE_LABEL[mode])).toEqual([
      "Instalar automáticamente",
      "Avisarme",
      "No buscar",
    ]);
  });

  it("las descripciones son las del ADR", () => {
    expect(UPDATE_MODE_DESCRIPTION).toEqual({
      install: "Busca versiones nuevas y las instala al cerrar Anonly.",
      notify: "Busca versiones nuevas y te avisa cuando están listas.",
      off: "No se conecta a internet. Podés buscar con el botón de abajo.",
    });
  });

  it("el subtítulo y la última oración del aviso de red son los del ADR", () => {
    expect(UPDATE_SECTION_SUBTITLE).toBe("Elegí qué hace Anonly con las versiones nuevas.");
    expect(UPDATE_NETWORK_NOTICE_CHECK_OFF).toBe(
      'Si elegís "No buscar", Anonly no se conecta a internet salvo que toques "Buscar actualizaciones ahora".',
    );
  });

  it("el diálogo usa un selector armado desde el orden, y ya no los dos interruptores", () => {
    expect(fuente).toContain("UPDATE_MODE_ORDER.map");
    expect(fuente).toContain("options={UPDATE_MODE_OPTIONS}");
    expect(fuente).not.toContain("settings-check-updates");
    expect(fuente).not.toContain("settings-auto-update");
  });

  it("la descripción ocupa un renglón de alto fijo", () => {
    expect(fuente).toMatch(
      /<p className="h-5 truncate [^"]*">\s*\{updateModeDescription\(updateMode, platform\)\}/,
    );
  });

  it("al guardar se avisa al shell según si se busca o no, no según el modo", () => {
    expect(fuente).toContain("searchesAutomatically(next.updateMode)");
  });
});
