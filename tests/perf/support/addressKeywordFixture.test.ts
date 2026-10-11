import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { FONT_SIZE, MARGIN_X, PAGE_WIDTH } from "../../fixtures/generate.js";

import { buildAddressKeywordPdf, keywordPageLines } from "./addressKeywordFixture.js";
import {
  ADDRESS_KEYWORD_PAGES,
  keywordPageParagraphs,
  type KeywordPage,
} from "./addressKeywordSentences.js";

describe("addressKeywordFixture", () => {
  it("cada página tiene tres párrafos, cada uno en un solo renglón", () => {
    for (const page of ADDRESS_KEYWORD_PAGES) {
      const lines = keywordPageLines(page);
      expect(
        lines.map((paragraph) => paragraph.join(" ")),
        page.id,
      ).toEqual(keywordPageParagraphs(page));
      expect(
        lines.map((paragraph) => paragraph.length),
        page.id,
      ).toEqual([1, 1, 1]);
    }
  });

  it("ningún renglón, ni siquiera en mayúsculas, se sale del ancho de la página", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const page of ADDRESS_KEYWORD_PAGES) {
      for (const paragraph of keywordPageParagraphs(page)) {
        const width = font.widthOfTextAtSize(paragraph, FONT_SIZE);
        expect(MARGIN_X + width, page.id).toBeLessThanOrEqual(PAGE_WIDTH);
      }
    }
  });

  it("genera un PDF con una página por entrada (la fuente dibuja todos los glifos de las tres escrituras)", async () => {
    const bytes = await buildAddressKeywordPdf(ADDRESS_KEYWORD_PAGES);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(165);
  });

  it("es determinista", async () => {
    const first = await buildAddressKeywordPdf(ADDRESS_KEYWORD_PAGES);
    const second = await buildAddressKeywordPdf(ADDRESS_KEYWORD_PAGES);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("una oración más larga que el renglón se parte en renglones sin acortarse", () => {
    const long: KeywordPage = {
      id: "K1-1/n",
      baseId: "K1-1",
      category: "K1",
      script: "n",
      text: `${"palabra ".repeat(30)}Av. Corrientes 1980.`,
      parts: { via: "Av.", nombre: "Corrientes", altura: "1980", resto: null },
    };
    const [, body] = keywordPageLines(long);
    expect(body?.length).toBeGreaterThan(1);
    expect(body?.join(" ")).toBe(long.text);
  });
});
