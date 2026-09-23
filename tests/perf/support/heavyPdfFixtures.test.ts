import { readFile } from "node:fs/promises";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  fillDeterministicPixels,
  C0_FIXTURE_SHA256,
  C0_FIXTURE_SIZE_BYTES,
  getOrGenerateHeavyFixture,
  regenerateHeavyFixture,
} from "./heavyPdfFixtures.js";
import { validateExportPdf } from "./heavyPdfValidation.js";

describe("heavy PDF fixture harness", () => {
  it("usa el fixture P1 de texto nativo versionado con 10 páginas", async () => {
    const first = await getOrGenerateHeavyFixture("C0");
    const second = await getOrGenerateHeavyFixture("C0");
    const versionedPdf = await readFile("tests/fixtures/text-10p.pdf");
    expect(first.sha256).toBe(C0_FIXTURE_SHA256);
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(versionedPdf);
    expect(second.bytes).toEqual(versionedPdf);
    expect(first.pageCount).toBe(10);
    expect(first.sizeBytes).toBe(C0_FIXTURE_SIZE_BYTES);
    expect(first.sizeBytes).toBe(second.sizeBytes);
    expect(first.pageWidthPt).toBe(595);
    expect(first.pageHeightPt).toBe(842);
  });

  it("genera patrón determinista de color/gris separado por página, sin PDF ni Chromium", () => {
    const makePixels = (pageNo: number, grayscale: boolean): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(4 * 3 * 4);
      fillDeterministicPixels(pixels, 4, 3, pageNo, 17420260923, grayscale);
      return pixels;
    };
    const color = makePixels(0, false);
    const colorAgain = makePixels(0, false);
    const colorNextPage = makePixels(1, false);
    const gray = makePixels(0, true);

    expect([...color]).toEqual([...colorAgain]);
    expect([...color]).not.toEqual([...colorNextPage]);
    for (let offset = 0; offset < gray.length; offset += 4) {
      expect(gray[offset]).toBe(gray[offset + 1]);
      expect(gray[offset]).toBe(gray[offset + 2]);
      expect(gray[offset + 3]).toBe(255);
    }
    expect(color[0]).not.toBe(color[1]);
    expect(color[1]).not.toBe(color[2]);
  });

  it.skipIf(process.env.ANONLY_VERIFY_HEAVY_FIXTURES !== "1")(
    "reproduce los hashes publicados de H1/H2 fuera de la caché",
    async () => {
      const h1 = await regenerateHeavyFixture("H1");
      const h2 = await regenerateHeavyFixture("H2");
      expect(h1.sha256).toBe("0165bf8e2f26a734b0b5a2f1733cc53aa0e7b99c68a845af4b24fd24d04c9e41");
      expect(h2.sha256).toBe("8606a067e9fb2d9afa0b28c12d54d5aea808045419ee66291b299fcd59e7cfcf");
      expect(h1.sizeBytes).toBe(20_372_156);
      expect(h2.sizeBytes).toBe(37_935_359);
    },
    600_000,
  );

  it("rechaza un PDF en blanco como negativo artificial de fidelidad", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([595, 842]);
    const bytes = await blank.save();
    const result = await validateExportPdf(bytes, bytes, 6, "H1");
    expect(result.valid).toBe(false);
    expect(result.failures).toContain("page-count:1/6");
    expect(result.failures).toContain("page-1:source-marker-missing");
  });
});
