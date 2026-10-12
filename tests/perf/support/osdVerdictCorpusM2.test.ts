import { describe, expect, it } from "vitest";

import { tokens } from "./adr190Dpi.js";
import {
  MARGIN_SPECS,
  MARGIN_STRIP_RATIO,
  NOISE_SPECS,
  PAGE_A4_HEIGHT,
  PAGE_A4_WIDTH,
  REAL_DOC_IDS,
  REAL_DOC_PAGES,
  STAMP_TEXT,
  STAMP_X_FROM_RIGHT,
  corpusEntriesM2,
  envVarOf,
  fullBodyLines,
  lcg,
  marginBodyText,
  marginEntries,
  noiseEntries,
  pageKey,
  realEntries,
} from "./osdVerdictCorpusM2.js";

describe("osdVerdictCorpusM2", () => {
  it("el ruido son 24 PDF: seis tipos, 150 y 300 dpi, derecha y girada 90°", () => {
    const entries = noiseEntries();
    expect(entries).toHaveLength(24);
    expect(new Set(entries.map((entry) => entry.label))).toEqual(
      new Set(["RU1", "RU2", "RU3", "RU4", "RU5", "RU6"]),
    );
    expect(new Set(entries.map((entry) => entry.sourceDpi))).toEqual(new Set([150, 300]));
    expect(new Set(entries.map((entry) => entry.physicalRotation))).toEqual(new Set([0, 90]));
    expect(entries.find((entry) => entry.key === "RU3-300-90")?.correctAngle).toBe(270);
    expect(entries.every((entry) => entry.noise !== null && entry.kind === "noise")).toBe(true);
  });

  it("el margen son 24 PDF: M1, M2 y M3 en los cuatro giros y a 150 y 300 dpi", () => {
    const entries = marginEntries();
    expect(entries).toHaveLength(24);
    expect(entries.filter((entry) => entry.label === "M2")).toHaveLength(8);
    expect(new Set(entries.map((entry) => entry.physicalRotation))).toEqual(
      new Set([0, 90, 180, 270]),
    );
    expect(entries.find((entry) => entry.key === "M1-150-270")?.correctAngle).toBe(90);
  });

  it("las páginas reales son 81 con los cuatro documentos y solo se arman las disponibles", () => {
    expect(REAL_DOC_IDS.map((doc) => REAL_DOC_PAGES[doc])).toEqual([20, 5, 5, 51]);
    expect(realEntries(REAL_DOC_IDS)).toHaveLength(81);
    expect(realEntries(["R2"])).toHaveLength(5);
    expect(realEntries([])).toHaveLength(0);
    expect(corpusEntriesM2(REAL_DOC_IDS)).toHaveLength(129);
    expect(corpusEntriesM2([])).toHaveLength(48);
  });

  it("una página real tiene un identificador neutro, sin giro ni ángulo conocido", () => {
    const [first] = realEntries(["R1"]);
    expect(first?.key).toBe("R1-p01");
    expect(pageKey("R4", 7)).toBe("R4-p07");
    expect(first?.correctAngle).toBeNull();
    expect(first?.physicalRotation).toBe(0);
    expect(first?.sourceDpi).toBeNull();
    expect(realEntries(["R3"])[0]?.sourceDpi).toBe(150);
    expect(realEntries(["R4"]).at(-1)?.key).toBe("R4-p51");
  });

  it("las claves de todo el corpus son únicas", () => {
    const keys = corpusEntriesM2(REAL_DOC_IDS).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("la variable de cada documento es ANONLY_REAL_DOC_<id>", () => {
    expect(REAL_DOC_IDS.map(envVarOf)).toEqual([
      "ANONLY_REAL_DOC_R1",
      "ANONLY_REAL_DOC_R2",
      "ANONLY_REAL_DOC_R3",
      "ANONLY_REAL_DOC_R4",
    ]);
  });

  describe("ruido", () => {
    it("las semillas son fijas: los mismos tipos salen idénticos", () => {
      const again = JSON.stringify(NOISE_SPECS.map((spec) => spec.ops));
      expect(JSON.stringify(NOISE_SPECS.map((spec) => spec.ops))).toBe(again);
      const next = lcg(190);
      const other = lcg(190);
      expect([next(), next(), next()]).toEqual([other(), other(), other()]);
      expect(lcg(190)()).not.toBe(lcg(191)());
    });

    it("todas las marcas caen dentro de la hoja A4", () => {
      for (const spec of NOISE_SPECS)
        for (const op of spec.ops) {
          expect(op.x).toBeGreaterThanOrEqual(0);
          expect(op.x).toBeLessThanOrEqual(PAGE_A4_WIDTH);
          expect(op.y).toBeGreaterThanOrEqual(0);
          expect(op.y).toBeLessThanOrEqual(PAGE_A4_HEIGHT);
        }
    });

    it("los tipos son los del plan: motas, sombra de borde, dos perforaciones, doblez, motas densas y motas con sombra", () => {
      const byId = (id: string) => NOISE_SPECS.find((spec) => spec.id === id);
      expect(byId("RU1")?.ops).toHaveLength(200);
      expect(byId("RU2")?.ops).toHaveLength(1);
      expect(byId("RU3")?.ops.filter((op) => op.kind === "circle")).toHaveLength(2);
      expect(byId("RU4")?.ops).toHaveLength(1);
      expect((byId("RU5")?.ops.length ?? 0) > (byId("RU1")?.ops.length ?? 0)).toBe(true);
      expect(byId("RU6")?.ops).toHaveLength(201);
    });
  });

  describe("margen", () => {
    it("M1 no tiene cuerpo, M2 es la página completa de ADR-190 y M3 tiene dos renglones", () => {
      const spec = (id: string) => {
        const found = MARGIN_SPECS.find((candidate) => candidate.id === id);
        if (found === undefined) throw new Error(id);
        return found;
      };
      expect(spec("M1").bodyLines).toEqual([]);
      expect(marginBodyText(spec("M1"))).toBe("");
      expect(spec("M2").bodyLines).toHaveLength(34);
      expect(spec("M2").bodyLines.slice(0, 3)).toEqual([
        "Documento de prueba",
        "Juan Perez",
        "DNI 34.567.891",
      ]);
      expect(fullBodyLines()[3]).toBe(
        "Registro 1 de lectura para comprobar la calidad del documento.",
      );
      expect(spec("M3").bodyLines).toEqual(["Juan Perez", "DNI 34.567.891"]);
    });

    it("el sello lleva un texto distinto del cuerpo y cae dentro de la franja de margen derecha", () => {
      expect(tokens(STAMP_TEXT)).toEqual(["maria", "gomez", "dni", "28123456"]);
      const bodyTokens = new Set(MARGIN_SPECS.flatMap((spec) => tokens(marginBodyText(spec))));
      expect(bodyTokens.has("maria")).toBe(false);
      expect(bodyTokens.has("28123456")).toBe(false);
      // La franja de ADR-121 es el 20 % derecho de la hoja.
      expect(PAGE_A4_WIDTH - STAMP_X_FROM_RIGHT).toBeGreaterThan(
        PAGE_A4_WIDTH * (1 - MARGIN_STRIP_RATIO),
      );
    });
  });
});
