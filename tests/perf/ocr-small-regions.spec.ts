import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";

import { chromium, type ElectronApplication, type Page } from "@playwright/test";

import { captureDownload, expect, openApp, test } from "../e2e/support/electronApp.js";
import {
  assertMixedFixtureTextLayer,
  buildSmallMixedCharacterizationFixture,
  extractPdfTextLayer,
  type ExportFixture,
} from "../e2e/support/exportVerificationFixtures.js";
import {
  auditPdfWithIndependentOcr,
  verifyLocalOcrAssets,
} from "../e2e/support/exportVerificationOcr.js";

import { startHeapSampling } from "./support/cdpHeap.js";
import { summarizeReadableForcedTargets } from "./support/forcedOcrQuality.js";
import { buildMemoryCampaignSchedule } from "./support/memoryCampaignSchedule.js";
import { peakSumBytes, peakSumBytesOrNull, startMemorySampling } from "./support/memorySampler.js";
import {
  CONTENT_KINDS,
  MEASURED_HEIGHTS_PT,
  ORIENTATIONS,
  SOURCE_DPI,
  SMALL_REGION_GENERATOR,
  assessIndependentSourceLegibility,
  extractCorpusPages,
  generateAlignedTextImageControls,
  generateEntityAuditControls,
  generateSmallRegionCorpus,
  generateSmallRegionLoadFixture,
  scoreExpectedText,
  scoreOcrText,
  type SmallRegionCase,
  type SmallRegionCorpus,
  type SmallRegionLoadFixture,
  type AlignedTextImageCorpus,
} from "./support/ocrSmallRegionCorpus.js";
import {
  auditForcedOcrEntityDetectors,
  forceOcrExcludedRegions,
  installSmallRegionObserver,
  observeProductDocument,
  releaseSmallRegionOcrWorkers,
  removeSmallRegionObserver,
  waitForSmallRegionReady,
  type ProductDocumentObservation,
} from "./support/ocrSmallRegionRuntime.js";
import { readSystemMemoryPressure } from "./support/systemMemoryPressure.js";

const CAMPAIGN = process.env.ANONLY_SMALL_REGION_CAMPAIGN === "1";
const QUALITY_ONLY = process.env.ANONLY_SMALL_REGION_PHASE === "quality";
const ALIGNED_ONLY = process.env.ANONLY_SMALL_REGION_PHASE === "aligned";
const ENTITY_AUDIT_ONLY = process.env.ANONLY_SMALL_REGION_PHASE === "entity-audit";
const SOURCE_AUDIT_ONLY = process.env.ANONLY_SMALL_REGION_PHASE === "source-audit";
const MEMORY_ONLY = process.env.ANONLY_SMALL_REGION_PHASE === "memory";
const MEASUREMENT_INSTRUMENT = "small-region-research-v2.1-heap-1000ms";
const HEAP_SAMPLING_INTERVAL_MS = 1000;
const SESSION = new Date().toISOString().replaceAll(/[:.]/g, "-");
const OUTPUT_DIR = resolve(".measure/ocr-small-regions", `${SESSION}-${process.pid}`);
const QUALITY_FILE = "quality-baseline-forced.json";
let sharedCorpus: SmallRegionCorpus | undefined;
let sharedAlignedCorpus: AlignedTextImageCorpus | undefined;
let sharedEntityAuditCorpus: SmallRegionCorpus | undefined;
let alignedGenerationDeterminism:
  | { readonly firstSha256: string; readonly repeatedSha256: string; readonly stable: boolean }
  | undefined;
let mixedFixture: ExportFixture | undefined;
const sharedLoadFixtures = new Map<string, SmallRegionLoadFixture>();

interface BuildEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

const MEASUREMENT_RUNS = buildMemoryCampaignSchedule();

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashTree(directory: string): Promise<ReadonlyArray<BuildEntry>> {
  const result: BuildEntry[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await hashTree(path)));
    else {
      const bytes = await readFile(path);
      result.push({ path: path.replaceAll("\\", "/"), sha256: digest(bytes), bytes: bytes.length });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function buildIdentity(): Promise<{
  readonly buildFiles: ReadonlyArray<BuildEntry>;
  readonly buildSha256: string;
  readonly ocrAssets: Awaited<ReturnType<typeof verifyLocalOcrAssets>>;
}> {
  const buildFiles = [
    ...(await hashTree(resolve("apps/react-client/dist"))),
    ...(await hashTree(resolve("apps/desktop-shell/dist"))),
  ];
  return {
    buildFiles,
    buildSha256: digest(Buffer.from(JSON.stringify(buildFiles))),
    ocrAssets: await verifyLocalOcrAssets(),
  };
}

function pagePresentedRect(item: SmallRegionCase): SmallRegionCase["imageRect"] {
  return {
    x: item.imageRect.x,
    y: item.pageHeightPt - item.imageRect.y - item.imageRect.height,
    width: item.imageRect.width,
    height: item.imageRect.height,
  };
}

async function closeMeasuredDocument(page: Page): Promise<void> {
  const closeButton = page.locator('button[aria-label="Cerrar documento"]:visible');
  const dialog = page.getByRole("dialog", { name: "Cerrar documento" });
  await closeButton.waitFor({ state: "visible", timeout: 30_000 });
  await closeButton.click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: "Cerrar documento" }).click();
  await dialog.waitFor({ state: "hidden" });
}

function rssInEpochWindow(
  samples: ReturnType<typeof startMemorySampling>["samples"],
  samplerStartedAtMs: number,
  startEpochMs: number,
  endEpochMs: number,
) {
  return samples.filter((sample) => {
    const epochMs = samplerStartedAtMs + sample.atMs;
    return epochMs >= startEpochMs && epochMs <= endEpochMs;
  });
}

function explainExclusion(
  item: SmallRegionCase,
  page: ProductDocumentObservation["pages"][number] | undefined,
  regions: ProductDocumentObservation["ocrRegions"],
): string | null {
  if (page?.requiresOCR) return "full-page OCR pathway (not an OCR region candidate)";
  if (regions.some((region) => region.pageIndex === item.pageIndex)) return null;
  const areaRatio =
    (item.imageRect.width * item.imageRect.height) / (item.pageWidthPt * item.pageHeightPt);
  if (areaRatio < 0.01) {
    return "Necessary-condition inference: the individual image rectangle is below 1% page area; the internal rejection step is not observable.";
  }
  if (Math.min(item.imageRect.width, item.imageRect.height) < 100) {
    return "Necessary-condition inference: clamp cannot satisfy the 100 pt minimum on both sides; area, empty-area, or grid filters may reject earlier, and the internal rejection step is not observable.";
  }
  return "Not retained; the discarded grid candidate and its internal rejection reason are not observable. Only retained OCR regions are exposed by the product.";
}

function classifyCases(
  corpus: SmallRegionCorpus,
  observation: ProductDocumentObservation,
): ReadonlyArray<{
  readonly id: string;
  readonly pageIndex: number;
  readonly sourceDpi: number;
  readonly ocrDpiRequested: number;
  readonly orientation: SmallRegionCase["orientation"];
  readonly content: SmallRegionCase["content"];
  readonly truth: ReadonlyArray<string>;
  readonly expectedTextTokens: ReadonlyArray<string>;
  readonly rasterModel: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly effectiveDpiX: number;
    readonly effectiveDpiY: number;
    readonly fontSizePx: number | null;
    readonly fontFace: string;
    readonly textMaxWidthPx: number | null;
  };
  readonly imageRect: SmallRegionCase["imageRect"];
  readonly imageBboxPresentedAsExperimentalInput: SmallRegionCase["imageRect"];
  readonly candidateGeometryNote: string;
  readonly sourceImageSha256: string;
  readonly nativeOverlayAudit: SmallRegionCase["nativeOverlayAudit"];
  readonly productRegion: ProductDocumentObservation["ocrRegions"][number] | null;
  readonly exclusionCause: string | null;
  readonly requiresOCR: boolean;
  readonly nativeWordCount: number;
  readonly productOcrWordCount: number;
  readonly productOcrText: string;
  readonly productOcrFinishedEvents: number;
}> {
  return corpus.cases.map((item) => {
    const page = observation.pages[item.pageIndex];
    const actualRegions = observation.ocrRegions.filter(
      (region) => region.pageIndex === item.pageIndex,
    );
    return {
      id: item.id,
      pageIndex: item.pageIndex,
      sourceDpi: item.sourceDpi,
      ocrDpiRequested: observation.effectiveSettings.ocrDpi,
      orientation: item.orientation,
      content: item.content,
      truth: item.truth,
      expectedTextTokens: item.expectedTextTokens,
      rasterModel: {
        widthPx: item.imagePixels.width,
        heightPx: item.imagePixels.height,
        effectiveDpiX: (item.imagePixels.width * 72) / item.widthPt,
        effectiveDpiY: (item.imagePixels.height * 72) / item.heightPt,
        fontSizePx: item.fontSizePx,
        fontFace: item.fontFace,
        textMaxWidthPx: item.textMaxWidthPx,
      },
      imageRect: item.imageRect,
      imageBboxPresentedAsExperimentalInput: pagePresentedRect(item),
      candidateGeometryNote:
        "This is the image bbox supplied by the experimental corpus in page coordinates. It is not an observed, grid-expanded product candidate; discarded candidate geometry is not exposed.",
      sourceImageSha256: item.sourceImageSha256,
      nativeOverlayAudit: item.nativeOverlayAudit,
      productRegion: actualRegions[0] ?? null,
      exclusionCause: explainExclusion(item, page, observation.ocrRegions),
      requiresOCR: page?.requiresOCR ?? false,
      nativeWordCount: page?.nativeWordCount ?? 0,
      productOcrWordCount: page?.productOcrWordCount ?? 0,
      productOcrText: page?.productOcrText ?? "",
      productOcrFinishedEvents: observation.ocrEvents.filter(
        (event) => event.pageIndex === item.pageIndex,
      ).length,
    };
  });
}

