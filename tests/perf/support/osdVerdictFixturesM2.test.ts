import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { MARGIN_SPECS, NOISE_SPECS, PAGE_A4_HEIGHT, PAGE_A4_WIDTH } from "./osdVerdictCorpusM2.js";
import {
  buildMarginSource,
  buildNoiseSource,
  buildRealPages,
  extractSinglePage,
  readRealDocument,
} from "./osdVerdictFixturesM2.js";

async function multiPage(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    // Tamaños distintos para reconocer cada página.
    const page = document.addPage([200 + i, 300]);
    page.drawText(`pagina ${i + 1}`, { x: 20, y: 100, size: 12 });
  }
  return document.save();
}

describe("osdVerdictFixturesM2", () => {
  it("cada tipo de ruido es una hoja A4 y sale con los mismos bytes cada vez", async () => {
    for (const spec of NOISE_SPECS) {
      const first = await buildNoiseSource(spec);
      const second = await buildNoiseSource(spec);
      expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
      const size = (await PDFDocument.load(first)).getPage(0).getSize();
      expect(size.width).toBeCloseTo(PAGE_A4_WIDTH, 6);
      expect(size.height).toBeCloseTo(PAGE_A4_HEIGHT, 6);
    }
  });

  it("los tipos de ruido se distinguen entre sí", async () => {
    const sources = await Promise.all(NOISE_SPECS.map((spec) => buildNoiseSource(spec)));
    expect(new Set(sources.map((bytes) => Buffer.from(bytes).toString("base64"))).size).toBe(6);
  });

  it("el margen es una hoja A4 determinista y con el sello aun sin cuerpo", async () => {
    const sources = new Map<string, Uint8Array>();
    for (const spec of MARGIN_SPECS) {
      const first = await buildMarginSource(spec);
      const second = await buildMarginSource(spec);
      expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
      expect((await PDFDocument.load(first)).getPage(0).getSize().height).toBeCloseTo(
        PAGE_A4_HEIGHT,
        6,
      );
      sources.set(spec.id, first);
    }
    // Con cuerpo el PDF es más grande que el del solo sello.
    expect((sources.get("M2")?.length ?? 0) > (sources.get("M3")?.length ?? 0)).toBe(true);
    expect((sources.get("M3")?.length ?? 0) > (sources.get("M1")?.length ?? 0)).toBe(true);
  });

  it("extractSinglePage devuelve la página pedida, sola y determinista", async () => {
    const source = await PDFDocument.load(await multiPage(3));
    const second = await extractSinglePage(source, 1);
    const again = await extractSinglePage(source, 1);
    expect(Buffer.from(second).equals(Buffer.from(again))).toBe(true);
    const out = await PDFDocument.load(second);
    expect(out.getPageCount()).toBe(1);
    expect(out.getPage(0).getSize().width).toBe(201);
  });

  it("R1 (escaneo) se arma sin pasar por disco: una página por PDF, a su tamaño nativo", async () => {
    const bytes = await multiPage(20);
    const built = await buildRealPages("R1", bytes, [3, 7]);
    expect(built.pageCount).toBe(20);
    expect([...built.pdfs.keys()]).toEqual([3, 7]);
    const third = await PDFDocument.load(built.pdfs.get(3) ?? new Uint8Array());
    expect(third.getPageCount()).toBe(1);
    expect(third.getPage(0).getSize().width).toBe(202);
  });

  it("un documento con otra cantidad de páginas que la del plan falla sin nombrar archivos", async () => {
    await expect(buildRealPages("R1", await multiPage(19), [1])).rejects.toThrow(
      "R1: tiene 19 páginas y el plan dice 20",
    );
  });

  it("un archivo que no es un PDF falla con un mensaje neutro", async () => {
    await expect(
      buildRealPages("R1", new TextEncoder().encode("no es un pdf"), [1]),
    ).rejects.toThrow("no se pudo abrir el documento R1");
  });

  it("el error de lectura de un documento real no lleva la ruta", async () => {
    const secret = "C:/carpeta-privada-que-no-existe/documento-confidencial.pdf";
    const error = await readRealDocument(secret).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain("carpeta-privada");
    expect(message).not.toContain("documento-confidencial");
    expect(message).not.toContain(".pdf");
  });
});
