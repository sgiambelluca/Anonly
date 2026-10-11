import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { GEOMETRIES, lineFitsPage } from "./osdVerdictCorpus.js";
import { buildGeometrySource } from "./osdVerdictFixtures.js";

describe("osdVerdictFixtures", () => {
  it("genera la página de cada geometría con su tamaño y con todos los renglones adentro", async () => {
    for (const geometry of GEOMETRIES) {
      const source = await buildGeometrySource(geometry);
      const document = await PDFDocument.load(source.bytes);
      expect(document.getPageCount()).toBe(1);
      const size = document.getPage(0).getSize();
      expect(size.width).toBeCloseTo(geometry.widthPt, 6);
      expect(size.height).toBeCloseTo(geometry.heightPt, 6);
      expect(source.lines.map((line) => line.text)).toEqual(geometry.lines);
      for (const line of source.lines) expect(lineFitsPage(line, geometry)).toBe(true);
    }
  });

  it("es determinista: la misma geometría da los mismos bytes", async () => {
    const geometry = GEOMETRIES[0];
    if (geometry === undefined) throw new Error("sin geometrías");
    const first = await buildGeometrySource(geometry);
    const second = await buildGeometrySource(geometry);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  it("mide con la métrica real de Helvetica, no con el ancho de juguete", async () => {
    const geometry = GEOMETRIES.find((candidate) => candidate.id === "N4");
    if (geometry === undefined) throw new Error("sin N4");
    const source = await buildGeometrySource(geometry);
    const [line] = source.lines;
    // «DNI 34.567.891» a 36 pt: unos 260 pt de ancho, centrado en la página.
    expect(line?.width).toBeGreaterThan(200);
    expect(line?.width).toBeLessThan(330);
    expect(line?.x).toBeCloseTo((geometry.widthPt - (line?.width ?? 0)) / 2, 6);
  });
});
