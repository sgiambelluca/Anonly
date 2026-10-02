import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  THIRD_PARTY_LICENSES_PATH,
  THIRD_PARTY_SOFTWARE,
  type ThirdPartySoftware,
} from "../components/toolbar/thirdPartySoftware.js";

const TEXT_FIELDS: ReadonlyArray<keyof ThirdPartySoftware> = ["id", "name", "usedFor", "license"];

/** Cada viñeta de la sección «Software y modelos de terceros» de `NOTICE`, en una línea. */
function readNoticeBullets(): ReadonlyArray<string> {
  const notice = readFileSync(
    fileURLToPath(new URL("../../../../NOTICE", import.meta.url)),
    "utf-8",
  ).replace(/\r\n/g, "\n");
  const start = notice.indexOf("## Software y modelos de terceros");
  expect(start).toBeGreaterThanOrEqual(0);
  const section = notice.slice(start).split("\n---")[0] ?? "";
  const bullets: string[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("- ")) bullets.push(line.slice(2).trim());
    else if (line.startsWith("  ") && bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets;
}

describe("THIRD_PARTY_SOFTWARE", () => {
  it("no está vacío, toda fila tiene los cuatro campos y los ids son únicos", () => {
    expect(THIRD_PARTY_SOFTWARE.length).toBeGreaterThan(0);
    for (const item of THIRD_PARTY_SOFTWARE) {
      for (const field of TEXT_FIELDS) {
        expect(item[field].length).toBeGreaterThan(0);
      }
    }
    const ids = THIRD_PARTY_SOFTWARE.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no lleva ninguna URL (ADR-196 §4: sin enlaces)", () => {
    for (const item of THIRD_PARTY_SOFTWARE) {
      for (const field of TEXT_FIELDS) {
        expect(item[field]).not.toMatch(/https?:\/\//);
      }
    }
  });

  // ADR-196 §6: el mismo criterio que ADR-070 §5 para los créditos.
  it("cada componente aparece en NOTICE con la misma licencia", () => {
    const bullets = readNoticeBullets();
    for (const item of THIRD_PARTY_SOFTWARE) {
      const bullet = bullets.find((entry) => entry.startsWith(`${item.name} `));
      expect(bullet, `${item.name} falta en NOTICE`).toBeDefined();
      expect(bullet, `${item.name}: licencia distinta de NOTICE`).toContain(` — ${item.license}`);
    }
  });

  it("indica la ruta del archivo de licencias dentro de la carpeta de instalación", () => {
    expect(THIRD_PARTY_LICENSES_PATH).toBe("resources/renderer/licenses/THIRD_PARTY_LICENSES.txt");
  });
});