async function importPdf(page: Page, fileName: string, bytes: Buffer): Promise<string> {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: bytes });
  return waitForSmallRegionReady(page);
}

async function renderFullProductDocument(
  page: Page,
  documentId: string,
  pageCount: number,
): Promise<void> {
  await page.evaluate(
    ({ id, count }) => {
      const core = (
        window as typeof window & {
          __anonlyCore?: {
            readonly bus: { emit(channel: string, event: string, payload: unknown): void };
          };
        }
      ).__anonlyCore;
      if (core === undefined) throw new Error("Core ausente al medir Render.");
      core.bus.emit("ui", "RENDER_REQUESTED", {
        documentId: id,
        pageIndices: Array.from({ length: count }, (_, index) => index),
        mode: "full",
        kind: "anonymized",
      });
    },
    { id: documentId, count: pageCount },
  );
  await page.waitForFunction(
    ({ id, count }) =>
      window.__smallRegionStudy?.renderEvents.some(
        (event) =>
          event.documentId === id &&
          event.pageIndices.length === count &&
          event.pageIndices.every((index, expectedIndex) => index === expectedIndex),
      ) ?? false,
    { id: documentId, count: pageCount },
    { timeout: 600_000 },
  );
}

async function exportThroughUi(
  page: Page,
  electronApp: ElectronApplication,
  savePath: string,
): Promise<{ readonly bytes: Buffer; readonly options: unknown }> {
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 60_000 });
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await expect(dialog).toBeVisible();
  const options = await dialog.evaluate((element) => ({
    text: element.textContent?.replaceAll(/\s+/gu, " ").trim() ?? "",
    controls: Array.from(element.querySelectorAll("input, select, textarea")).map((control) => {
      const input = control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      return {
        tag: control.tagName.toLowerCase(),
        name: input.name,
        type: "type" in input ? input.type : control.tagName.toLowerCase(),
        value: input.value,
        checked: "checked" in input ? input.checked : null,
        ariaLabel: control.getAttribute("aria-label"),
      };
    }),
  }));
  await dialog.getByRole("button", { name: "Exportar" }).click();
  const link = dialog.getByRole("link", { name: "Descargar" });
  await expect(link).toBeVisible({ timeout: 600_000 });
  const observedRequest = await page.evaluate(() => {
    const requests = window.__smallRegionStudy?.exportRequests ?? [];
    return requests.at(-1) ?? null;
  });
  const bytes = await captureDownload(electronApp, () => link.click(), savePath, 600_000);
  const doneButton = dialog.getByRole("button", { name: "Listo" });
  await expect(doneButton).toBeVisible({ timeout: 30_000 });
  await doneButton.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return {
    bytes,
    options: { dialog: options, observedRequest },
  };
}

async function measureProductCycle(
  page: Page,
  electronApp: ElectronApplication,
  fixture: SmallRegionLoadFixture,
  name: string,
  outputPath: string,
): Promise<{
  readonly documentId: string;
  readonly observation: ProductDocumentObservation;
  readonly exported: Buffer;
  readonly exportOptions: unknown;
  readonly phases: {
    readonly import: { readonly startEpochMs: number; readonly endEpochMs: number };
    readonly render: { readonly startEpochMs: number; readonly endEpochMs: number };
    readonly export: { readonly startEpochMs: number; readonly endEpochMs: number };
    readonly rest: { readonly startEpochMs: number; readonly endEpochMs: number };
  };
}> {
  const importStartEpochMs = Date.now();
  const documentId = await importPdf(page, `${name}.pdf`, Buffer.from(fixture.bytes));
  const importEndEpochMs = Date.now();
  const observation = await observeProductDocument(page, documentId);
  const renderStartEpochMs = Date.now();
  await renderFullProductDocument(page, documentId, fixture.pageCount);
  const renderEndEpochMs = Date.now();
  const exportStartEpochMs = Date.now();
  const exportResult = await exportThroughUi(page, electronApp, outputPath);
  const exportEndEpochMs = Date.now();
  const restStartEpochMs = Date.now();
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 30_000));
  const restEndEpochMs = Date.now();
  return {
    documentId,
    observation,
    exported: exportResult.bytes,
    exportOptions: exportResult.options,
    phases: {
      import: { startEpochMs: importStartEpochMs, endEpochMs: importEndEpochMs },
      render: { startEpochMs: renderStartEpochMs, endEpochMs: renderEndEpochMs },
      export: { startEpochMs: exportStartEpochMs, endEpochMs: exportEndEpochMs },
      rest: { startEpochMs: restStartEpochMs, endEpochMs: restEndEpochMs },
    },
  };
}

async function prepareMeasurementApp(page: Page): Promise<void> {
  await openApp(page, "networkidle");
  await page.waitForFunction(
    () => (window as typeof window & { __anonlyCore?: unknown }).__anonlyCore !== undefined,
  );
  await installSmallRegionObserver(page);
}

