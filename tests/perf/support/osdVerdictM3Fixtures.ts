/**
 * M-O3: arma en memoria los documentos de la campaña que no existen como archivo.
 *
 * - **R4 a 300 dpi**: el digital real de 51 páginas, rasterizado página por página en un Chromium aparte y
 *   unido en un solo PDF escaneado. Página por página y no de una vez: rasterizar las 51 en una sola pasada
 *   dejaría 100 canvas de 35 MB vivos a la vez. Nada se escribe a disco (ni bajo el repo ni en `.measure/`).
 * - **P2 con ruido**: las 50 páginas de P2 (el fixture normativo de `memory.spec.ts`, sin cambios) con diez
 *   hojas de ruido de M-O2 a 300 dpi intercaladas, una cada cinco (`p2nPlan`).
 *
 * Determinista: fechas fijas y sin flujos de objetos, así dos armados del mismo origen dan los mismos bytes.
 */

import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { rasterizePixelRotationsToScannedPdf } from "../../e2e/support/scannedPdf.js";

import { NOISE_DPIS, noiseEntries, type NoiseId } from "./osdVerdictCorpusM2.js";
import { extractSinglePage, generateSyntheticFixtures } from "./osdVerdictFixturesM2.js";
import { P2N_NOISE_DPI, p2nPlan } from "./osdVerdictM3.js";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

/** Une una página de cada fuente, en ese orden, en un solo PDF. Determinista. */
export async function mergePages(
  sources: ReadonlyArray<{ readonly document: PDFDocument; readonly pageIndex: number }>,
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  output.setCreationDate(FIXED_DATE);
  output.setModificationDate(FIXED_DATE);
  for (const { document, pageIndex } of sources) {
    const [copied] = await output.copyPages(document, [pageIndex]);
    if (copied === undefined) throw new Error("no se pudo copiar la página");
    output.addPage(copied);
  }
  return output.save({ useObjectStreams: false });
}

/** Un documento digital rasterizado a `dpi` como un solo documento escaneado (sin giros). */
export async function rasterizeWholeDocument(
  documentBytes: Uint8Array,
  dpi: number,
  expectedPages: number,
): Promise<Uint8Array> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(documentBytes, { updateMetadata: false });
  } catch {
    throw new Error("no se pudo abrir el documento a rasterizar");
  }
  const count = source.getPageCount();
  if (count !== expectedPages)
    throw new Error(`el documento tiene ${count} páginas y el plan dice ${expectedPages}`);
  const rasters: PDFDocument[] = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (let index = 0; index < count; index += 1) {
      const single = await extractSinglePage(source, index);
      const raster = await rasterizePixelRotationsToScannedPdf(page, single, [0], dpi / 72);
      rasters.push(await PDFDocument.load(raster.buffer));
    }
  } finally {
    await browser.close();
  }
  return mergePages(rasters.map((document) => ({ document, pageIndex: 0 })));
}

/** Las hojas de ruido de M-O2 a 300 dpi, derechas (las mismas del caché de M-O2), por tipo. */
export async function loadNoiseSheets(
  directory: string,
): Promise<Readonly<Record<NoiseId, Uint8Array>>> {
  if (!NOISE_DPIS.includes(P2N_NOISE_DPI as (typeof NOISE_DPIS)[number]))
    throw new Error("las hojas de ruido no existen a ese dpi");
  const needed = noiseEntries().filter(
    (entry) => entry.sourceDpi === P2N_NOISE_DPI && entry.physicalRotation === 0,
  );
  const generated = await generateSyntheticFixtures(needed, directory);
  const sheets = {} as Record<NoiseId, Uint8Array>;
  for (const entry of needed) {
    const fixture = generated.get(entry.key);
    if (fixture === undefined || entry.noise === null) throw new Error(`sin hoja ${entry.key}`);
    sheets[entry.noise.id] = fixture.bytes;
  }
  return sheets;
}

/** P2 con una hoja de ruido cada cinco páginas. */
export async function buildP2WithNoise(
  p2Bytes: Uint8Array,
  sheets: Readonly<Record<NoiseId, Uint8Array>>,
): Promise<Uint8Array> {
  const p2 = await PDFDocument.load(p2Bytes, { updateMetadata: false });
  const loaded = new Map<NoiseId, PDFDocument>();
  const sources: Array<{ document: PDFDocument; pageIndex: number }> = [];
  for (const part of p2nPlan(p2.getPageCount())) {
    if (part.kind === "p2") {
      sources.push({ document: p2, pageIndex: part.index });
      continue;
    }
    let sheet = loaded.get(part.sheet);
    if (sheet === undefined) {
      sheet = await PDFDocument.load(sheets[part.sheet]);
      loaded.set(part.sheet, sheet);
    }
    sources.push({ document: sheet, pageIndex: 0 });
  }
  return mergePages(sources);
}
