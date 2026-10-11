/**
 * M-O2: genera los PDF de los conjuntos nuevos. Misma técnica que `osdVerdictFixtures.ts` y
 * `adr190Fixtures.ts`: una página con pdf-lib (Helvetica, fechas fijas) rasterizada en un Chromium aparte con
 * el giro físico pedido, y caché por contenido en `.measure/osd-verdict/fixtures-v1/` para los sintéticos.
 *
 * **Los reales no pasan por disco.** `buildRealPages` arma cada página de un documento real en memoria
 * (R1: la página tal cual, en un PDF de una página; R2 a R4: la página rasterizada a 150 dpi) y devuelve los
 * bytes. Nada de eso se escribe bajo el repo, ni en `.measure/` ni en la caché de fixtures. Los errores de
 * lectura de un documento real se reemplazan por un mensaje neutro: la ruta del archivo no sale de acá.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

import { rasterizePixelRotationsToScannedPdf } from "../../e2e/support/scannedPdf.js";

import { hashBytes } from "./adr190Fixtures.js";
import {
  MARGIN_BODY_FONT_SIZE,
  MARGIN_BODY_PITCH,
  MARGIN_BODY_TOP,
  MARGIN_BODY_X,
  PAGE_A4_HEIGHT,
  PAGE_A4_WIDTH,
  REAL_DOC_IS_SCAN,
  REAL_DOC_PAGES,
  REAL_DPI_DIGITAL,
  STAMP_FONT_SIZE,
  STAMP_TEXT,
  STAMP_X_FROM_RIGHT,
  STAMP_Y,
  type M2Entry,
  type MarginSpec,
  type NoiseSpec,
  type RealDocId,
} from "./osdVerdictCorpusM2.js";

const CACHE_DIRECTORY = resolve(".measure/osd-verdict/fixtures-v1");
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

export interface M2Fixture {
  readonly key: string;
  /** `null` en las páginas reales: no se escriben a disco. */
  readonly path: string | null;
  readonly hash: string;
  readonly bytes: Uint8Array;
}

/** Una hoja A4 sin texto con las marcas de ruido. Determinista. */
export async function buildNoiseSource(spec: NoiseSpec): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);
  const page = document.addPage([PAGE_A4_WIDTH, PAGE_A4_HEIGHT]);
  for (const op of spec.ops) {
    const color = rgb(op.gray, op.gray, op.gray);
    if (op.kind === "rect")
      page.drawRectangle({ x: op.x, y: op.y, width: op.width, height: op.height, color });
    else page.drawCircle({ x: op.x, y: op.y, size: op.radius, color });
  }
  return document.save();
}

/** El cuerpo (si lo hay) y el sello vertical del margen derecho. Determinista. */
export async function buildMarginSource(spec: MarginSpec): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setCreationDate(FIXED_DATE);
  document.setModificationDate(FIXED_DATE);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE_A4_WIDTH, PAGE_A4_HEIGHT]);
  spec.bodyLines.forEach((text, index) => {
    page.drawText(text, {
      x: MARGIN_BODY_X,
      y: MARGIN_BODY_TOP - index * MARGIN_BODY_PITCH,
      font,
      size: MARGIN_BODY_FONT_SIZE,
      color: rgb(0, 0, 0),
    });
  });
  // El sello de `qa-stamp.pdf` (tests/fixtures/generate.ts): negrita, azul oscuro, rotado 90°, con la
  // base de los renglones a 40 pt del borde derecho.
  page.drawText(STAMP_TEXT, {
    x: PAGE_A4_WIDTH - STAMP_X_FROM_RIGHT,
    y: STAMP_Y,
    size: STAMP_FONT_SIZE,
    font: bold,
    color: rgb(0.15, 0.25, 0.6),
    rotate: degrees(90),
  });
  return document.save();
}

