/**
 * Piso de 14 px (`UX_Guidelines.md` §9) en la UI de choques manuales. Sin librería de DOM para tests (R-12), se lee la fuente: `text-xs`
 * (12 px) no puede volver a estos dos componentes.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FILES = [
  "../components/conflicts/ManualOverlapDialog.tsx",
  "../components/toolbar/ExportButton.tsx",
] as const;

function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("piso de tipografía de la UI de choques (UX §9)", () => {
  for (const relative of FILES) {
    it(`${relative.split("/").pop()} no usa text-xs`, () => {
      const source = sinComentarios(
        readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"),
      );

      expect(source).not.toMatch(/\btext-xs\b/);
    });
  }
});
