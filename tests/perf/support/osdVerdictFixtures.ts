/**
 * M-O1: genera los 64 PDF escaneados de página escasa (geometrías N1 a N8). Misma técnica que
 * `adr190Fixtures.ts`: una página con texto dibujada con pdf-lib (Helvetica, fechas fijas) se rasteriza en
 * un Chromium aparte, con el giro físico pedido, y queda un PDF de solo imagen, sin capa de texto. El
 * resultado se guarda en una caché por contenido: el mismo PDF fuente da los mismos bytes en cada tanda.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { rasterizePixelRotationsToScannedPdf } from "../../e2e/support/scannedPdf.js";

import { hashBytes, type CampaignFixture } from "./adr190Fixtures.js";
import {
  SPARSE_DNI,
  expectedTextOf,
  layoutLines,
  lineFitsPage,
  type CorpusEntry,
  type Geometry,
  type PlacedLine,
} from "./osdVerdictCorpus.js";

const FONT_NAME = "Helvetica";
const CACHE_DIRECTORY = resolve(".measure/osd-verdict/fixtures-v1");

export interface GeometrySource {
  readonly bytes: Uint8Array;
  readonly lines: ReadonlyArray<PlacedLine>;
}

/** La página con texto, sin girar ni rasterizar. Determinista (fechas fijas). */
export async function buildGeometrySource(geometry: Geometry): Promise<GeometrySource> {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  document.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([geometry.widthPt, geometry.heightPt]);
  const lines = layoutLines(geometry, (text, size) => font.widthOfTextAtSize(text, size));
  for (const line of lines) {
    if (!lineFitsPage(line, geometry))
      throw new Error(`${geometry.id}: el renglón «${line.text}» no entra en la página`);
    page.drawText(line.text, { x: line.x, y: line.y, font, size: line.size, color: rgb(0, 0, 0) });
  }
  return { bytes: await document.save(), lines };
}

/** Todo corre en un Chromium aparte, cerrado antes de que arranque Electron. */
export async function generateSparseFixtures(
  entries: ReadonlyArray<CorpusEntry>,
  directory: string,
): Promise<Map<string, CampaignFixture>> {
  await mkdir(directory, { recursive: true });
  await mkdir(CACHE_DIRECTORY, { recursive: true });
  const fixtures = new Map<string, CampaignFixture>();
  const sources = new Map<string, GeometrySource>();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const entry of entries) {
      const geometry = entry.geometry;
      if (geometry === null) throw new Error(`${entry.key}: no es una geometría nueva`);
      let source = sources.get(geometry.id);
      if (source === undefined) {
        source = await buildGeometrySource(geometry);
        sources.set(geometry.id, source);
      }
      const cachePath = join(
        CACHE_DIRECTORY,
        `${entry.key}-${hashBytes(source.bytes).slice(0, 16)}.pdf`,
      );
      let fixtureBytes: Uint8Array | null = await readFile(cachePath).catch(() => null);
      if (fixtureBytes === null) {
        const generated = await rasterizePixelRotationsToScannedPdf(
          page,
          source.bytes,
          [entry.physicalRotation],
          entry.sourceDpi / 72,
        );
        fixtureBytes = generated.buffer;
        await writeFile(cachePath, fixtureBytes);
      }
      const path = join(directory, `${entry.key}.pdf`);
      await writeFile(path, fixtureBytes);
      const quarter = entry.physicalRotation === 90 || entry.physicalRotation === 270;
      const widthPx = Math.ceil((geometry.widthPt * entry.sourceDpi) / 72);
      const heightPx = Math.ceil((geometry.heightPt * entry.sourceDpi) / 72);
      fixtures.set(entry.key, {
        key: entry.key,
        path,
        hash: hashBytes(fixtureBytes),
        expectedText: expectedTextOf(geometry),
        expectedDni: SPARSE_DNI,
        expectedCorrectionAngle: entry.correctAngle,
        pageWidth: quarter ? geometry.heightPt : geometry.widthPt,
        pageHeight: quarter ? geometry.widthPt : geometry.heightPt,
        sourceWidthPx: quarter ? heightPx : widthPx,
        sourceHeightPx: quarter ? widthPx : heightPx,
        actualSourceDpi: [
          (72 * (quarter ? heightPx : widthPx)) / (quarter ? geometry.heightPt : geometry.widthPt),
          (72 * (quarter ? widthPx : heightPx)) / (quarter ? geometry.widthPt : geometry.heightPt),
        ],
        font: FONT_NAME,
        fontSize: geometry.fontSize,
        lines: source.lines.map((line) => ({
          text: line.text,
          x: line.x,
          y: line.y,
          width: line.width,
          height: line.size,
        })),
        rotationConvention:
          "physical clockwise canvas rotation; kernel clockwise correction; 90 maps to 270, 180 to 180, 270 to 90",
        regionBbox: null,
      });
    }
  } finally {
    await browser.close();
  }
  return fixtures;
}
