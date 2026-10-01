import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";

const BUILDER = desdeLaRaiz("apps/desktop-shell/electron-builder.yml");

describe("empaquetado del renderer", () => {
  it("excluye los sourcemaps del extraResources del renderer (MVP.md Hito 12)", async () => {
    const config = await readFile(BUILDER, "utf8");
    const lines = config.split("\n");
    const start = lines.findIndex((line) => line.trim() === "to: renderer");
    expect(start, "falta el extraResources del renderer").toBeGreaterThan(-1);

    // Las claves y los ítems hijos del bloque: líneas más indentadas que `- from:`.
    const block: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (!/^ {4,}\S/.test(line)) break;
      block.push(line.trim());
    }
    const items = block.slice(block.indexOf("filter:") + 1).map((line) => line.replace(/^- /, ""));

    expect(block.indexOf("filter:"), "falta el filter del renderer").toBeGreaterThan(-1);
    expect(items).toEqual(['"**/*"', '"!**/*.map"']);
  });
});
