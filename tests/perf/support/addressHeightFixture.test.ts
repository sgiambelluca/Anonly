import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildAddressHeightPdf, pageLines, pageParagraphs } from "./addressHeightFixture.js";
import { ADDRESS_HEIGHT_SENTENCES, FILLER_AFTER, FILLER_BEFORE } from "./addressHeightSentences.js";

describe("addressHeightFixture", () => {
  it("cada página tiene tres párrafos: relleno, oración, relleno", () => {
    for (const sentence of ADDRESS_HEIGHT_SENTENCES) {
      expect(pageParagraphs(sentence)).toEqual([FILLER_BEFORE, sentence.text, FILLER_AFTER]);
    }
  });

  it("ninguna oración se parte en renglones con el ancho de línea del layout de texto", () => {
    for (const sentence of ADDRESS_HEIGHT_SENTENCES) {
      const lines = pageLines(sentence);
      expect(
        lines.map((paragraph) => paragraph.join(" ")),
        sentence.id,
      ).toEqual([FILLER_BEFORE, sentence.text, FILLER_AFTER]);
    }
  });

  it("genera un PDF con una página por oración (la fuente dibuja todos los glifos)", async () => {
    const bytes = await buildAddressHeightPdf(ADDRESS_HEIGHT_SENTENCES);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(ADDRESS_HEIGHT_SENTENCES.length);
  });

  it("es determinista", async () => {
    const first = await buildAddressHeightPdf(ADDRESS_HEIGHT_SENTENCES);
    const second = await buildAddressHeightPdf(ADDRESS_HEIGHT_SENTENCES);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("una oración más larga que el renglón se parte en renglones sin acortarse", () => {
    const long = {
      id: "A1",
      category: "A",
      place: "Maipú",
      number: "1",
      text: `${"palabra ".repeat(30)}Maipú 1.`,
    } as const;
    const [, body] = pageLines(long);
    expect(body?.length).toBeGreaterThan(1);
    expect(body?.join(" ")).toBe(long.text);
  });
});
