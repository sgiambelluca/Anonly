import { describe, expect, it } from "vitest";

import {
  ADDRESS_HEIGHT_CATEGORIES,
  ADDRESS_HEIGHT_SENTENCES,
  FILLER_AFTER,
  FILLER_BEFORE,
  expectedOutcome,
  expectedPageText,
  isYearLike,
} from "./addressHeightSentences.js";

const CUE_WORDS = [
  "domicilio",
  "domiciliado",
  "domiciliada",
  "domiciliados",
  "domiciliadas",
  "calle",
  "avenida",
  "av.",
  "avda.",
  "sito",
  "sita",
  "vive",
  "viven",
  "reside",
  "residen",
  "piso",
  "departamento",
  "depto.",
  "dpto.",
];

function sentence(id: string) {
  const found = ADDRESS_HEIGHT_SENTENCES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin oración ${id}`);
  return found;
}

describe("addressHeightSentences", () => {
  it("tiene las cantidades del plan por categoría y 76 oraciones en total", () => {
    const counts = Object.fromEntries(
      ADDRESS_HEIGHT_CATEGORIES.map((category) => [
        category,
        ADDRESS_HEIGHT_SENTENCES.filter((s) => s.category === category).length,
      ]),
    );
    expect(counts).toEqual({ A: 10, B: 10, C: 9, D: 9, E: 10, F: 10, G: 10, H: 8 });
    expect(ADDRESS_HEIGHT_SENTENCES).toHaveLength(76);
  });

  it("los ids son únicos y su letra es la categoría", () => {
    const ids = ADDRESS_HEIGHT_SENTENCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ADDRESS_HEIGHT_SENTENCES) expect(s.id.startsWith(s.category)).toBe(true);
  });

  it("en cada oración el lugar aparece y los dígitos aparecen después del lugar", () => {
    for (const s of ADDRESS_HEIGHT_SENTENCES) {
      const placeIndex = s.text.indexOf(s.place);
      expect(placeIndex, s.id).toBeGreaterThanOrEqual(0);
      expect(s.text.indexOf(s.number, placeIndex + s.place.length), s.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("G1 lleva el signo de grado (U+00B0), G2 el ordinal (U+00BA) y G9 el signo de grado", () => {
    expect(sentence("G1").text).toContain("N° 1434");
    expect(sentence("G2").text).toContain("Nº 742");
    expect(sentence("G9").text).toContain("N°98");
    expect(sentence("G1").text).not.toContain("º");
    expect(sentence("G2").text).not.toContain("°");
  });

  it("el relleno no tiene ninguna palabra de dirección y no tiene dígitos", () => {
    for (const filler of [FILLER_BEFORE, FILLER_AFTER]) {
      const words = filler.toLowerCase().split(/\s+/);
      for (const cue of CUE_WORDS) expect(words).not.toContain(cue);
      expect(filler).not.toMatch(/\d/);
      expect(filler.toLowerCase()).not.toContain("de esta ciudad");
      expect(filler.toLowerCase()).not.toContain("de la localidad");
    }
  });

  it("el texto de página esperado es relleno, oración, relleno separados por un espacio", () => {
    expect(expectedPageText(sentence("A1"))).toBe(
      `${FILLER_BEFORE} ${sentence("A1").text} ${FILLER_AFTER}`,
    );
  });

  it("isYearLike: cuatro dígitos entre 1900 y 2099", () => {
    for (const year of ["1900", "1950", "2019", "2099"]) expect(isYearLike(year)).toBe(true);
    for (const other of ["1899", "2100", "742", "12450", "1", "19500", "20.1", ""])
      expect(isYearLike(other)).toBe(false);
  });

  it("expectedOutcome sigue la regla vigente de ADR-212: dentro, salvo H4 y H5", () => {
    for (const s of ADDRESS_HEIGHT_SENTENCES) {
      const expected = expectedOutcome(s);
      if (s.id === "H4" || s.id === "H5") expect(expected, s.id).toBe("untouched");
      else expect(expected, s.id).toBe("inside");
    }
    // D y E ya no son una excepción: el año se suma, con o sin palabra de dirección.
    for (const s of ADDRESS_HEIGHT_SENTENCES.filter(
      (c) => c.category === "D" || c.category === "E",
    ))
      expect(expectedOutcome(s), s.id).toBe("inside");
  });

  it("la categoría A es la única con alturas que no parecen año; B, C, D y E son años", () => {
    for (const s of ADDRESS_HEIGHT_SENTENCES) {
      if (s.category === "A") expect(isYearLike(s.number), s.id).toBe(false);
      if (["B", "C", "D", "E", "F"].includes(s.category))
        expect(isYearLike(s.number), s.id).toBe(true);
    }
  });
});