async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test.describe("OCR small regions: product baseline and isolated OCR experiment", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!CAMPAIGN, "Explicit opt-in research campaign: ANONLY_SMALL_REGION_CAMPAIGN=1");
  test.setTimeout(3_600_000);

  test.beforeAll(async ({ browserName }, testInfo) => {
    testInfo.setTimeout(1_800_000);
    const preparationStartedAt = Date.now();
    await saveJson(join(OUTPUT_DIR, "fixture-preparation-started.json"), {
      generatedAt: new Date().toISOString(),
      generatorVersion: SMALL_REGION_GENERATOR,
      playwrightBrowser: browserName,
    });
    try {
      if (QUALITY_ONLY || SOURCE_AUDIT_ONLY) {
        sharedCorpus = await generateSmallRegionCorpus();
      }
      if (MEMORY_ONLY || QUALITY_ONLY) {
        for (const count of [1, 10, 50] as const) {
          sharedLoadFixtures.set(
            `${count}-one-per-page`,
            await generateSmallRegionLoadFixture(count, "one-per-page"),
          );
        }
        sharedLoadFixtures.set(
          "50-many-same-page",
          await generateSmallRegionLoadFixture(50, "many-same-page"),
        );
      }
      if (QUALITY_ONLY) {
        const browser = await chromium.launch();
        try {
          const fixturePage = await browser.newPage();
          mixedFixture = await buildSmallMixedCharacterizationFixture(fixturePage);
          assertMixedFixtureTextLayer(mixedFixture);
          await fixturePage.close();
        } finally {
          await browser.close();
        }
      }
      if (ALIGNED_ONLY) {
        sharedAlignedCorpus = await generateAlignedTextImageControls();
        const repeated = await generateAlignedTextImageControls();
        alignedGenerationDeterminism = {
          firstSha256: sharedAlignedCorpus.sha256,
          repeatedSha256: repeated.sha256,
          stable: sharedAlignedCorpus.sha256 === repeated.sha256,
        };
        if (!alignedGenerationDeterminism.stable) {
          throw new Error("Los controles alineados no produjeron un hash determinista.");
        }
      } else if (QUALITY_ONLY) {
        sharedAlignedCorpus = await generateAlignedTextImageControls();
      }
      if (ENTITY_AUDIT_ONLY) {
        const generated = await generateEntityAuditControls();
        const repeated = await generateEntityAuditControls();
        if (generated.sha256 !== repeated.sha256) {
          throw new Error("Los controles de auditoría de entidades no son deterministas.");
        }
        sharedEntityAuditCorpus = {
          ...generated,
          pageCount: generated.cases.length,
        };
      }
      await saveJson(join(OUTPUT_DIR, "fixture-preparation-complete.json"), {
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - preparationStartedAt,
        corpus:
          sharedCorpus === undefined
            ? null
            : {
                generator: sharedCorpus.generator,
                seed: sharedCorpus.seed,
                sha256: sharedCorpus.sha256,
                pageCount: sharedCorpus.pageCount,
              },
        alignedControls:
          sharedAlignedCorpus === undefined
            ? null
            : {
                generator: sharedAlignedCorpus.generator,
                seed: sharedAlignedCorpus.seed,
                sha256: sharedAlignedCorpus.sha256,
                pageCount: sharedAlignedCorpus.cases.length,
                sourceImageHashes: sharedAlignedCorpus.cases.map((item) => item.sourceImageSha256),
              },
        alignedGenerationDeterminism,
        loadFixtures: [...sharedLoadFixtures.entries()].map(([id, fixture]) => ({
          id,
          sha256: fixture.sha256,
          imageCount: fixture.imageCount,
          pageCount: fixture.pageCount,
          maxImagesPerPage: fixture.maxImagesPerPage,
        })),
        mixedFixture:
          mixedFixture === undefined
            ? null
            : {
                corpusRevision: mixedFixture.corpusRevision,
                sha256: digest(mixedFixture.bytes),
                geometry: mixedFixture.mixedGeometry,
              },
      });
    } catch (error) {
      await saveJson(join(OUTPUT_DIR, `fixture-generation-attempt-${Date.now()}-failed.json`), {
        generatedAt: new Date().toISOString(),
        campaign: "ocr-small-regions",
        corpusSeed: 20261005,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      throw error;
    }
  });

  test("full synthetic quality corpus: current pipeline, then forced excluded regions", async ({
    page,
    electronApp,
    electronUserDataDir,
  }) => {
    test.skip(
      !QUALITY_ONLY,
      "Run with ANONLY_SMALL_REGION_PHASE=quality to measure all quality cells.",
    );
    await mkdir(OUTPUT_DIR, { recursive: true });
    const corpus = sharedCorpus;
    if (corpus === undefined) throw new Error("Corpus de calidad no preparado antes de Electron.");
    const identity = await buildIdentity();
    const pressureAtStart = await readSystemMemoryPressure();
    const sampler = startMemorySampling(electronApp, 150);
    let heap: Awaited<ReturnType<typeof startHeapSampling>> | undefined;
    let heapUnavailableReason: string | null = null;
    try {
      heap = await startHeapSampling(electronUserDataDir, HEAP_SAMPLING_INTERVAL_MS);
    } catch (error) {
      heapUnavailableReason = error instanceof Error ? error.message : "CDP heap unavailable";
    }
    try {
      await prepareMeasurementApp(page);
      const startedAtEpochMs = Date.now();
      const documentId = await importPdf(page, "small-region-full-corpus.pdf", corpus.bytes);
      const readyAtEpochMs = Date.now();
      const product = await observeProductDocument(page, documentId);
      const baselineRows = classifyCases(corpus, product);
      const admittedPageIndexes = new Set(product.ocrRegions.map((region) => region.pageIndex));
      const excluded = corpus.cases.filter(
        (item) =>
          !admittedPageIndexes.has(item.pageIndex) && !product.pages[item.pageIndex]?.requiresOCR,
      );

      const forcedStartEpochMs = Date.now();
      const forcedSamplerStart = sampler.samples.length;
      const forced = await forceOcrExcludedRegions(
        page,
        documentId,
        corpus.bytes,
        corpus.cases,
        new Set(excluded.map((item) => item.pageIndex)),
      );
      const forcedEndEpochMs = Date.now();
      await sampler.sampleOnce();
      const pressureAtEnd = await readSystemMemoryPressure();
      const forcedById = new Map(forced.results.map((result) => [result.caseId, result]));
      const combined = baselineRows.map((row) => {
        const item = corpus.cases[row.pageIndex];
        const forcedResult = forcedById.get(row.id);
        const score = scoreOcrText(row.truth, forcedResult?.text ?? "");
        const textScore = scoreExpectedText(row.expectedTextTokens, forcedResult?.text ?? "");
        return {
          ...row,
          forcedOcr:
            forcedResult === undefined
              ? null
              : {
                  wordCount: forcedResult.wordCount,
                  text: forcedResult.text,
                  durationMs: forcedResult.durationMs,
                  truthFound: score.found,
                  truthMissing: score.missing,
                  expectedText: textScore,
                  ocrTextIncludesSensitiveTarget: score.found.length > 0,
                  nonemptyTextOnBlankRaster:
                    item?.content === "blank" && !textScore.recognizedTextIsEmpty,
                  inconclusive: forcedResult.wordCount === 0 || textScore.recognizedTextIsEmpty,
                  misalignedOverlayOcrTextDetected: Boolean(
                    item?.content === "native-overlay-misaligned" && score.found.length > 0,
                  ),
                },
        };
      });
      sampler.stop();
      heap?.stop();
      const verificationCases = corpus.cases.filter(
        (item) =>
          (item.pageIndex < 7 * ORIENTATIONS.length * SOURCE_DPI.length * CONTENT_KINDS.length &&
            item.content === "sensitive") ||
          item.content === "neutral",
      );
      const verificationPdf = await extractCorpusPages(
        corpus.bytes,
        verificationCases.map((item) => item.pageIndex),
      );
      let independentlyAudited;
      try {
        independentlyAudited = await auditPdfWithIndependentOcr(page, verificationPdf, []);
      } catch (error) {
        await saveJson(join(OUTPUT_DIR, `source-verification-attempt-${Date.now()}-failed.json`), {
          generatedAt: new Date().toISOString(),
          corpusSha256: corpus.sha256,
          caseIds: verificationCases.map((item) => item.id),
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
        throw error;
      }
      const sourceVerification = verificationCases.map((item, index) => {
        const recognizedText = independentlyAudited.textByPage[index] ?? "";
        const numeric = scoreOcrText(item.truth, recognizedText);
        const text = scoreExpectedText(item.expectedTextTokens, recognizedText);
        const assessment = assessIndependentSourceLegibility(
          item.content,
          item.truth,
          item.expectedTextTokens,
          recognizedText,
        );
        return {
          caseId: item.id,
          sourceImageSha256: item.sourceImageSha256,
          independentOcrText: recognizedText,
          independentSensitiveValueFound: numeric.found,
          independentTextTruth: text,
          readable: assessment.independentlyReadable,
          inconclusive: assessment.inconclusive,
          sourceConclusionStatus: assessment.status,
          verifier: independentlyAudited.versions,
          assets: independentlyAudited.assetHashes,
        };
      });
      const sourceVerificationById = new Map(sourceVerification.map((item) => [item.caseId, item]));
      const verifiedCombined = combined.map((row) => {
        const source = sourceVerificationById.get(row.id);
        const baselineSensitive = scoreOcrText(row.truth, row.productOcrText);
        return {
          ...row,
          baselineSensitiveTarget:
            row.truth.length === 0
              ? null
              : {
                  found: baselineSensitive.found,
                  missing: baselineSensitive.missing,
                  admittedRegion: row.productRegion !== null,
                },
          independentSourceReadability:
            source === undefined
              ? null
              : { readable: source.readable, inconclusive: source.inconclusive },
          qualityConclusionStatus:
            source === undefined
              ? "not-independently-verified-cell"
              : !source.readable
                ? "source-legibility-unconfirmed"
                : row.forcedOcr === null
                  ? "product-retained-or-full-page-path"
                  : row.forcedOcr.inconclusive
                    ? "forced-ocr-inconclusive"
                    : "scorable-source-and-forced-ocr",
        };
      });
      const independentlyReadableSensitive = verifiedCombined.filter(
        (row) => row.truth.length > 0 && row.independentSourceReadability?.readable === true,
      );
      const independentlyUnconfirmedSensitive = verifiedCombined.filter(
        (row) => row.truth.length > 0 && row.independentSourceReadability?.readable === false,
      );
      const admittedSensitive = verifiedCombined.filter(
        (row) => row.baselineSensitiveTarget?.admittedRegion === true,
      );
      const metadataById = new Map(corpus.cases.map((item) => [item.id, item]));
      const under100Sensitive = verifiedCombined.filter((row) => {
        const item = metadataById.get(row.id);
        return (
          row.truth.length > 0 && item !== undefined && Math.min(item.widthPt, item.heightPt) < 100
        );
      });
      const under100Readable = under100Sensitive.filter(
        (row) => row.independentSourceReadability?.readable === true,
      );
      const readableForcedSummary = summarizeReadableForcedTargets(
        independentlyReadableSensitive.map((row) => ({
          id: row.id,
          truthCount: row.truth.length,
          sourceReadable: true,
          forcedOcr:
            row.forcedOcr === null
              ? null
              : {
                  truthFoundCount: row.forcedOcr.truthFound.length,
                  truthMissingCount: row.forcedOcr.truthMissing.length,
                  inconclusive: row.forcedOcr.inconclusive,
                },
        })),
      );
      const under100ReadableForcedSummary = summarizeReadableForcedTargets(
        under100Readable.map((row) => ({
          id: row.id,
          truthCount: row.truth.length,
          sourceReadable: true,
          forcedOcr:
            row.forcedOcr === null
              ? null
              : {
                  truthFoundCount: row.forcedOcr.truthFound.length,
                  truthMissingCount: row.forcedOcr.truthMissing.length,
                  inconclusive: row.forcedOcr.inconclusive,
                },
        })),
      );
      const under100Forced = under100Sensitive.filter((row) => row.forcedOcr !== null);
      const blankTextDetections = verifiedCombined.filter(
        (row) =>
          row.content === "blank" && row.forcedOcr !== null && row.forcedOcr.text.trim().length > 0,
      );
      const qualitySummary = {
        independentlyReadableSensitiveCount: independentlyReadableSensitive.length,
        independentlyUnconfirmedSensitiveCount: independentlyUnconfirmedSensitive.length,
        forcedSensitiveAttemptedAmongReadableSources: readableForcedSummary.attemptedCount,
        forcedSensitiveRecoveredAmongReadableSources: readableForcedSummary.recoveredCount,
        forcedSensitiveMissesAmongReadableSources: readableForcedSummary.missCaseIds,
        forcedSensitiveInconclusiveAmongReadableSources: readableForcedSummary.inconclusiveCaseIds,
        readableSourcesWithoutForcedOcr: readableForcedSummary.noForcedOcrCaseIds,
        admittedSensitiveCellCount: admittedSensitive.length,
        admittedSensitiveTargetMisses: admittedSensitive
          .filter((row) => (row.baselineSensitiveTarget?.missing.length ?? 0) > 0)
          .map((row) => row.id),
        under100SensitiveCells: {
          rawForcedTargetFoundCount: under100Forced.filter(
            (row) => row.forcedOcr?.truthFound.length === row.truth.length,
          ).length,
          rawForcedTargetCount: under100Forced.length,
          independentlyReadableSourceCount: under100Readable.length,
          independentlyReadableForcedAttemptedCount: under100ReadableForcedSummary.attemptedCount,
          independentlyReadableForcedTargetFoundCount: under100ReadableForcedSummary.recoveredCount,
          independentlyReadableForcedTargetMisses: under100ReadableForcedSummary.missCaseIds,
          independentlyReadableSourcesWithoutForcedOcr:
            under100ReadableForcedSummary.noForcedOcrCaseIds,
          sourceLegibilityInconclusiveCount: under100Sensitive.length - under100Readable.length,
          sourceLegibilityInconclusiveCaseIds: under100Sensitive
            .filter((row) => row.independentSourceReadability?.readable !== true)
            .map((row) => row.id),
          confirmedSourceForcedMisses: under100ReadableForcedSummary.missCaseIds,
        },
        blankRegionsWithNonemptyForcedTextCount: blankTextDetections.length,
        blankRegionsWithSensitiveTargetDigitsInOcrTextCount: blankTextDetections.filter(
          (row) => row.forcedOcr?.ocrTextIncludesSensitiveTarget,
        ).length,
        forcedProductEntityDetection: {
          status: "not observed",
          reason:
            "Experimental OCR words were not sent through product regex/NER or grouping; OCR digit matches are text-recall observations only.",
        },
        interpretation:
          "A source-unreadable or independently unverified cell is inconclusive. Nonempty OCR text in blank rasters and detected sensitive values are separate outcomes.",
      };
      const report = {
        reportType: "synthetic-small-region-quality-baseline-and-forced-ocr",
        measurementInstrument: MEASUREMENT_INSTRUMENT,
        heapSamplingIntervalMs: HEAP_SAMPLING_INTERVAL_MS,
        heapSamplerMethodLimit:
          "Cada lectura CDP fuerza GC por target; sus muestras y el costo temporal observados incluyen esta perturbación.",
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        cpu: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        session: SESSION,
        build: identity,
        corpus: {
          generator: corpus.generator,
          seed: corpus.seed,
          sha256: corpus.sha256,
          pageCount: corpus.pageCount,
          cases: corpus.cases.map((item) => ({
            ...item,
            pageWidthPt: item.pageWidthPt,
            pageHeightPt: item.pageHeightPt,
          })),
          measuredHeightsPt: MEASURED_HEIGHTS_PT,
          orientations: ORIENTATIONS,
          sourceDpi: SOURCE_DPI,
          contentKinds: CONTENT_KINDS,
        },
        policyAudit: {
          individualImageAreaMinimum: 0.01,
          pageGrid: { columns: 64, rows: 64 },
          nativeTextDilations: { horizontalImageWidths: 0.5, verticalImageWidths: 0.8 },
          perImageCandidateMinimumEmptyAreaRatio: 0.4,
          finalMinimumClampedSidePoints: 100,
          maximumRetainedRegionsPerPage: 1,
          retainedCandidate:
            "greatest empty grid area after clamp; strict greater-than tie keeps first candidate",
          admittedOperators: [
            "paintImageXObject",
            "paintImageMaskXObject",
            "paintInlineImageXObject",
          ],
          limitation: "Repeated/grouped paint operators remain outside ADR-065 coverage.",
          dpiSemantics:
            "source image DPI is recorded from rounded raster pixels / PDF point rectangle; region OCR uses config.ocr.dpi, reported separately.",
        },
        baseline: {
          importStartEpochMs: startedAtEpochMs,
          readyEpochMs: readyAtEpochMs,
          readyDurationMs: readyAtEpochMs - startedAtEpochMs,
          productSummary: product,
          currentPolicyRetainedRegions: product.ocrRegions.length,
          baselineOcrFinishedEvents: product.ocrEvents.length,
          baselineRows,
        },
        forcedOcrExperiment: {
          runsAfterPipelineReady: true,
          uniqueDocumentId: forced.documentId,
          fusionIntoPipelineDocument: false,
          dpi: forced.dpi,
          durationMs: forced.durationMs,
          imageCount: forced.imageCount,
          pixels: forced.pixels,
          phase: { startEpochMs: forcedStartEpochMs, endEpochMs: forcedEndEpochMs },
          rssSamplesDuringForcedPhase: sampler.samples.slice(forcedSamplerStart),
          pressure: { start: pressureAtStart, end: pressureAtEnd },
          results: verifiedCombined,
          qualitySummary,
        },
        independentSourceVerification: {
          methodology:
            "Original sensitive corpus pages rasterized at 288 DPI and OCRed through the independent Node verifier; excluded from app RSS windows.",
          cases: sourceVerification,
        },
        rss: {
          peakTotalProcessWorkingSetBytes: peakSumBytes(sampler.samples),
          samples: sampler.samples,
          sampleDurationsMs: sampler.sampleDurationsMs,
        },
        heap: heap === undefined ? null : heap.samples,
        heapUnavailableReason,
        windows: {
          total: { startEpochMs: startedAtEpochMs, endEpochMs: Date.now() },
          baselineImportToReady: { startEpochMs: startedAtEpochMs, endEpochMs: readyAtEpochMs },
          forcedOcr: { startEpochMs: forcedStartEpochMs, endEpochMs: forcedEndEpochMs },
        },
        note: "OCR forzado posterior a Ready es una caracterización experimental separada; no altera el resultado E2E ni reproduce orden/superposición OCR→NER de una futura política. El costo observado no predice por sí solo un runtime futuro.",
      };
      await saveJson(join(OUTPUT_DIR, QUALITY_FILE), report);
      expect(product.ready).toBe(true);
      expect(product.pageCount).toBe(corpus.pageCount);
      expect(product.effectiveSettings.performancePreset).toBe("medium");
      expect(product.effectiveSettings.ocrPoolSize).toBe(2);
      expect(product.effectiveSettings.nerPoolSize).toBe(2);
      expect(product.effectiveSettings.nerEnabled).toBe(true);
      expect(product.ocrRegions.length).toBeGreaterThan(0);
      expect(product.ocrRegions.length).toBeLessThan(corpus.pageCount);
      expect(forced.imageCount).toBe(excluded.length);
    } finally {
      sampler.stop();
      heap?.stop();
      await removeSmallRegionObserver(page).catch(() => undefined);
    }
  });

  test("mixed 300x56 export: actual product download and independent raster OCR", async ({
    page,
    electronApp,
  }) => {
    test.skip(
      !QUALITY_ONLY,
      "Run with ANONLY_SMALL_REGION_PHASE=quality to audit the exported mixed control.",
    );
    await mkdir(OUTPUT_DIR, { recursive: true });
    const fixture = mixedFixture;
    if (fixture === undefined) throw new Error("Fixture mixed no preparado antes de Electron.");
    const focusedPdf = Buffer.from(fixture.bytes);
    const sourceAudit = await auditPdfWithIndependentOcr(page, focusedPdf, [0]);
    await prepareMeasurementApp(page);
    const documentId = await importPdf(page, "small-region-adr148-mixed.pdf", focusedPdf);
    const beforeExport = await observeProductDocument(page, documentId);
    const outputPath = join(OUTPUT_DIR, "mixed-300x56-export.pdf");
    const exportStartEpochMs = Date.now();
    const exportResult = await exportThroughUi(page, electronApp, outputPath);
    const exportEndEpochMs = Date.now();
    const outputBytes = exportResult.bytes;
    const outputAudit = await auditPdfWithIndependentOcr(page, outputBytes, [0]);
    const report = {
      reportType: "mixed-300x56-real-export-independent-ocr",
      generatedAt: new Date().toISOString(),
      corpusRevision: fixture.corpusRevision,
      fixtureSha256: digest(focusedPdf),
      geometry: fixture.mixedGeometry,
      targets: fixture.targets,
      neighbors: fixture.neighborsByPage,
      textLayerTextByPage: fixture.textLayerTextByPage,
      sourceKind: fixture.sourceKind,
      exportOptions: exportResult.options,
      requestedProductRegionDpi: beforeExport.effectiveSettings.ocrDpi,
      product: beforeExport,
      sourceIndependentOcr: {
        versions: sourceAudit.versions,
        assetHashes: sourceAudit.assetHashes,
        text: sourceAudit.textByPage,
        expectedSensitiveTargets: fixture.targets.map((target) => target.value),
        independentlyReadableTargets: fixture.targets.map((target) => {
          const digits = target.value.replaceAll(/\D/gu, "");
          const normalizedText = (sourceAudit.textByPage[target.pageIndex] ?? "").replaceAll(
            /\D/gu,
            "",
          );
          return {
            targetId: target.id,
            found: normalizedText.includes(digits),
            target: target.value,
          };
        }),
        rasterSize: sourceAudit.rasters.map(({ widthPt, heightPt }) => ({ widthPt, heightPt })),
      },
      output: {
        sha256: digest(outputBytes),
        bytes: outputBytes.byteLength,
        exportWindow: {
          startEpochMs: exportStartEpochMs,
          endEpochMs: exportEndEpochMs,
          durationMs: exportEndEpochMs - exportStartEpochMs,
        },
        independentOcr: {
          text: outputAudit.textByPage,
          versions: outputAudit.versions,
          assetHashes: outputAudit.assetHashes,
        },
      },
      methodLimit:
        "Exportación normal de la app; lectura OCR independiente del PDF final. El OCR forzado no se fusiona al documento ni a los grupos.",
    };
    await saveJson(join(OUTPUT_DIR, "mixed-300x56-export-audit.json"), report);
    await rm(outputPath, { force: true });
    expect(beforeExport.ocrRegions.some((region) => region.pageIndex === 0)).toBe(false);
    expect(beforeExport.ocrEvents.some((event) => event.pageIndex === 0)).toBe(false);
    expect(beforeExport.effectiveSettings.nerEnabled).toBe(true);
    expect(outputBytes.byteLength).toBeGreaterThan(100);
  });

  test("neutral and filter-boundary source legibility: independent OCR truth", async () => {
    test.skip(
      !(QUALITY_ONLY || SOURCE_AUDIT_ONLY),
      "Run with ANONLY_SMALL_REGION_PHASE=quality for source legibility checks.",
    );
    await mkdir(OUTPUT_DIR, { recursive: true });
    const corpus = sharedCorpus;
    if (corpus === undefined) throw new Error("Corpus neutral no preparado antes de la medición.");
    const verificationCases = corpus.cases.filter(
      (item) =>
        item.content === "neutral" ||
        item.isFilterBoundary ||
        (item.content === "sensitive" &&
          item.pageIndex < 7 * ORIENTATIONS.length * SOURCE_DPI.length * CONTENT_KINDS.length),
    );
    const verificationPdf = await extractCorpusPages(
      corpus.bytes,
      verificationCases.map((item) => item.pageIndex),
    );
    const browser = await chromium.launch();
    try {
      const verifierPage = await browser.newPage();
      const audit = await auditPdfWithIndependentOcr(verifierPage, verificationPdf, []);
      const results = verificationCases.map((item, index) => {
        const recognizedText = audit.textByPage[index] ?? "";
        const text = scoreExpectedText(item.expectedTextTokens, recognizedText);
        const numeric = scoreOcrText(item.truth, recognizedText);
        const assessment = assessIndependentSourceLegibility(
          item.content,
          item.truth,
          item.expectedTextTokens,
          recognizedText,
        );
        const independentlyReadable = assessment.independentlyReadable;
        return {
          caseId: item.id,
          content: item.content,
          truth: item.truth,
          sourceImageSha256: item.sourceImageSha256,
          expectedTextTokens: item.expectedTextTokens,
          independentOcrText: recognizedText,
          textTruth: text,
          independentlyReadable,
          sourceConclusionStatus: assessment.status,
          detectedSensitiveValue: numeric.found,
          inconclusive: assessment.inconclusive,
        };
      });
      const sourceUnconfirmedCases = verificationCases.filter((item) => {
        const result = results.find((candidate) => candidate.caseId === item.id);
        return result !== undefined && !result.independentlyReadable;
      });
      const experimentalRotationReadings = new Map<
        string,
        Array<{
          readonly rotationDegrees: 90 | 180 | 270;
          readonly text: string;
          readonly sensitiveTargetFound: ReadonlyArray<string>;
          readonly expectedText: ReturnType<typeof scoreExpectedText>;
        }>
      >();
      if (sourceUnconfirmedCases.length > 0) {
        for (const rotationDegrees of [90, 180, 270] as const) {
          const rotationPdf = await extractCorpusPages(
            corpus.bytes,
            sourceUnconfirmedCases.map((item) => item.pageIndex),
          );
          const rotationAudit = await auditPdfWithIndependentOcr(
            verifierPage,
            rotationPdf,
            sourceUnconfirmedCases.map(() => rotationDegrees),
          );
          sourceUnconfirmedCases.forEach((item, index) => {
            const text = rotationAudit.textByPage[index] ?? "";
            const row = experimentalRotationReadings.get(item.id) ?? [];
            row.push({
              rotationDegrees,
              text,
              sensitiveTargetFound: scoreOcrText(item.truth, text).found,
              expectedText: scoreExpectedText(item.expectedTextTokens, text),
            });
            experimentalRotationReadings.set(item.id, row);
          });
        }
      }
      const resultsWithRotationReadings = results.map((result) => ({
        ...result,
        experimentalRotationReadings: experimentalRotationReadings.get(result.caseId) ?? [],
      }));
      await saveJson(join(OUTPUT_DIR, "neutral-boundary-source-legibility.json"), {
        reportType: "independent-neutral-and-boundary-source-legibility",
        generatedAt: new Date().toISOString(),
        measurementInstrument: MEASUREMENT_INSTRUMENT,
        corpus: {
          generator: corpus.generator,
          seed: corpus.seed,
          sha256: corpus.sha256,
          pageCount: corpus.pageCount,
        },
        verifier: audit.versions,
        assets: audit.assetHashes,
        cases: resultsWithRotationReadings,
        rotationMethod: {
          status: "separate experimental view",
          angles: [90, 180, 270],
          appliedTo: sourceUnconfirmedCases.map((item) => item.id),
          note: "Primary readings remain unchanged; page-rotated readings are additional evidence and do not alter the primary oracle or earlier results.",
        },
        misalignedOverlayControls: corpus.cases
          .filter((item) => item.content === "native-overlay-misaligned")
          .map((item) => ({
            caseId: item.id,
            sourceImageSha256: item.sourceImageSha256,
            imageRect: item.imageRect,
            nativeLayerExplainsImage: item.nativeLayerExplainsImage,
            audit: item.nativeOverlayAudit ?? null,
          })),
        misalignedOverlayInterpretation:
          "The former native-duplicate cells use separate Arial raster ink and a smaller horizontal Helvetica overlay. Their measured bboxes are control geometry only; they do not demonstrate that the native layer explains the image or that OCR is redundant.",
        note: "REGION PUBLICA tiene verdad textual explícita y no contiene entidad sensible. Las fronteras originales se auditan antes de atribuir un fallo al OCR forzado; resultados ilegibles son inconclusos.",
      });
      await verifierPage.close();
    } catch (error) {
      await saveJson(
        join(OUTPUT_DIR, `neutral-boundary-legibility-attempt-${Date.now()}-failed.json`),
        {
          corpusSha256: corpus.sha256,
          caseIds: verificationCases.map((item) => item.id),
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        },
      );
      throw error;
    } finally {
      await browser.close();
    }
  });

  test("aligned native text and image controls: real pipeline plus isolated forced OCR", async ({
    page,
  }) => {
    test.skip(
      !(QUALITY_ONLY || ALIGNED_ONLY),
      "Run with ANONLY_SMALL_REGION_PHASE=aligned or quality for aligned text/image controls.",
    );
    await mkdir(OUTPUT_DIR, { recursive: true });
    const corpus = sharedAlignedCorpus;
    if (corpus === undefined)
      throw new Error("Controles alineados no preparados antes de Electron.");
    await mkdir(join(OUTPUT_DIR, "aligned-control-images"), { recursive: true });
    for (const item of corpus.cases) {
      await writeFile(
        join(OUTPUT_DIR, "aligned-control-images", `${item.id}.png`),
        item.sourceImagePng,
      );
    }
    await prepareMeasurementApp(page);
    const documentId = await importPdf(page, "aligned-text-image-controls.pdf", corpus.bytes);
    try {
      const product = await observeProductDocument(page, documentId);
      const extractedText = await extractPdfTextLayer(page, corpus.bytes);
      const independentAudit = await auditPdfWithIndependentOcr(page, corpus.bytes, []);
      const cases = corpus.cases.map(
        (item): SmallRegionCase => ({
          id: item.id,
          pageIndex: item.pageIndex,
          widthPt: item.imageRect.width,
          heightPt: item.imageRect.height,
          pageWidthPt: 595,
          pageHeightPt: 842,
          sourceDpi: item.sourceDpi,
          orientation: item.orientation,
          content: "sensitive",
          expectedTextTokens: ["DNI", "34567891"],
          fontSizePx: null,
          fontFace:
            "PDF Helvetica; identical text draw operation for image source and invisible layer",
          textMaxWidthPx: null,
          truth: ["34567891"],
          imageRect: item.imageRect,
          imagePixels: item.imagePixels,
          sourceImageSha256: item.sourceImageSha256,
          pdfImageRotationDegrees: 0,
          nativeLayerExplainsImage: true,
          isFilterBoundary: false,
        }),
      );
      const forced = await forceOcrExcludedRegions(
        page,
        documentId,
        corpus.bytes,
        cases,
        new Set(cases.map((item) => item.pageIndex)),
      );
      const nativeTextRows = corpus.cases.map((item, index) => {
        const pageText = extractedText[index] ?? "";
        const expected = scoreExpectedText(["DNI", "34567891"], pageText);
        return {
          caseId: item.id,
          sourceImageSha256: item.sourceImageSha256,
          imageRect: item.imageRect,
          textRect: item.textRect,
          nativeText: pageText,
          independentRasterOcrText: independentAudit.textByPage[index] ?? "",
          independentRasterOcrTarget: scoreOcrText(
            ["34567891"],
            independentAudit.textByPage[index] ?? "",
          ),
          nativeTextTruth: expected,
          textLayerConfirmed: expected.missingTokens.length === 0,
          samePdfDrawCommandAndCrop: true,
        };
      });
      const forcedById = new Map(forced.results.map((row) => [row.caseId, row]));
      const report = {
        reportType: "aligned-native-text-image-controls",
        generatedAt: new Date().toISOString(),
        corpus: {
          generator: corpus.generator,
          seed: corpus.seed,
          sha256: corpus.sha256,
          pageCount: corpus.cases.length,
          cases: corpus.cases.map(({ sourceImagePng: _sourceImagePng, ...item }) => item),
        },
        productBaseline: {
          ready: product.ready,
          pageCount: product.pageCount,
          effectiveSettings: product.effectiveSettings,
          ocrRegions: product.ocrRegions,
          ocrEvents: product.ocrEvents,
          groups: product.groups,
          pages: product.pages,
          h125ActualRegionPageIndexes: product.ocrRegions
            .filter((region) => corpus.cases[region.pageIndex]?.heightPt === 125)
            .map((region) => region.pageIndex),
        },
        nativeTextRows,
        forcedOcr: {
          dpi: forced.dpi,
          durationMs: forced.durationMs,
          pixels: forced.pixels,
          results: corpus.cases.map((item) => {
            const ocr = forcedById.get(item.id);
            const text = ocr?.text ?? "";
            return {
              caseId: item.id,
              text,
              wordCount: ocr?.wordCount ?? 0,
              durationMs: ocr?.durationMs ?? null,
              truth: scoreOcrText(["34567891"], text),
              expectedText: scoreExpectedText(["DNI", "34567891"], text),
            };
          }),
          entityDetection: "not observed; OCR outputs were isolated from Regex/NER/groups",
        },
        alignmentVerification:
          "Each image crop is rendered from a scratch PDF page and the invisible native text is drawn in the final page using the exact same font resource, text, origin, size, and rotation command. Image bbox and text bbox are recorded in PDF points; extracted PDF text confirms the hidden layer is present.",
      };
      await saveJson(join(OUTPUT_DIR, "aligned-text-image-controls.json"), report);
      expect(product.ready).toBe(true);
      expect(product.pageCount).toBe(corpus.cases.length);
      expect(nativeTextRows.every((row) => row.textLayerConfirmed)).toBe(true);
      expect(nativeTextRows.every((row) => row.independentRasterOcrTarget.found.length > 0)).toBe(
        true,
      );
      expect(
        forced.results.every((row) => scoreOcrText(["34567891"], row.text).found.length > 0),
      ).toBe(true);
      expect(forced.imageCount).toBe(corpus.cases.length);
    } finally {
      await releaseSmallRegionOcrWorkers(page).catch(() => undefined);
      await closeMeasuredDocument(page).catch(() => undefined);
      await removeSmallRegionObserver(page).catch(() => undefined);
    }
  });

  test("separate OCR words through real Regex and NER engines without document fusion", async ({
    page,
  }) => {
    test.skip(!ENTITY_AUDIT_ONLY, "Run with ANONLY_SMALL_REGION_PHASE=entity-audit.");
    await mkdir(OUTPUT_DIR, { recursive: true });
    const corpus = sharedEntityAuditCorpus;
    if (corpus === undefined) throw new Error("Controles de entidades no preparados.");
    const fixturePath = join(OUTPUT_DIR, "entity-audit-controls.pdf");
    await writeFile(fixturePath, corpus.bytes);
    await prepareMeasurementApp(page);
    const documentId = await importPdf(page, "entity-audit-controls.pdf", corpus.bytes);
    let forced: Awaited<ReturnType<typeof forceOcrExcludedRegions>> | undefined;
    try {
      const product = await observeProductDocument(page, documentId);
      forced = await forceOcrExcludedRegions(
        page,
        documentId,
        corpus.bytes,
        corpus.cases,
        new Set(corpus.cases.map((item) => item.pageIndex)),
      );
      const entityDetection = await auditForcedOcrEntityDetectors(page, forced, corpus.cases);
      const report = {
        reportType: "ocr-small-region-isolated-regex-ner-audit",
        generatedAt: new Date().toISOString(),
        corpus: {
          generator: corpus.generator,
          seed: corpus.seed,
          sha256: corpus.sha256,
          pageCount: corpus.pageCount,
          cases: corpus.cases.map(({ ...item }) => item),
        },
        productBaseline: product,
        forcedOcr: {
          documentId: forced.documentId,
          dpi: forced.dpi,
          imageCount: forced.imageCount,
          durationMs: forced.durationMs,
          results: forced.results,
        },
        entityDetection,
        originalLegibility: corpus.cases.map((item) => ({
          caseId: item.id,
          status: "INCONCLUSIVE_NOT_INDEPENDENTLY_VERIFIED",
          reason:
            "This directed entity audit did not independently assess human readability of the source raster.",
        })),
        isolation:
          "Exact OCR Word objects are passed to the initialized application RegexEngine and NerEngine using unique IDs that do not exist in orchestrator.documents. Outputs are collected directly; no OCR events or occurrences are fused into the measured product document. This is detector characterization after Ready, not proof of the future OCR→NER ordering or of a changed admission policy.",
      };
      await saveJson(join(OUTPUT_DIR, "isolated-regex-ner-audit.json"), report);
      expect(product.ready).toBe(true);
      expect(product.effectiveSettings.performancePreset).toBe("medium");
      expect(product.effectiveSettings.nerEnabled).toBe(true);
      expect(product.ocrRegions).toHaveLength(0);
      expect(product.ocrEvents).toHaveLength(0);
      expect(forced.imageCount).toBe(corpus.cases.length);
      expect(entityDetection.configuration.nerEnabled).toBe(true);
      expect(entityDetection.documentCountAfter).toBe(entityDetection.documentCountBefore);
      expect(entityDetection.cases.map((item) => item.caseId)).toEqual(
        corpus.cases.map((item) => item.id),
      );
      expect(entityDetection.cases.every((item) => item.regex.status === "completed")).toBe(true);
      expect(entityDetection.cases.every((item) => item.ner.status === "completed")).toBe(true);
    } catch (error) {
      await saveJson(join(OUTPUT_DIR, "isolated-regex-ner-audit-failed.json"), {
        reportType: "ocr-small-region-isolated-regex-ner-audit-failed",
        generatedAt: new Date().toISOString(),
        corpusSha256: corpus.sha256,
        forcedOcr: forced?.results ?? null,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      throw error;
    } finally {
      await releaseSmallRegionOcrWorkers(page).catch(() => undefined);
      await closeMeasuredDocument(page).catch(() => undefined);
      await removeSmallRegionObserver(page).catch(() => undefined);
    }
  });

  for (const run of MEASUREMENT_RUNS) {
    const profileName =
      run.distribution === "one-per-page"
        ? `${run.count}-regions-${run.distribution}`
        : `${run.count}-regions-${run.distribution}`;
    test(`memory round ${run.round} order ${run.orderIndex + 1}: ${profileName}`, async ({
      page,
      electronApp,
      electronUserDataDir,
    }) => {
      test.skip(
        !MEMORY_ONLY,
        "Run with ANONLY_SMALL_REGION_PHASE=memory to execute the interleaved memory campaign.",
      );
      await mkdir(OUTPUT_DIR, { recursive: true });
      const fixture = sharedLoadFixtures.get(`${run.count}-${run.distribution}`);
      if (fixture === undefined)
        throw new Error("Fixture de carga no preparada antes de Electron.");
      const fixtureFileSha256 = fixture.sha256;
      const corpusImageHashes = [...new Set(fixture.cases.map((item) => item.sourceImageSha256))];
      await prepareMeasurementApp(page);
      const pressureStart = await readSystemMemoryPressure();
      const hostFreeMemoryStartBytes = os.freemem();
      const rss = startMemorySampling(electronApp, 150);
      let heap: Awaited<ReturnType<typeof startHeapSampling>> | undefined;
      let heapUnavailableReason: string | null = null;
      try {
        heap = await startHeapSampling(electronUserDataDir, HEAP_SAMPLING_INTERVAL_MS);
      } catch (error) {
        heapUnavailableReason = error instanceof Error ? error.message : "CDP heap unavailable";
      }
      try {
        const cold = await measureProductCycle(
          page,
          electronApp,
          fixture,
          `small-region-${profileName}-cold`,
          join(OUTPUT_DIR, `round-${run.round}-${profileName}-cold-product.pdf`),
        );
        await closeMeasuredDocument(page);
        await removeSmallRegionObserver(page);
        await installSmallRegionObserver(page);
        const hot = await measureProductCycle(
          page,
          electronApp,
          fixture,
          `small-region-${profileName}-hot`,
          join(OUTPUT_DIR, `round-${run.round}-${profileName}-hot-product.pdf`),
        );
        await rss.sampleOnce();
        const pressureEnd = await readSystemMemoryPressure();
        const hostFreeMemoryEndBytes = os.freemem();
        rss.stop();
        const baselineRssSamples = [...rss.samples];
        heap?.stop();
        const productHeapSamples = heap === undefined ? null : [...heap.samples];
        const phaseWindows = { cold: cold.phases, hot: hot.phases };
        const phaseRss = Object.fromEntries(
          Object.entries(phaseWindows).map(([cycleName, phases]) => [
            cycleName,
            Object.fromEntries(
              Object.entries(phases).map(([phaseName, window]) => {
                const samples = rssInEpochWindow(
                  baselineRssSamples,
                  rss.startedAtMs,
                  window.startEpochMs,
                  window.endEpochMs,
                );
                return [
                  phaseName,
                  {
                    peakBytes: peakSumBytesOrNull(samples),
                    unavailableReason:
                      samples.length === 0 ? "No RSS sample landed in this phase window." : null,
                    samples,
                  },
                ];
              }),
            ),
          ]),
        );
        const product = hot.observation;
        const documentId = hot.documentId;
        const exported = hot.exported;

        // OCR forzado va en una ventana separada posterior al baseline del
        // producto. Su resultado nunca se fusiona con Ready, Regex o grupos.
        const forcedRss = startMemorySampling(electronApp, 150);
        let forcedHeap: Awaited<ReturnType<typeof startHeapSampling>> | undefined;
        let forcedHeapUnavailableReason: string | null = null;
        try {
          forcedHeap = await startHeapSampling(electronUserDataDir, HEAP_SAMPLING_INTERVAL_MS);
        } catch (error) {
          forcedHeapUnavailableReason =
            error instanceof Error ? error.message : "CDP heap unavailable";
        }
        const forcedStartEpochMs = Date.now();
        const excludedPageIndexes = new Set(fixture.cases.map((item) => item.pageIndex));
        const forcedPressureStart = await readSystemMemoryPressure();
        let forcedCold: Awaited<ReturnType<typeof forceOcrExcludedRegions>> | undefined;
        let forcedHot: Awaited<ReturnType<typeof forceOcrExcludedRegions>> | undefined;
        let forcedColdWindow:
          | { readonly startEpochMs: number; readonly endEpochMs: number }
          | undefined;
        let forcedHotWindow:
          | { readonly startEpochMs: number; readonly endEpochMs: number }
          | undefined;
        try {
          const coldStartEpochMs = Date.now();
          forcedCold = await forceOcrExcludedRegions(
            page,
            documentId,
            fixture.bytes,
            fixture.cases,
            excludedPageIndexes,
            true,
          );
          forcedColdWindow = { startEpochMs: coldStartEpochMs, endEpochMs: Date.now() };
          const hotStartEpochMs = Date.now();
          forcedHot = await forceOcrExcludedRegions(
            page,
            documentId,
            fixture.bytes,
            fixture.cases,
            excludedPageIndexes,
            true,
          );
          forcedHotWindow = { startEpochMs: hotStartEpochMs, endEpochMs: Date.now() };
        } finally {
          await releaseSmallRegionOcrWorkers(page).catch(() => undefined);
          await forcedRss.sampleOnce().catch(() => undefined);
          forcedRss.stop();
          forcedHeap?.stop();
        }
        if (
          forcedCold === undefined ||
          forcedHot === undefined ||
          forcedColdWindow === undefined ||
          forcedHotWindow === undefined
        ) {
          throw new Error("Una de las dos sesiones OCR forzadas no produjo resultado.");
        }
        const forcedEndEpochMs = Date.now();
        const forcedPressureEnd = await readSystemMemoryPressure();
        const forcedRssSamples = [...forcedRss.samples];
        const forcedHeapSamples = forcedHeap === undefined ? null : [...forcedHeap.samples];
        const forcedColdSamples = rssInEpochWindow(
          forcedRssSamples,
          forcedRss.startedAtMs,
          forcedColdWindow.startEpochMs,
          forcedColdWindow.endEpochMs,
        );
        const forcedHotSamples = rssInEpochWindow(
          forcedRssSamples,
          forcedRss.startedAtMs,
          forcedHotWindow.startEpochMs,
          forcedHotWindow.endEpochMs,
        );
        const forcedReport = {
          sessions: [
            {
              label: "cold",
              documentId: forcedCold.documentId,
              window: forcedColdWindow,
              durationMs: forcedCold.durationMs,
              imageCount: forcedCold.imageCount,
              pixels: forcedCold.pixels,
              results: forcedCold.results.map(({ caseId, wordCount, durationMs, text }) => ({
                caseId,
                wordCount,
                durationMs,
                text,
              })),
              rssPeakBytes: peakSumBytesOrNull(forcedColdSamples),
              rssUnavailableReason:
                forcedColdSamples.length === 0 ? "No sample landed in cold OCR window." : null,
              rssSamples: forcedColdSamples,
            },
            {
              label: "hot",
              documentId: forcedHot.documentId,
              window: forcedHotWindow,
              durationMs: forcedHot.durationMs,
              imageCount: forcedHot.imageCount,
              pixels: forcedHot.pixels,
              results: forcedHot.results.map(({ caseId, wordCount, durationMs, text }) => ({
                caseId,
                wordCount,
                durationMs,
                text,
              })),
              rssPeakBytes: peakSumBytesOrNull(forcedHotSamples),
              rssUnavailableReason:
                forcedHotSamples.length === 0 ? "No sample landed in hot OCR window." : null,
              rssSamples: forcedHotSamples,
            },
          ],
          startEpochMs: forcedStartEpochMs,
          endEpochMs: forcedEndEpochMs,
          rssSamples: forcedRssSamples,
          heapSamples: forcedHeapSamples,
          heapUnavailableReason: forcedHeapUnavailableReason,
          pressure: { start: forcedPressureStart, end: forcedPressureEnd },
          releaseIdleWorkers:
            "released after each isolated cold and reopen-hot OCR session, matching the product's worker-release path",
        };

        const report = {
          session: SESSION,
          measurementInstrument: MEASUREMENT_INSTRUMENT,
          heapSamplingIntervalMs: HEAP_SAMPLING_INTERVAL_MS,
          heapSamplerMethodLimit:
            "Cada lectura CDP fuerza GC por target; sus muestras y el costo temporal observados incluyen esta perturbación.",
          round: run.round,
          orderIndex: run.orderIndex,
          distribution: fixture.distribution,
          imageCount: fixture.imageCount,
          pageCount: fixture.pageCount,
          maxImagesPerPage: fixture.maxImagesPerPage,
          fixtureSha256: fixtureFileSha256,
          productBaseline: {
            cold: {
              phases: cold.phases,
              readyMs: cold.phases.import.endEpochMs - cold.phases.import.startEpochMs,
              renderMs: cold.phases.render.endEpochMs - cold.phases.render.startEpochMs,
              exportMs: cold.phases.export.endEpochMs - cold.phases.export.startEpochMs,
              restMs: cold.phases.rest.endEpochMs - cold.phases.rest.startEpochMs,
              groups: cold.observation.groups,
              regions: cold.observation.ocrRegions.length,
              ocrEvents: cold.observation.ocrEvents.length,
              effectiveSettings: cold.observation.effectiveSettings,
              exportOptions: cold.exportOptions,
              exportedPdf: { sha256: digest(cold.exported), bytes: cold.exported.length },
            },
            hot: {
              phases: hot.phases,
              readyMs: hot.phases.import.endEpochMs - hot.phases.import.startEpochMs,
              renderMs: hot.phases.render.endEpochMs - hot.phases.render.startEpochMs,
              exportMs: hot.phases.export.endEpochMs - hot.phases.export.startEpochMs,
              restMs: hot.phases.rest.endEpochMs - hot.phases.rest.startEpochMs,
              productRegionCount: product.ocrRegions.length,
              productOcrEventCount: product.ocrEvents.length,
              readyGroupCount: product.groups,
              effectiveSettings: product.effectiveSettings,
              exportOptions: hot.exportOptions,
              exportedPdf: { sha256: digest(hot.exported), bytes: hot.exported.length },
            },
            rssPeakBytes: peakSumBytesOrNull(baselineRssSamples),
            rssSamples: baselineRssSamples,
            rssPeakByPhase: phaseRss,
            rssSampleDurationsMs: rss.sampleDurationsMs,
            heapSamples: productHeapSamples,
            heapUnavailableReason,
            memoryPressure: pressureStart,
            hostFreeMemoryBytesLimitedObservation: {
              start: hostFreeMemoryStartBytes,
              end: hostFreeMemoryEndBytes,
              limitation:
                "Node host free physical memory, not Windows pressure, swap, or compression.",
            },
            pressureEnd,
          },
          forcedOcrExperiment: {
            sessions: forcedReport.sessions,
            totalDurationMs: forcedReport.sessions.reduce(
              (total, session) => total + session.durationMs,
              0,
            ),
            heapSamples: forcedReport.heapSamples,
            memoryPressure: forcedReport.pressure,
            uniqueDocumentIds: forcedReport.sessions.map((session) => session.documentId),
          },
        };
        await saveJson(
          join(OUTPUT_DIR, `memory-round-${run.round}-${run.orderIndex + 1}-${profileName}.json`),
          {
            ...report,
            corpusImageHashes,
            actualProductSnapshot: product,
            buildAndAssets: await buildIdentity(),
            host: {
              platform: process.platform,
              architecture: process.arch,
              cpu: os.cpus()[0]?.model ?? "unknown",
              cpuCount: os.cpus().length,
              totalMemoryBytes: os.totalmem(),
            },
            windows: {
              cycles: phaseWindows,
              rssPeaksByPhase: phaseRss,
              forcedOcr: forcedReport,
            },
            exportedPdf: { sha256: digest(exported), bytes: exported.length },
            systemPressure: { start: pressureStart, end: pressureEnd },
            disclaimer:
              "El OCR forzado posterior a Ready es caracterización experimental, sin fusionar palabras ni reproducir el orden OCR→NER de una política futura. El costo observado no se suma al baseline como una predicción de runtime.",
          },
        );
        expect(product.ready).toBe(true);
        expect(product.pageCount).toBe(fixture.pageCount);
        expect(product.ocrRegions).toHaveLength(0);
        expect(product.ocrEvents).toHaveLength(0);
        expect(product.effectiveSettings.performancePreset).toBe("medium");
        expect(product.effectiveSettings.ocrPoolSize).toBe(2);
        expect(product.effectiveSettings.nerPoolSize).toBe(2);
        expect(product.effectiveSettings.nerEnabled).toBe(true);
        expect(forcedCold.imageCount).toBe(fixture.imageCount);
        expect(forcedHot.imageCount).toBe(fixture.imageCount);
        expect(exported.byteLength).toBeGreaterThan(100);
      } catch (error) {
        await saveJson(
          join(
            OUTPUT_DIR,
            `memory-round-${run.round}-${run.orderIndex + 1}-${profileName}-failed.json`,
          ),
          {
            session: SESSION,
            round: run.round,
            orderIndex: run.orderIndex,
            profileName,
            fixtureSha256: fixture.sha256,
            measurementInstrument: MEASUREMENT_INSTRUMENT,
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          },
        );
        throw error;
      } finally {
        rss.stop();
        heap?.stop();
        await releaseSmallRegionOcrWorkers(page).catch(() => undefined);
        await removeSmallRegionObserver(page).catch(() => undefined);
        await rm(join(OUTPUT_DIR, `round-${run.round}-${profileName}-cold-product.pdf`), {
          force: true,
        }).catch(() => undefined);
        await rm(join(OUTPUT_DIR, `round-${run.round}-${profileName}-hot-product.pdf`), {
          force: true,
        }).catch(() => undefined);
      }
    });
  }
});
