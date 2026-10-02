import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { rasterizePixelRotationsToScannedPdf } from "../../e2e/support/scannedPdf.js";
import { samplePdfPixels, type PdfPixelSample } from "../../e2e/support/scannedPdf.js";

import { fixtureKey, type Cell } from "./adr190Dpi.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const FONT_SIZE = 12;
export const hashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Pixel-level clockwise rotation check, separate from measured OCR fixtures. */
export async function verifyRotationPixelControl(outputPath: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const sourceDocument = await PDFDocument.create();
    const markerSpecs = [
      { x: 20, y: 15, width: 20, height: 12 },
      { x: 140, y: 55, width: 24, height: 18 },
    ] as const;
    for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
      const sourcePage = sourceDocument.addPage([200, 100]);
      for (const marker of markerSpecs)
        sourcePage.drawRectangle({ ...marker, color: rgb(0, 0, 0) });
    }
    const sourceBytes = await sourceDocument.save();
    const rotations = [0, 90, 180, 270] as const;
    const generated = await rasterizePixelRotationsToScannedPdf(page, sourceBytes, rotations, 1);
    const corrections = [0, 270, 180, 90] as const;
    const counterRotated = await rasterizePixelRotationsToScannedPdf(
      page,
      generated.buffer,
      corrections,
      1,
    );
    const clockwise = (point: { x: number; y: number }, angle: number) => {
      if (angle === 90) return { x: 100 - point.y, y: point.x };
      if (angle === 180) return { x: 200 - point.x, y: 100 - point.y };
      if (angle === 270) return { x: point.y, y: 200 - point.x };
      return point;
    };
    const expectedSamples: PdfPixelSample[] = [];
    for (const [pageIndex, angle] of rotations.entries()) {
      for (const marker of markerSpecs) {
        const sourcePoint = {
          x: marker.x + marker.width / 2,
          y: 100 - marker.y - marker.height / 2,
        };
        expectedSamples.push({
          pageIndex,
          ...clockwise(sourcePoint, angle),
        });
      }
    }
    const counterClockwiseForNinety = clockwise(
      {
        x: markerSpecs[0].x + markerSpecs[0].width / 2,
        y: 100 - markerSpecs[0].y - markerSpecs[0].height / 2,
      },
      270,
    );
    const inverseSample: PdfPixelSample = { pageIndex: 1, ...counterClockwiseForNinety };
    const pixels = await samplePdfPixels(page, generated.buffer, [
      ...expectedSamples,
      inverseSample,
    ]);
    const counterRotatedSamples: PdfPixelSample[] = [];
    for (let pageIndex = 0; pageIndex < rotations.length; pageIndex++) {
      for (const marker of markerSpecs)
        counterRotatedSamples.push({
          pageIndex,
          x: marker.x + marker.width / 2,
          y: 100 - marker.y - marker.height / 2,
        });
    }
    const counterRotatedPixels = await samplePdfPixels(
      page,
      counterRotated.buffer,
      counterRotatedSamples,
    );
    const expected = pixels.slice(0, expectedSamples.length).map((rgba, index) => ({
      ...expectedSamples[index],
      rgba,
      black: rgba[0] < 80 && rgba[1] < 80 && rgba[2] < 80,
    }));
    if (expected.some((sample) => !sample.black))
      throw new Error(`clockwise pixel rotation probe missed marker: ${JSON.stringify(expected)}`);
    const inverseRgba = pixels[pixels.length - 1];
    if (!inverseRgba || inverseRgba[0] < 240 || inverseRgba[1] < 240 || inverseRgba[2] < 240)
      throw new Error(
        `90-degree counterclockwise location was not blank: ${JSON.stringify(inverseRgba)}`,
      );
    const counterRotatedMarkers = counterRotatedPixels.map((rgba, index) => ({
      ...counterRotatedSamples[index],
      rgba,
      black: rgba[0] < 80 && rgba[1] < 80 && rgba[2] < 80,
    }));
    if (counterRotatedMarkers.some((sample) => !sample.black))
      throw new Error(
        `counter-rotation did not restore marker pixels: ${JSON.stringify(counterRotatedMarkers)}`,
      );
    const report = {
      sourceHash: hashBytes(sourceBytes),
      outputHash: hashBytes(generated.buffer),
      counterRotatedOutputHash: hashBytes(counterRotated.buffer),
      pageSizePoints: [200, 100],
      rotations,
      expectedCounterRotation: corrections,
      expectedMarkerPixels: expected,
      inverseDirectionControl: { sample: inverseSample, rgba: inverseRgba, blank: true },
      counterRotatedMarkerPixels: counterRotatedMarkers,
      passed: true,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    return report;
  } finally {
    await browser.close();
  }
}
export interface CampaignFixture {
  readonly key: string;
  readonly path: string;
  readonly hash: string;
  readonly expectedText: string;
  readonly expectedDni: string | null;
  readonly expectedCorrectionAngle: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly sourceWidthPx: number;
  readonly sourceHeightPx: number;
  readonly actualSourceDpi: readonly [number, number];
  readonly font: string;
  readonly fontSize: number;
  readonly lines: ReadonlyArray<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly rotationConvention: string;
  readonly regionBbox: { x: number; y: number; width: number; height: number } | null;
}
async function source(density: Cell["density"]) {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  document.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sourceWidth = density === "region" ? 400 : PAGE_WIDTH;
  const sourceHeight = density === "region" ? 200 : PAGE_HEIGHT;
  const page = document.addPage([sourceWidth, sourceHeight]);
  const content =
    density === "full"
      ? [
          "Documento de prueba",
          "Juan Perez",
          "DNI 34.567.891",
          ...Array.from(
            { length: 31 },
            (_, i) => `Registro ${i + 1} de lectura para comprobar la calidad del documento.`,
          ),
        ]
      : density === "header"
        ? ["Documento de prueba", "Juan Perez", "DNI 34.567.891", "Fecha 27 de septiembre de 2026"]
        : density === "signature"
          ? ["Firma y conformidad", "Juan Perez", "DNI 34.567.891", "Lugar y fecha de firma"]
          : density === "two-lines" || density === "region"
            ? ["Juan Perez", "DNI 34.567.891"]
            : [];
  const top = density === "signature" ? 200 : density === "region" ? 140 : 780;
  const lines = content.map((text, i) => ({
    text,
    x: 54,
    y: top - i * 20,
    width: font.widthOfTextAtSize(text, FONT_SIZE),
    height: FONT_SIZE,
  }));
  for (const line of lines)
    page.drawText(line.text, { x: line.x, y: line.y, font, size: FONT_SIZE, color: rgb(0, 0, 0) });
  if (density === "shapes") {
    page.drawLine({
      start: { x: 60, y: 720 },
      end: { x: 430, y: 720 },
      thickness: 2,
      color: rgb(0, 0, 0),
    });
    page.drawEllipse({
      x: 250,
      y: 520,
      xScale: 130,
      yScale: 60,
      borderWidth: 2,
      borderColor: rgb(0, 0, 0),
    });
  }
  if (density === "noise") {
    let seed = 190;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const x = (seed / 4294967296) * PAGE_WIDTH;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      page.drawRectangle({
        x,
        y: (seed / 4294967296) * PAGE_HEIGHT,
        width: 0.4,
        height: 0.4,
        color: rgb(0, 0, 0),
      });
    }
  }
  return {
    bytes: await document.save(),
    lines,
    sourceWidth,
    sourceHeight,
    expectedText: content.join("\n"),
  };
}

