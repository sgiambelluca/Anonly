import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { hashBytes } from "../perf/support/adr190Fixtures.js";
import { corpusEntries, GEOMETRIES } from "../perf/support/osdVerdictCorpus.js";
import { buildGeometrySource, generateSparseFixtures } from "../perf/support/osdVerdictFixtures.js";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  attachRcN1DocumentObserver,
  installRcN1TransportObserver,
  readRcN1Run,
  resetRcN1Run,
} from "./support/rcN1Observer.js";
import { convertPdfRectsToRegions, samplePdfRegions } from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(600_000);

const DNI = "34.567.891";
const CACHE_DIR = resolve(".measure/osd-verdict/fixtures-v1");
const OUTPUT_DIR = resolve(".measure/adr190-rc-n1-adr163-exact");
const MO1_MANIFEST = resolve(".measure/osd-verdict/campana-m-o1/manifest.json");
const entries = corpusEntries().filter(
  (entry) =>
    entry.set === "sparse" &&
    entry.label === "N1" &&
    (entry.sourceDpi === 150 || entry.sourceDpi === 300) &&
    (entry.physicalRotation === 90 || entry.physicalRotation === 270),
);
const fixtures = new Map<
  string,
  {
    path: string;
    hash: string;
    nominalDpi: number;
    sourceWidthPx: number;
    sourceHeightPx: number;
    pageWidthPt: number;
    pageHeightPt: number;
    cap: number;
    expectedEffectiveDpi: number;
  }
>();
type CellReport = {
  readonly key: string;
  readonly fixtureSha256: string;
  readonly nominalDpi: number;
  readonly sourceWidthPx: number;
  readonly sourceHeightPx: number;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  readonly cap: number;
  readonly expectedEffectiveDpi: number;
  readonly physicalRotation: number;
  readonly naturalOrientation: number | null;
  readonly osdHadVerdict: boolean | null;
  readonly inkRatio: number | null;
  readonly firstWordCount: number;
  readonly dispatchedAngles: number[];
  readonly dispatchedDpis: Array<number | null>;
  readonly upscales: number[];
  readonly imageSha256: string[];
  readonly deliveredWordCount: number;
  readonly cacheKeyConfirmed: boolean;
  readonly cacheWordCount: number;
  exportBlackFraction: number | null;
  complete: boolean;
};
const cellReports = new Map<string, CellReport>();

async function persistReport(): Promise<void> {
  await writeFile(
    resolve(OUTPUT_DIR, "summary.json"),
    JSON.stringify(
      {
        schema: 1,
        protocol: "ADR-190 RC N1 natural pipeline and final PDF export",
        expectedCells: 4,
        observedCells: cellReports.size,
        cells: [...cellReports.values()],
      },
      null,
      2,
    ),
  );
}

function rotateDniRect(rect: { x0: number; y0: number; x1: number; y1: number }, angle: number) {
  const width = 595.28;
  const height = 841.89;
  if (angle === 90)
    return { pageIndex: 0, x0: rect.y0, y0: width - rect.x1, x1: rect.y1, y1: width - rect.x0 };
  if (angle === 270)
    return { pageIndex: 0, x0: height - rect.y1, y0: rect.x0, x1: height - rect.y0, y1: rect.x1 };
  throw new Error("N1 test expects physical 90/270 degree rotations");
}

