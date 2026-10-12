import { describe, expect, it } from "vitest";

import { FILLER_AFTER, FILLER_BEFORE } from "./addressHeightSentences.js";
import {
  ADDRESS_KEYWORD_BASES,
  ADDRESS_KEYWORD_PAGES,
  KEYWORD_CATEGORIES,
  KEYWORD_SCRIPTS,
  applyScript,
  expectedKeywordPageText,
  keywordPageParagraphs,
  presentParts,
  type KeywordPage,
} from "./addressKeywordSentences.js";

function base(id: string) {
  const found = ADDRESS_KEYWORD_BASES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin oración ${id}`);
  return found;
}

function page(id: string) {
  const found = ADDRESS_KEYWORD_PAGES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin página ${id}`);
  return found;
}

/** Las partes presentes aparecen textuales en la oración y en el orden vía, nombre, altura, resto. */
function partsInOrder(target: Pick<KeywordPage, "text" | "parts">): boolean {
  let cursor = 0;
  for (const part of presentParts(target.parts)) {
    const index = target.text.indexOf(part.text, cursor);
    if (index < 0) return false;
    cursor = index + part.text.length;
  }
  return true;
}

describe("addressKeywordSentences", () => {
  it("tiene las 55 oraciones base del anexo, con las cantidades por categoría", () => {
    const counts = Object.fromEntries(
      KEYWORD_CATEGORIES.map((category) => [
        category,
        ADDRESS_KEYWORD_BASES.filter((s) => s.category === category).length,
      ]),
    );
    expect(counts).toEqual({ K1: 9, K2: 7, K3: 7, K4: 5, K5: 6, K6: 6, K7: 6, K8: 9 });
    expect(ADDRESS_KEYWORD_BASES).toHaveLength(55);
  });

  it("son 165 páginas: cada base en las tres escrituras, con ids únicos", () => {
    expect(ADDRESS_KEYWORD_PAGES).toHaveLength(165);
    const ids = ADDRESS_KEYWORD_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(165);
    for (const script of KEYWORD_SCRIPTS)
      expect(ADDRESS_KEYWORD_PAGES.filter((p) => p.script === script)).toHaveLength(55);
    for (const b of ADDRESS_KEYWORD_BASES)
      expect(ADDRESS_KEYWORD_PAGES.filter((p) => p.baseId === b.id).map((p) => p.script)).toEqual([
        "n",
        "M",
        "S",
      ]);
  });

  it("los ids de las bases son únicos y su prefijo es la categoría", () => {
    const ids = ADDRESS_KEYWORD_BASES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ADDRESS_KEYWORD_BASES) expect(s.id.startsWith(`${s.category}-`)).toBe(true);
  });

  it("cada parte no vacía aparece textual en su oración y en ese orden, en las tres escrituras", () => {
    for (const s of ADDRESS_KEYWORD_BASES) expect(partsInOrder(s), s.id).toBe(true);
    for (const p of ADDRESS_KEYWORD_PAGES) expect(partsInOrder(p), p.id).toBe(true);
  });

  it("toda oración base fuera de K8 tiene nombre; K8 no tiene ninguna parte", () => {
    for (const s of ADDRESS_KEYWORD_BASES) {
      if (s.category === "K8") expect(presentParts(s.parts), s.id).toEqual([]);
      else expect(s.parts.nombre, s.id).not.toBeNull();
    }
  });

  it("las categorías sin altura (K5-3, K5-5 y K6) y el resto de K7 son los del anexo", () => {
    const withoutHeight = ADDRESS_KEYWORD_BASES.filter(
      (s) => s.category !== "K8" && s.parts.altura === null,
    ).map((s) => s.id);
    expect(withoutHeight).toEqual(["K5-3", "K5-5", "K6-1", "K6-2", "K6-3", "K6-4", "K6-5", "K6-6"]);
    for (const s of ADDRESS_KEYWORD_BASES.filter((c) => c.category === "K7"))
      expect(s.parts.resto, s.id).not.toBeNull();
    expect(base("K6-5").parts.resto).toBeNull();
    expect(base("K5-3").parts.resto).toBe("entre 44 y 45");
  });

  it("la escritura n deja la oración y las partes como están", () => {
    for (const s of ADDRESS_KEYWORD_BASES) {
      const p = page(`${s.id}/n`);
      expect(p.text).toBe(s.text);
      expect(p.parts).toEqual(s.parts);
    }
  });

  it("la escritura M pasa todo a mayúsculas y conserva las tildes, la diéresis y la eñe", () => {
    expect(page("K1-6/M").text).toBe("EL TALLER ESTÁ EN PJE. GÜEMES 315, AL FONDO.");
    expect(page("K1-6/M").parts).toEqual({
      via: "PJE.",
      nombre: "GÜEMES",
      altura: "315",
      resto: null,
    });
    expect(page("K1-7/M").parts.nombre).toBe("OROÑO");
    expect(page("K3-1/M").parts.nombre).toBe("PRESIDENTE ROQUE SÁENZ PEÑA");
    for (const s of ADDRESS_KEYWORD_BASES)
      expect(page(`${s.id}/M`).text, s.id).toBe(s.text.toUpperCase());
  });

  it("la escritura S quita tildes y diéresis y conserva la «Ñ»", () => {
    expect(page("K1-6/S").text).toBe("EL TALLER ESTA EN PJE. GUEMES 315, AL FONDO.");
    expect(page("K1-6/S").parts.nombre).toBe("GUEMES");
    expect(page("K1-7/S").parts.nombre).toBe("OROÑO");
    expect(page("K1-7/S").text).toBe("EL COMERCIO ABRIO SUS PUERTAS EN BOULEVARD OROÑO 1260.");
    expect(page("K3-1/S").parts.nombre).toBe("PRESIDENTE ROQUE SAENZ PEÑA");
    expect(page("K5-3/S").parts.resto).toBe("ENTRE 44 Y 45");
    for (const s of ADDRESS_KEYWORD_BASES) {
      const text = page(`${s.id}/S`).text;
      expect(text, s.id).not.toMatch(/[ÁÉÍÓÚÜáéíóúü]/);
      expect(text, s.id).toBe(
        s.text
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0301\u0308]/g, "")
          .normalize("NFC"),
      );
    }
  });

  it("M y S no tocan los signos «°» y «º» ni la barra de «s/n»", () => {
    expect(page("K4-3/S").parts.nombre).toBe("1° DE MAYO");
    expect(page("K5-6/M").text).toContain("AV. 44 Nº 2360");
    expect(page("K5-6/S").text).toContain("AV. 44 Nº 2360");
    expect(page("K6-6/M").parts.resto).toBe("S/N");
    expect(page("K7-2/S").parts.resto).toBe("2° PISO, OFICINA 14");
    expect(page("K5-1/M").text).toContain("N° 889");
  });

  it("applyScript es la identidad en n y no deja tildes en S", () => {
    expect(applyScript("n", "Güemes Sáenz Ñandú")).toBe("Güemes Sáenz Ñandú");
    expect(applyScript("M", "Güemes Sáenz ñandú")).toBe("GÜEMES SÁENZ ÑANDÚ");
    expect(applyScript("S", "Güemes Sáenz ñandú Ünico")).toBe("GUEMES SAENZ ÑANDU UNICO");
  });

  it("el relleno de la página va en la misma escritura que la oración", () => {
    expect(keywordPageParagraphs(page("K1-1/n"))).toEqual([
      FILLER_BEFORE,
      page("K1-1/n").text,
      FILLER_AFTER,
    ]);
    expect(keywordPageParagraphs(page("K1-1/M"))).toEqual([
      FILLER_BEFORE.toUpperCase(),
      page("K1-1/M").text,
      FILLER_AFTER.toUpperCase(),
    ]);
    expect(expectedKeywordPageText(page("K1-1/S"))).toBe(
      `${FILLER_BEFORE.toUpperCase()} ${page("K1-1/S").text} ${FILLER_AFTER.toUpperCase()}`,
    );
  });

  it("la página entera, relleno incluido, está toda en mayúsculas en M y en S", () => {
    for (const p of ADDRESS_KEYWORD_PAGES.filter((c) => c.script !== "n")) {
      const text = expectedKeywordPageText(p);
      expect(text, p.id).toBe(text.toUpperCase());
    }
  });
});
