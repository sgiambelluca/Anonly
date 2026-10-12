import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { NoiseId } from "./osdVerdictCorpusM2.js";
import { p2nNoisePages } from "./osdVerdictM3.js";
import { buildP2WithNoise, mergePages, rasterizeWholeDocument } from "./osdVerdictM3Fixtures.js";

/** Un PDF de N páginas; el ancho de cada una (200 + índice) las distingue. */
async function numbered(pages: number, base = 200): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) document.addPage([base + i, 300]);
  return document.save();
}

describe("osdVerdictM3Fixtures", () => {
  it("mergePages une una página de cada fuente, en ese orden y con los mismos bytes cada vez", async () => {
    const one = await PDFDocument.load(await numbered(3));
    const two = await PDFDocument.load(await numbered(2, 500));
    const sources = [
      { document: one, pageIndex: 2 },
      { document: two, pageIndex: 0 },
      { document: one, pageIndex: 0 },
    ];
    const merged = await mergePages(sources);
    const again = await mergePages(sources);
    expect(Buffer.from(merged).equals(Buffer.from(again))).toBe(true);
    const out = await PDFDocument.load(merged);
    expect(out.getPages().map((page) => page.getSize().width)).toEqual([202, 500, 200]);
  });

  it("P2 con ruido son las 50 páginas de P2 y una hoja de ruido cada cinco, en las posiciones del plan", async () => {
    const p2 = await numbered(50);
    const sheet = async (width: number) => numbered(1, width);
    const sheets: Record<NoiseId, Uint8Array> = {
      RU1: await sheet(1001),
      RU2: await sheet(1002),
      RU3: await sheet(1003),
      RU4: await sheet(1004),
      RU5: await sheet(1005),
      RU6: await sheet(1006),
    };
    const merged = await buildP2WithNoise(p2, sheets);
    const out = await PDFDocument.load(merged);
    expect(out.getPageCount()).toBe(60);
    const widths = out.getPages().map((page) => Math.round(page.getSize().width));
    for (const position of p2nNoisePages()) expect(widths[position]).toBeGreaterThanOrEqual(1001);
    // Las páginas de P2 conservan su orden, sin las hojas.
    expect(widths.filter((w) => w < 1000)).toEqual(Array.from({ length: 50 }, (_, i) => 200 + i));
    // Las hojas son las que hoy hacen una sola lectura: RU1, RU3, RU4 y RU5, nunca RU2 ni RU6.
    expect(new Set(widths.filter((w) => w >= 1000))).toEqual(new Set([1001, 1003, 1004, 1005]));
    const again = await buildP2WithNoise(p2, sheets);
    expect(Buffer.from(again).equals(Buffer.from(merged))).toBe(true);
  });

  it("rasterizar un documento con otra cantidad de páginas que la del plan falla antes de lanzar nada", async () => {
    await expect(rasterizeWholeDocument(await numbered(3), 300, 51)).rejects.toThrow(
      "el documento tiene 3 páginas y el plan dice 51",
    );
    await expect(
      rasterizeWholeDocument(new TextEncoder().encode("no es un pdf"), 300, 51),
    ).rejects.toThrow("no se pudo abrir el documento a rasterizar");
  });
});