/** All generation occurs in a separate Chromium, closed before Electron fixture setup. */
export async function generateCampaignFixtures(
  cells: ReadonlyArray<Cell>,
  directory: string,
): Promise<Map<string, CampaignFixture>> {
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch();
  const fixtures = new Map<string, CampaignFixture>();
  const sources = new Map<Cell["density"], Awaited<ReturnType<typeof source>>>();
  try {
    const page = await browser.newPage();
    for (const cell of cells) {
      const key = fixtureKey(cell);
      if (fixtures.has(key)) continue;
      let original = sources.get(cell.density);
      if (!original) {
        original = await source(cell.density);
        sources.set(cell.density, original);
      }
      const cacheDirectory = resolve(".measure/adr190-dpi/fixtures-v1");
      await mkdir(cacheDirectory, { recursive: true });
      const cachePath = join(
        cacheDirectory,
        `${key}-${hashBytes(original.bytes).slice(0, 16)}.pdf`,
      );
      const cached = await readFile(cachePath).catch(() => null);
      const generated = cached
        ? null
        : await rasterizePixelRotationsToScannedPdf(
            page,
            original.bytes,
            [cell.angle],
            cell.sourceDpi / 72,
          );
      let fixtureBytes = cached ?? generated?.buffer;
      if (!fixtureBytes) throw new Error("fixture generation produced no bytes");
      if (!cached) {
        if (cell.density === "region") {
          const mixed = await PDFDocument.create();
          mixed.setCreationDate(new Date("2026-01-01T00:00:00Z"));
          mixed.setModificationDate(new Date("2026-01-01T00:00:00Z"));
          const [imagePage] = await mixed.embedPdf(fixtureBytes);
          if (!imagePage) throw new Error("region image missing");
          const output = mixed.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          const nativeFont = await mixed.embedFont(StandardFonts.Helvetica);
          output.drawText("Documento de prueba", {
            x: 54,
            y: 780,
            font: nativeFont,
            size: FONT_SIZE,
          });
          output.drawPage(imagePage, { x: 54, y: 500, width: 400, height: 200 });
          fixtureBytes = Buffer.from(await mixed.save());
        }
        await writeFile(cachePath, fixtureBytes);
      }
      const path = join(directory, `${key}.pdf`);
      await writeFile(path, fixtureBytes);
      const quarter = cell.angle === 90 || cell.angle === 270;
      const w = Math.ceil((original.sourceWidth * cell.sourceDpi) / 72);
      const h = Math.ceil((original.sourceHeight * cell.sourceDpi) / 72);
      const pageWidth = quarter ? PAGE_HEIGHT : PAGE_WIDTH;
      const pageHeight = quarter ? PAGE_WIDTH : PAGE_HEIGHT;
      const sourceWidthPx = quarter ? h : w;
      const sourceHeightPx = quarter ? w : h;
      fixtures.set(key, {
        key,
        path,
        hash: hashBytes(fixtureBytes),
        expectedText:
          cell.density === "region"
            ? `Documento de prueba\n${original.expectedText}`
            : original.expectedText,
        expectedDni: original.lines.length ? "34.567.891" : null,
        expectedCorrectionAngle: (360 - cell.angle) % 360,
        pageWidth,
        pageHeight,
        sourceWidthPx,
        sourceHeightPx,
        actualSourceDpi: [
          (72 * sourceWidthPx) / (quarter ? original.sourceHeight : original.sourceWidth),
          (72 * sourceHeightPx) / (quarter ? original.sourceWidth : original.sourceHeight),
        ],
        font: "Helvetica",
        fontSize: FONT_SIZE,
        lines: original.lines,
        rotationConvention:
          "physical clockwise canvas rotation; kernel clockwise correction; 90 maps to 270, 180 to 180, 270 to 90",
        regionBbox:
          cell.density === "region"
            ? { x: 54, y: PAGE_HEIGHT - 700, width: 400, height: 200 }
            : null,
      });
    }
  } finally {
    await browser.close();
  }
  return fixtures;
}
