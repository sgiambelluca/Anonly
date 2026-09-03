/**
 * ADR-114 §1: la selección del arrastre se recorta al renglón dominante.
 *
 * La geometría es la del sello de un fallo escaneado, medida: dos renglones a
 * ~5 pt uno del otro, que es lo que hace que un arrastre normal roce el de
 * arriba y arme un valor de dos líneas que no existe en el documento.
 */
import type { BoundingBox, Word } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { dominantLineWords } from "../components/viewer/selectionLine.js";

function word(text: string, x: number, y: number, width: number, height: number): Word {
  return {
    text,
    bbox: { x, y, width, height },
    pageIndex: 0,
    confidence: 0.95,
    source: "ocr",
  };
}

/* `Page.words` ya viene agrupado por renglón (ADR-110/ADR-113): el de arriba
 * primero, y dentro de cada uno por `x`. */
const SELLO: ReadonlyArray<Word> = [
  word("PROVINCIA", 50.2, 100.6, 68, 8.9),
  word("DE", 122.2, 100.6, 16, 8.2),
  word("BUENOS", 141.8, 100.1, 48, 8.6),
  word("AIRES", 193.7, 99.8, 36, 8.6),
  word("TRIBUNAL", 65.3, 114.2, 50, 7.2),
  word("DE", 118.1, 113.8, 13, 7.2),
  word("CASACIÓN", 134.4, 111.6, 50, 9.4),
  word("PENAL", 187.0, 113.5, 32, 7.2),
];

function selected(rect: BoundingBox): ReadonlyArray<Word> {
  return SELLO.filter(
    (w) =>
      w.bbox.x < rect.x + rect.width &&
      w.bbox.x + w.bbox.width > rect.x &&
      w.bbox.y < rect.y + rect.height &&
      w.bbox.y + w.bbox.height > rect.y,
  );
}

describe("dominantLineWords (ADR-114 §1)", () => {
  it("drops the neighbouring line a loose drag brushed", () => {
    // El arrastre cubre `TRIBUNAL DE CASACIÓN PENAL` entero y se pasa 4 pt
    // hacia arriba, donde está el borde inferior del renglón anterior.
    const rect: BoundingBox = { x: 60, y: 107, width: 165, height: 18 };
    const tocadas = selected(rect);
    expect(tocadas.map((w) => w.text)).toContain("PROVINCIA");

    const words = dominantLineWords(SELLO, tocadas, rect);
    expect(words.map((w) => w.text).join(" ")).toBe("TRIBUNAL DE CASACIÓN PENAL");
  });

  it("keeps the whole line when the drag is clean", () => {
    const rect: BoundingBox = { x: 45, y: 99, width: 190, height: 11 };
    const words = dominantLineWords(SELLO, selected(rect), rect);
    expect(words.map((w) => w.text).join(" ")).toBe("PROVINCIA DE BUENOS AIRES");
  });

  it("picks the line the drag actually covered, not the first one", () => {
    /*
     * Los dos renglones tienen cuatro palabras: por cantidad empatan, y el
     * desempate por "el primero" devolvería el de arriba. El criterio es el
     * área seleccionada, así que gana el que el usuario cubrió de verdad.
     */
    const rect: BoundingBox = { x: 45, y: 108, width: 190, height: 14 };
    const tocadas = selected(rect);
    expect(tocadas).toHaveLength(8);

    const words = dominantLineWords(SELLO, tocadas, rect);
    expect(words.map((w) => w.text).join(" ")).toBe("TRIBUNAL DE CASACIÓN PENAL");
  });

  it("a single word selection is returned as is", () => {
    const rect: BoundingBox = { x: 136, y: 112, width: 20, height: 6 };
    const words = dominantLineWords(SELLO, selected(rect), rect);
    expect(words.map((w) => w.text)).toEqual(["CASACIÓN"]);
  });

  it("an empty selection stays empty", () => {
    const rect: BoundingBox = { x: 400, y: 400, width: 20, height: 20 };
    expect(dominantLineWords(SELLO, selected(rect), rect)).toEqual([]);
  });
});