test.beforeAll(async () => {
  if (entries.length !== 4) throw new Error("N1 fixture plan must contain exactly four cells");
  const geometry = GEOMETRIES.find((candidate) => candidate.id === "N1");
  if (geometry === undefined) throw new Error("N1 geometry missing from M-O1 corpus");
  const source = await buildGeometrySource(geometry);
  const sourceHash = hashBytes(source.bytes).slice(0, 16);
  const expected = new Map<string, string>();
  if (existsSync(MO1_MANIFEST)) {
    const manifest = JSON.parse(await readFile(MO1_MANIFEST, "utf8")) as {
      pdfHashes?: Record<string, unknown>;
    };
    for (const entry of entries) {
      const value = manifest.pdfHashes?.[entry.key];
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        throw new Error("M-O1 manifest lacks an N1 fixture identity");
      expected.set(entry.key, value);
    }
  }
  const cached = new Set(
    entries
      .filter((entry) => existsSync(resolve(CACHE_DIR, entry.key + "-" + sourceHash + ".pdf")))
      .map((entry) => entry.key),
  );
  await mkdir(OUTPUT_DIR, { recursive: true });
  const generated = await generateSparseFixtures(entries, OUTPUT_DIR);
  for (const entry of entries) {
    const fixture = generated.get(entry.key);
    if (fixture === undefined) throw new Error("N1 fixture generation omitted a planned cell");
    const oldHash = expected.get(entry.key);
    if (cached.has(entry.key) && oldHash !== undefined && fixture.hash !== oldHash)
      throw new Error("cached N1 fixture hash differs from the M-O1 manifest");
    const cap = Math.ceil(
      72 *
        Math.max(
          fixture.sourceWidthPx / fixture.pageWidth,
          fixture.sourceHeightPx / fixture.pageHeight,
        ),
    );
    const expectedEffectiveDpi = Math.min(300, cap);
    const quarter = entry.physicalRotation === 90 || entry.physicalRotation === 270;
    const expectedWidthPx = Math.ceil((geometry.widthPt * entry.sourceDpi) / 72);
    const expectedHeightPx = Math.ceil((geometry.heightPt * entry.sourceDpi) / 72);
    expect(fixture.sourceWidthPx).toBe(quarter ? expectedHeightPx : expectedWidthPx);
    expect(fixture.sourceHeightPx).toBe(quarter ? expectedWidthPx : expectedHeightPx);
    expect(fixture.pageWidth).toBe(quarter ? geometry.heightPt : geometry.widthPt);
    expect(fixture.pageHeight).toBe(quarter ? geometry.widthPt : geometry.heightPt);
    expect(cap).toBe(entry.sourceDpi === 150 ? 151 : 301);
    expect(expectedEffectiveDpi).toBe(entry.sourceDpi === 150 ? 151 : 300);
    fixtures.set(entry.key, {
      path: fixture.path,
      hash: fixture.hash,
      nominalDpi: entry.sourceDpi,
      sourceWidthPx: fixture.sourceWidthPx,
      sourceHeightPx: fixture.sourceHeightPx,
      pageWidthPt: fixture.pageWidth,
      pageHeightPt: fixture.pageHeight,
      cap,
      expectedEffectiveDpi,
    });
  }
  await persistReport();
});

