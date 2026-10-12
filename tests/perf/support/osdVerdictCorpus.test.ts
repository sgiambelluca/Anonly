import { describe, expect, it } from "vitest";

import { campaignCells, fixtureKey, tokens } from "./adr190Dpi.js";
import {
  GEOMETRIES,
  LINE_PITCH_FACTOR,
  PAGE_MARGIN_PT,
  corpusEntries,
  correctionAngle,
  expectedTextOf,
  hasText,
  isDense,
  layoutLines,
  lineFitsPage,
  type Geometry,
} from "./osdVerdictCorpus.js";

/** Ancho de juguete: medio cuerpo por carácter. Alcanza para probar la distribución. */
const measure = (text: string, size: number): number => text.length * size * 0.5;

function geometry(id: string): Geometry {
  const found = GEOMETRIES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin geometría ${id}`);
  return found;
}

describe("osdVerdictCorpus", () => {
  it("tiene las ocho geometrías de la tabla del plan, con su página, letra y renglones", () => {
    const summary = GEOMETRIES.map((g) => [
      g.id,
      g.widthPt,
      g.heightPt,
      g.fontSize,
      g.lines.length,
    ]);
    expect(summary).toEqual([
      ["N1", 595.28, 841.89, 12, 1],
      ["N2", 595.28, 841.89, 9, 1],
      ["N3", 595.28, 841.89, 14, 3],
      ["N4", 595.28, 841.89, 36, 1],
      ["N5", 612, 1008, 12, 2],
      ["N6", 420, 595, 11, 2],
      ["N7", 280, 220, 26, 2],
      ["N8", 595.28, 841.89, 10, 2],
    ]);
  });

  it("reparte el texto de la campaña anterior: todo salvo N4, que lleva la palabra y el número", () => {
    for (const g of GEOMETRIES) {
      const joined = g.lines.join(" ");
      if (g.id === "N4") {
        expect(joined).toBe("DNI 34.567.891");
        expect(tokens(expectedTextOf(g))).toEqual(["dni", "34567891"]);
      } else {
        expect(joined).toBe("Juan Perez DNI 34.567.891");
        expect(tokens(expectedTextOf(g))).toEqual(["juan", "perez", "dni", "34567891"]);
      }
    }
  });

  it("N7 usa las posiciones del E2E de ADR-190", () => {
    const lines = layoutLines(geometry("N7"), measure);
    expect(lines.map((line) => [line.x, line.y])).toEqual([
      [24, 160],
      [24, 110],
    ]);
  });

  it("N1 y N4 quedan centrados; N2 y N5 arriba contra el margen", () => {
    const [n1] = layoutLines(geometry("N1"), measure);
    expect(n1?.x).toBeCloseTo((595.28 - (n1?.width ?? 0)) / 2, 6);
    expect(n1?.y).toBeCloseTo(841.89 / 2 - 12 * 0.3, 6);
    const [n2] = layoutLines(geometry("N2"), measure);
    expect(n2?.x).toBe(PAGE_MARGIN_PT);
    expect(n2?.y).toBeCloseTo(841.89 - PAGE_MARGIN_PT - 9, 6);
    const n5 = layoutLines(geometry("N5"), measure);
    expect(n5[0]?.y).toBeCloseTo(1008 - PAGE_MARGIN_PT - 12, 6);
    expect((n5[0]?.y ?? 0) - (n5[1]?.y ?? 0)).toBeCloseTo(12 * LINE_PITCH_FACTOR, 6);
  });

  it("N3 queda abajo a la derecha, con el último renglón sobre el margen inferior", () => {
    const lines = layoutLines(geometry("N3"), measure);
    for (const line of lines) expect(line.x + line.width).toBeCloseTo(595.28 - PAGE_MARGIN_PT, 6);
    expect(lines.at(-1)?.y).toBe(PAGE_MARGIN_PT);
    expect(lines[0]?.y).toBeCloseTo(PAGE_MARGIN_PT + 2 * 14 * LINE_PITCH_FACTOR, 6);
  });

  it("N6 centra el bloque de dos renglones", () => {
    const lines = layoutLines(geometry("N6"), measure);
    const middle = ((lines[0]?.y ?? 0) + (lines[1]?.y ?? 0)) / 2 + 11 * 0.3;
    expect(middle).toBeCloseTo(595 / 2, 6);
    for (const line of lines) expect(line.x).toBeCloseTo((420 - line.width) / 2, 6);
  });

  it("N8 pone un renglón en cada mitad de la página, a la misma altura", () => {
    const [left, right] = layoutLines(geometry("N8"), measure);
    expect(left?.x).toBe(PAGE_MARGIN_PT);
    expect(right?.x).toBeCloseTo(595.28 / 2 + PAGE_MARGIN_PT, 6);
    expect((left?.x ?? 0) + (left?.width ?? 0)).toBeLessThan(595.28 / 2);
    expect(left?.y).toBe(right?.y);
  });

  it("todos los renglones entran en la página con el ancho de juguete", () => {
    for (const g of GEOMETRIES)
      for (const line of layoutLines(g, measure)) expect(lineFitsPage(line, g)).toBe(true);
  });

  it("lineFitsPage rechaza un renglón que se sale", () => {
    const g = geometry("N7");
    expect(lineFitsPage({ text: "x", x: 270, y: 100, width: 30, size: 10 }, g)).toBe(false);
    expect(lineFitsPage({ text: "x", x: 10, y: 215, width: 30, size: 10 }, g)).toBe(false);
  });

  it("el ángulo de corrección es el complemento del giro físico", () => {
    expect([0, 90, 180, 270].map((angle) => correctionAngle(angle as 0))).toEqual([
      0, 270, 180, 90,
    ]);
  });

  describe("corpusEntries", () => {
    const entries = corpusEntries();

    it("son 140 PDF: 64 viejos con texto, 12 controles y 64 de página escasa", () => {
      expect(entries).toHaveLength(140);
      expect(entries.filter((entry) => entry.set === "old-text")).toHaveLength(64);
      expect(entries.filter((entry) => entry.set === "old-control")).toHaveLength(12);
      expect(entries.filter((entry) => entry.set === "sparse")).toHaveLength(64);
      expect(new Set(entries.map((entry) => entry.key)).size).toBe(140);
    });

    it("las claves viejas son las de la campaña de ADR-190", () => {
      const oldKeys = new Set(
        [...campaignCells("quality"), ...campaignCells("controls")]
          .filter((cell) => cell.arm === "native" && cell.density !== "region")
          .map(fixtureKey),
      );
      expect(new Set(entries.filter((e) => e.set !== "sparse").map((e) => e.key))).toEqual(oldKeys);
    });

    it("las geometrías nuevas van a 150 y 300 dpi y en los cuatro giros", () => {
      const sparse = entries.filter((entry) => entry.set === "sparse");
      expect(new Set(sparse.map((entry) => entry.sourceDpi))).toEqual(new Set([150, 300]));
      expect(new Set(sparse.map((entry) => entry.physicalRotation))).toEqual(
        new Set([0, 90, 180, 270]),
      );
      expect(sparse.filter((entry) => entry.label === "N7")).toHaveLength(8);
      expect(sparse.every((entry) => entry.geometry !== null)).toBe(true);
    });

    it("cada entrada lleva el ángulo de corrección de su giro", () => {
      for (const entry of entries)
        expect(entry.correctAngle).toBe(correctionAngle(entry.physicalRotation));
      const rotated = entries.find((entry) => entry.key === "N7-300-90");
      expect(rotated?.correctAngle).toBe(270);
    });

    it("solo la página completa del corpus viejo es el control denso; los controles no tienen texto", () => {
      expect(entries.filter(isDense)).toHaveLength(16);
      expect(entries.filter(isDense).every((entry) => entry.label === "full")).toBe(true);
      expect(entries.filter((entry) => !hasText(entry))).toHaveLength(12);
    });
  });
});