/** Ruido y margen: se rasterizan en un Chromium aparte y quedan en la caché por contenido. */
export async function generateSyntheticFixtures(
  entries: ReadonlyArray<M2Entry>,
  directory: string,
): Promise<Map<string, M2Fixture>> {
  await mkdir(directory, { recursive: true });
  await mkdir(CACHE_DIRECTORY, { recursive: true });
  const fixtures = new Map<string, M2Fixture>();
  const sources = new Map<string, Uint8Array>();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const entry of entries) {
      if (entry.kind === "real" || entry.sourceDpi === null)
        throw new Error(`${entry.key}: no es un fixture sintético`);
      const sourceId = entry.noise?.id ?? entry.margin?.id ?? "";
      let source = sources.get(sourceId);
      if (source === undefined) {
        source =
          entry.noise !== null
            ? await buildNoiseSource(entry.noise)
            : entry.margin !== null
              ? await buildMarginSource(entry.margin)
              : new Uint8Array();
        sources.set(sourceId, source);
      }
      const cachePath = join(CACHE_DIRECTORY, `${entry.key}-${hashBytes(source).slice(0, 16)}.pdf`);
      let bytes: Uint8Array | null = await readFile(cachePath).catch(() => null);
      if (bytes === null) {
        const generated = await rasterizePixelRotationsToScannedPdf(
          page,
          source,
          [entry.physicalRotation],
          entry.sourceDpi / 72,
        );
        bytes = generated.buffer;
        await writeFile(cachePath, bytes);
      }
      const path = join(directory, `${entry.key}.pdf`);
      await writeFile(path, bytes);
      fixtures.set(entry.key, { key: entry.key, path, hash: hashBytes(bytes), bytes });
    }
  } finally {
    await browser.close();
  }
  return fixtures;
}

/** Lee un documento real. El error no lleva la ruta. */
export async function readRealDocument(path: string): Promise<Uint8Array> {
  try {
    return await readFile(path);
  } catch {
    throw new Error("no se pudo leer un documento real (la ruta no se informa)");
  }
}

export interface RealDocumentInfo {
  readonly doc: RealDocId;
  readonly pageCount: number;
}

/** Una página de un PDF, sola, en un PDF de una página. Determinista (fechas fijas, sin metadatos). */
export async function extractSinglePage(
  source: PDFDocument,
  pageIndex: number,
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  output.setCreationDate(FIXED_DATE);
  output.setModificationDate(FIXED_DATE);
  const [copied] = await output.copyPages(source, [pageIndex]);
  if (copied === undefined) throw new Error("no se pudo copiar la página");
  output.addPage(copied);
  return output.save({ useObjectStreams: false });
}

/**
 * Las páginas pedidas de un documento real, en memoria. R1 va a su resolución nativa; R2 a R4 se
 * rasterizan a 150 dpi sin giro. Devuelve el mapa `número de página (desde 1) → PDF de una página`.
 */
export async function buildRealPages(
  doc: RealDocId,
  documentBytes: Uint8Array,
  pages: ReadonlyArray<number>,
): Promise<{ readonly pageCount: number; readonly pdfs: Map<number, Uint8Array> }> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(documentBytes, { updateMetadata: false });
  } catch {
    throw new Error(`no se pudo abrir el documento ${doc}`);
  }
  const pageCount = source.getPageCount();
  if (pageCount !== REAL_DOC_PAGES[doc])
    throw new Error(`${doc}: tiene ${pageCount} páginas y el plan dice ${REAL_DOC_PAGES[doc]}`);
  const pdfs = new Map<number, Uint8Array>();
  if (REAL_DOC_IS_SCAN[doc]) {
    for (const page of pages) pdfs.set(page, await extractSinglePage(source, page - 1));
    return { pageCount, pdfs };
  }
  const browser = await chromium.launch();
  try {
    const chromiumPage = await browser.newPage();
    for (const page of pages) {
      const single = await extractSinglePage(source, page - 1);
      const raster = await rasterizePixelRotationsToScannedPdf(
        chromiumPage,
        single,
        [0],
        REAL_DPI_DIGITAL / 72,
      );
      pdfs.set(page, raster.buffer);
    }
  } finally {
    await browser.close();
  }
  return { pageCount, pdfs };
}