test("ADR-190 RC: N1 natural a 150/300 dpi y giros físicos 90/270 recupera el DNI y lo tapa en el export", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await installRcN1TransportObserver(page);
  await openApp(page, "networkidle");
  await attachRcN1DocumentObserver(page);

  const geometry = GEOMETRIES.find((candidate) => candidate.id === "N1");
  if (geometry === undefined) throw new Error("N1 geometry missing from M-O1 corpus");
  const { bytes: sourcePdf, lines } = await buildGeometrySource(geometry);
  const source = await PDFDocument.load(sourcePdf);
  expect(source.getPageCount()).toBe(1);
  expect(source.getPage(0).getRotation().angle).toBe(0);
  expect(source.getPage(0).getSize().width).toBeCloseTo(595.28, 2);
  expect(source.getPage(0).getSize().height).toBeCloseTo(841.89, 2);
  const line = lines[0];
  if (line === undefined || line.text !== "Juan Perez DNI 34.567.891")
    throw new Error("N1 geometry is not the prescribed single centered line");
  const font = await source.embedFont(StandardFonts.Helvetica);
  const dniStart = line.x + font.widthOfTextAtSize("Juan Perez DNI ", 12);
  const dniWidth = font.widthOfTextAtSize(DNI, 12);
  const sourceRect = {
    x0: dniStart - 3,
    y0: line.y - 3,
    x1: dniStart + dniWidth + 3,
    y1: line.y + 15,
  };

  for (const entry of entries) {
    const fixture = fixtures.get(entry.key);
    if (fixture === undefined) throw new Error("N1 fixture missing after cache/generation stage");
    const bytes = await readFile(fixture.path);
    expect(hashBytes(bytes), entry.key + ": fixture identity").toBe(fixture.hash);
    const scanned = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(scanned.getPageCount()).toBe(1);
    expect(scanned.getPage(0).getRotation().angle).toBe(0);
    expect(scanned.getPage(0).getSize().width).toBeCloseTo(841.89, 1);
    expect(scanned.getPage(0).getSize().height).toBeCloseTo(595.28, 1);
    const region = rotateDniRect(sourceRect, entry.physicalRotation);
    const sourceCanvasRegion = await convertPdfRectsToRegions(page, bytes, [region]);
    const [sourcePixels] = await samplePdfRegions(page, bytes, sourceCanvasRegion);
    expect(sourcePixels?.darkFraction ?? 0, entry.key + ": DNI source ink").toBeGreaterThan(0.05);

    await page.locator('input[type="file"]').setInputFiles({
      name: entry.key + ".pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
    const exportButton = page.getByRole("button", { name: "Exportar" });
    await expect(exportButton, entry.key + ": Ready").toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/no se pudo leer/i), entry.key + ": readable").toHaveCount(0);
    const entityGroup = page.getByRole("treeitem", { name: DNI });
    await expect(entityGroup, entry.key + ": DNI detected").toBeVisible();

    const run = await readRcN1Run(page);
    const osd = run.jobs.filter((job) => job.jobType === "ocr-orient");
    const natural = osd[0]?.result as
      | { orientation?: unknown; osdHadVerdict?: unknown; inkRatio?: unknown }
      | null
      | undefined;
    const attempts = run.jobs.filter((job) => job.jobType === "ocr-page");
    const firstResult = attempts[0]?.result;
    const firstWords =
      typeof firstResult === "object" &&
      firstResult !== null &&
      "words" in firstResult &&
      Array.isArray(firstResult.words)
        ? firstResult.words
        : null;
    const firstWordCount = firstWords?.length ?? -1;
    const imageHashes = new Set(
      attempts.map((input) => hashBytes(Buffer.from(input.imageBase64, "base64"))),
    );
    const cacheEvent = run.cacheEvents[0];
    const cacheKeyConfirmed =
      run.cacheEvents.length === 1 &&
      cacheEvent?.key === "ocr-words:" + attempts[0]?.documentId + ":0" &&
      cacheEvent.pageIndex === 0 &&
      cacheEvent.wordCount > 0;
    const report: CellReport = {
      key: entry.key,
      fixtureSha256: fixture.hash,
      nominalDpi: fixture.nominalDpi,
      sourceWidthPx: fixture.sourceWidthPx,
      sourceHeightPx: fixture.sourceHeightPx,
      pageWidthPt: fixture.pageWidthPt,
      pageHeightPt: fixture.pageHeightPt,
      cap: fixture.cap,
      expectedEffectiveDpi: fixture.expectedEffectiveDpi,
      physicalRotation: entry.physicalRotation,
      naturalOrientation: typeof natural?.orientation === "number" ? natural.orientation : null,
      osdHadVerdict: typeof natural?.osdHadVerdict === "boolean" ? natural.osdHadVerdict : null,
      inkRatio: typeof natural?.inkRatio === "number" ? natural.inkRatio : null,
      firstWordCount,
      dispatchedAngles: attempts.map((job) => job.dispatchedOrientation ?? -1),
      dispatchedDpis: attempts.map((job) => job.dpi),
      upscales: attempts.map((job) => job.upscale),
      imageSha256: [...imageHashes].sort(),
      deliveredWordCount: run.deliveredWords.length,
      cacheKeyConfirmed,
      cacheWordCount: cacheEvent?.wordCount ?? -1,
      exportBlackFraction: null,
      complete: false,
    };
    cellReports.set(entry.key, report);
    await persistReport();

    expect(run.ready).toBe(true);
    expect(run.failure).toBeNull();
    expect(run.deliveredWords.length, entry.key + ": delivered words").toBeGreaterThan(0);
    expect(run.unreadable, entry.key + ": no unreadable event").toHaveLength(0);
    expect(osd).toHaveLength(1);
    expect(natural?.osdHadVerdict).toBe(false);
    expect(natural?.orientation).toBe(0);
    expect(natural?.inkRatio).toEqual(expect.any(Number));
    expect(natural?.inkRatio as number).toBeGreaterThan(0);
    expect(natural?.inkRatio as number).toBeLessThan(0.002);
    expect(firstWords, entry.key + ": first OCR result has a words array").not.toBeNull();
    expect(firstWordCount, entry.key + ": first OCR reading is empty").toBe(0);
    expect(attempts.map((job) => job.dispatchedOrientation)).toEqual([0, 90, 180, 270]);
    const dispatchedDpis = attempts.map((job) => job.dpi);
    expect(new Set(dispatchedDpis).size, entry.key + ": same effective DPI across attempts").toBe(
      1,
    );
    expect(dispatchedDpis).toEqual([
      fixture.expectedEffectiveDpi,
      fixture.expectedEffectiveDpi,
      fixture.expectedEffectiveDpi,
      fixture.expectedEffectiveDpi,
    ]);
    expect(attempts.map((job) => job.upscale)).toEqual([1, 1, 1, 1]);
    expect(new Set(attempts.map((job) => job.documentId)).size).toBe(1);
    expect(new Set(attempts.map((job) => job.pageIndex)).size).toBe(1);
    expect(attempts.every((job) => job.terminal === "COMPLETED")).toBe(true);
    expect(attempts).toHaveLength(4);
    expect(imageHashes.size, entry.key + ": same raster for each OCR angle").toBe(1);
    expect(
      attempts.every((input) => input.dpi !== null && input.dispatchedOrientation !== null),
    ).toBe(true);
    expect(run.cacheEvents, entry.key + ": OCR cache event observed").toHaveLength(1);
    expect(cacheKeyConfirmed, entry.key + ": exact OCR words cache key contains words").toBe(true);
    expect(cacheEvent?.wordCount).toBeGreaterThan(0);
    expect(attempts[0]?.orientation, entry.key + ": natural orientation delivered to OCR").toBe(
      natural?.orientation,
    );

    const occurrence = run.entities.find((candidate) => candidate.value === DNI);
    expect(occurrence, entry.key + ": captured entity bbox").toBeDefined();
    const bbox = occurrence?.bbox as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    expect(bbox?.x).toEqual(expect.any(Number));
    expect(bbox?.y).toEqual(expect.any(Number));
    expect(bbox?.width).toEqual(expect.any(Number));
    expect(bbox?.height).toEqual(expect.any(Number));
    const expectedBox = {
      x0: region.x0,
      y0: 595.28 - region.y1,
      x1: region.x1,
      y1: 595.28 - region.y0,
    };
    const overlapX = Math.max(
      0,
      Math.min((bbox?.x ?? 0) + (bbox?.width ?? 0), expectedBox.x1) -
        Math.max(bbox?.x ?? 0, expectedBox.x0),
    );
    const overlapY = Math.max(
      0,
      Math.min((bbox?.y ?? 0) + (bbox?.height ?? 0), expectedBox.y1) -
        Math.max(bbox?.y ?? 0, expectedBox.y0),
    );
    expect(
      overlapX * overlapY,
      entry.key + ": entity overlaps the known DNI region",
    ).toBeGreaterThan(0);

    await entityGroup.getByRole("button", { name: /^Modo de reemplazo de / }).click();
    await page
      .getByRole("group", { name: "Modo de reemplazo" })
      .getByRole("button", { name: /^Tapar con negro/ })
      .click();
    await exportButton.click();
    const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Exportar" }).click();
    await expect(page.getByRole("dialog", { name: "Páginas que no se pudieron leer" })).toHaveCount(
      0,
    );
    const link = dialog.getByRole("link", { name: "Descargar" });
    await expect(link).toBeVisible({ timeout: 180_000 });
    const exported = await captureDownload(
      electronApp,
      async () => link.click(),
      resolve(OUTPUT_DIR, entry.key + "-export.pdf"),
    );
    const exportRegion = await convertPdfRectsToRegions(page, exported, [region]);
    const [exportPixels] = await samplePdfRegions(page, exported, exportRegion);
    report.exportBlackFraction = exportPixels?.blackFraction ?? 0;
    await persistReport();
    expect(
      exportPixels?.blackFraction ?? 0,
      entry.key + ": DNI black in final PDF",
    ).toBeGreaterThanOrEqual(0.6);
    report.complete = true;
    await persistReport();
    await dialog.getByRole("button", { name: "Abrir otro documento" }).click();
    await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
    await resetRcN1Run(page);
  }
});
