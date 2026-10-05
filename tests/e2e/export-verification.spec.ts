import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Page, TestInfo } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  assertFixtureRules,
  addPdfRotation,
  assertMixedFixtureTextLayer,
  buildExportFixture,
  extractPdfTextLayer,
  type ExportFixture,
  type ExportFixtureId,
} from "./support/exportVerificationFixtures.js";
import { auditPdfWithIndependentOcr, type OcrAudit } from "./support/exportVerificationOcr.js";
import {
  verifyExport,
  type OcrDocument,
  type VerificationResult,
} from "./support/exportVerificationOracle.js";
import {
  exportThroughRealEngines,
  fixtureTargetIdentifiers,
  type GeometryExportOptions,
} from "./support/exportVerificationRuntime.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(300_000);

type GeometryCase = GeometryExportOptions & {
  readonly fixtureId: ExportFixtureId;
  readonly label: string;
};
const GEOMETRY_CASES: ReadonlyArray<GeometryCase> = [
  ...(["redact", "placeholder", "mask", "synthetic"] as const).map((mode) => ({
    fixtureId: "native" as const,
    mode,
    dpi: 150,
    imageFormat: "jpeg" as const,
    jpegQuality: 0.85,
    label: `native geometry ${mode} JPEG 150 DPI`,
  })),
  {
    fixtureId: "native",
    mode: "redact",
    dpi: 150,
    imageFormat: "png",
    jpegQuality: 0.85,
    label: "native geometry redact PNG 150 DPI",
  },
  {
    fixtureId: "native",
    mode: "redact",
    dpi: 288,
    imageFormat: "png",
    jpegQuality: 0.85,
    label: "native geometry redact PNG 288 DPI",
  },
  {
    fixtureId: "native",
    mode: "redact",
    dpi: 288,
    imageFormat: "jpeg",
    jpegQuality: 0.85,
    label: "native geometry redact JPEG 288 DPI",
  },
  ...(["scan", "mixed", "stamp"] as const).map((fixtureId) => ({
    fixtureId,
    mode: "redact" as const,
    dpi: 150,
    imageFormat: "jpeg" as const,
    jpegQuality: 0.85,
    label: `${fixtureId} geometry redact JPEG 150 DPI`,
  })),
];

type VerificationSpec = {
  readonly path: "geometry" | "e2e";
  readonly fixtureId: ExportFixtureId;
  readonly expectedPageCount: number;
  readonly neighborsByPage: ReadonlyArray<ReadonlyArray<string>>;
  readonly sourceIdentifiersByPage: ReadonlyArray<ReadonlyArray<string>>;
  readonly forbiddenIdentifiers: ReadonlyArray<string>;
  readonly allowedIdentifiers?: ReadonlyArray<string>;
};

function verificationSpec(
  fixture: ExportFixture,
  path: VerificationSpec["path"],
): VerificationSpec {
  return {
    path,
    fixtureId: fixture.id,
    expectedPageCount: fixture.pageSizes.length,
    neighborsByPage: fixture.neighborsByPage,
    sourceIdentifiersByPage: fixture.pageSizes.map((_page, pageIndex) =>
      fixture.targets
        .filter((target) => target.pageIndex === pageIndex)
        .map((target) => target.value.replaceAll(/[^0-9]/gu, "")),
    ),
    forbiddenIdentifiers: fixtureTargetIdentifiers(fixture.targets, path === "geometry"),
    ...(fixture.id === "stamp" && path === "e2e" ? { allowedIdentifiers: ["72938461"] } : {}),
  };
}

function compareFixture(
  spec: VerificationSpec,
  source: OcrDocument,
  output: OcrDocument,
): VerificationResult {
  return verifyExport({
    id: spec.fixtureId,
    expectedPageCount: spec.expectedPageCount,
    neighborsByPage: spec.neighborsByPage,
    sourceIdentifiersByPage: spec.sourceIdentifiersByPage,
    forbiddenIdentifiers: spec.forbiddenIdentifiers,
    ...(spec.allowedIdentifiers === undefined
      ? {}
      : { allowedIdentifiers: spec.allowedIdentifiers }),
    source,
    output,
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixtureDescriptor(fixture: ExportFixture): Record<string, unknown> {
  return {
    id: fixture.id,
    sourceKind: fixture.sourceKind,
    corpusRevision: fixture.corpusRevision ?? null,
    pageSizes: fixture.pageSizes,
    targets: fixture.targets,
    neighborsByPage: fixture.neighborsByPage,
    mixedGeometry: fixture.mixedGeometry ?? null,
  };
}

function detectedGroup(page: Page, value: string) {
  const escaped = value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return page.getByRole("treeitem", { name: new RegExp(`^${escaped}(?:,|$)`, "u") });
}

type ProductDiagnostics = {
  readonly pipelineReady: unknown;
  readonly pdfPagesParsed: ReadonlyArray<unknown>;
  readonly ocrPageFinished: ReadonlyArray<unknown>;
  readonly ocrRegions: ReadonlyArray<{
    readonly pageIndex: number;
    readonly bbox: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }>;
  readonly ocrWords: ReadonlyArray<{
    readonly text: string;
    readonly pageIndex: number;
    readonly source: string;
    readonly confidence: number;
    readonly bbox: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }>;
  readonly groupsAfterReady: ReadonlyArray<string>;
};

async function installProductDiagnostics(page: Page, key: string): Promise<void> {
  await page.evaluate((storageKey) => {
    type DiagnosticState = {
      pipelineReady: unknown;
      pdfPagesParsed: unknown[];
      ocrPageFinished: unknown[];
      unlisteners: Array<() => void>;
    };
    type Core = {
      readonly bus: {
        on(channel: string, event: string, callback: (payload: unknown) => void): () => void;
      };
    };
    const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente antes de importar.");
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    const state: DiagnosticState = {
      pipelineReady: undefined,
      pdfPagesParsed: [],
      ocrPageFinished: [],
      unlisteners: [],
    };
    scope[storageKey] = state;
    state.unlisteners.push(
      core.bus.on("pipeline", "PIPELINE_READY", (payload) => {
        state.pipelineReady = payload;
      }),
      core.bus.on("pdf", "PAGE_PARSED", (payload) => state.pdfPagesParsed.push(payload)),
      core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => state.ocrPageFinished.push(payload)),
    );
  }, key);
}

async function removeProductDiagnostics(page: Page, key: string): Promise<void> {
  await page.evaluate((storageKey) => {
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    const stored = scope[storageKey];
    if (
      typeof stored === "object" &&
      stored !== null &&
      "unlisteners" in stored &&
      Array.isArray(stored.unlisteners)
    ) {
      for (const unlisten of stored.unlisteners) {
        if (typeof unlisten === "function") unlisten();
      }
    }
    delete scope[storageKey];
  }, key);
}

async function collectProductDiagnostics(page: Page, key: string): Promise<ProductDiagnostics> {
  return page.evaluate((storageKey) => {
    type Box = {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    type ProductWord = {
      readonly text: string;
      readonly pageIndex: number;
      readonly source: string;
      readonly confidence: number;
      readonly bbox: Box;
    };
    type OcrRegion = { readonly pageIndex: number; readonly bbox: Box };
    type DiagnosticCore = {
      readonly engines?: {
        readonly ocr?: {
          readonly ctx?: { readonly cache?: { get<T>(cacheKey: string): T | undefined } };
        };
      };
      readonly orchestrator?: {
        readonly ocrRegionsByDocument?: ReadonlyMap<string, ReadonlyArray<OcrRegion>>;
      };
    };
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    const stored = scope[storageKey];
    const state =
      typeof stored === "object" &&
      stored !== null &&
      "pdfPagesParsed" in stored &&
      Array.isArray(stored.pdfPagesParsed) &&
      "ocrPageFinished" in stored &&
      Array.isArray(stored.ocrPageFinished)
        ? {
            pipelineReady: "pipelineReady" in stored ? stored.pipelineReady : undefined,
            pdfPagesParsed: stored.pdfPagesParsed,
            ocrPageFinished: stored.ocrPageFinished,
          }
        : { pipelineReady: undefined, pdfPagesParsed: [], ocrPageFinished: [] };
    const ready = state.pipelineReady;
    const documentId =
      typeof ready === "object" &&
      ready !== null &&
      "documentId" in ready &&
      typeof ready.documentId === "string"
        ? ready.documentId
        : undefined;
    const core = (window as typeof window & { __anonlyCore?: DiagnosticCore }).__anonlyCore;
    const cache = core?.engines?.ocr?.ctx?.cache;
    const cachedWords =
      documentId === undefined
        ? undefined
        : cache?.get<ReadonlyArray<ProductWord>>(`ocr-words:${documentId}:0`);
    const ocrRegions =
      documentId === undefined
        ? []
        : (core?.orchestrator?.ocrRegionsByDocument?.get(documentId) ?? []);
    return {
      pipelineReady: ready,
      pdfPagesParsed: state.pdfPagesParsed,
      ocrPageFinished: state.ocrPageFinished,
      ocrRegions,
      ocrWords: Array.isArray(cachedWords)
        ? cachedWords.map((word) => ({
            text: word.text,
            pageIndex: word.pageIndex,
            source: word.source,
            confidence: word.confidence,
            bbox: word.bbox,
          }))
        : [],
      groupsAfterReady: Array.from(document.querySelectorAll('[role="treeitem"]')).map(
        (item) => item.textContent ?? "",
      ),
    };
  }, key);
}

async function attachProductDiagnostics(
  testInfo: TestInfo,
  diagnostics: ProductDiagnostics,
): Promise<void> {
  await testInfo.attach("product-pipeline-diagnostics.json", {
    body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
    contentType: "application/json",
  });
}

function assertReadableOriginal(spec: VerificationSpec, source: OcrDocument): void {
  const result = compareFixture(spec, source, source);
  expect(
    result.status,
    `OCR del original debe leer todos los objetivos y vecinos: ${JSON.stringify(result)}`,
  ).not.toBe("INCONCLUSO");
}

async function attachEvidence(
  testInfo: TestInfo,
  fixture: ExportFixture,
  sourceBytes: Uint8Array,
  outputBytes: Uint8Array,
  sourceAudit: OcrAudit,
  outputAudit: OcrAudit,
  result: VerificationResult,
  path: VerificationSpec["path"],
  settings:
    | GeometryExportOptions
    | {
        readonly mode: "redact";
        readonly dpi: 150;
        readonly imageFormat: "jpeg";
        readonly jpegQuality: 0.85;
      },
): Promise<void> {
  const attachments = testInfo.outputPath("evidence");
  await mkdir(attachments, { recursive: true });
  const sourcePath = resolve(attachments, `${fixture.id}-source.pdf`);
  const outputPath = resolve(attachments, `${fixture.id}-output.pdf`);
  await Promise.all([writeFile(sourcePath, sourceBytes), writeFile(outputPath, outputBytes)]);
  await testInfo.attach(`${fixture.id}-source.pdf`, {
    path: sourcePath,
    contentType: "application/pdf",
  });
  await testInfo.attach(`${fixture.id}-output.pdf`, {
    path: outputPath,
    contentType: "application/pdf",
  });
  for (const [side, audit] of [
    ["source", sourceAudit],
    ["output", outputAudit],
  ] as const) {
    for (const [pageIndex, raster] of audit.rasters.entries()) {
      await testInfo.attach(`${fixture.id}-${side}-page-${pageIndex + 1}.png`, {
        body: raster.png,
        contentType: "image/png",
      });
    }
    await testInfo.attach(`${fixture.id}-${side}-ocr.txt`, {
      body: Buffer.from(audit.textByPage.join("\n\n")),
      contentType: "text/plain",
    });
  }
  const report = {
    result,
    fixture: fixtureDescriptor(fixture),
    rules: verificationSpec(fixture, path),
    source: {
      sha256: sha256(sourceBytes),
      sizeBytes: sourceBytes.byteLength,
      pages: sourceAudit.document.pages,
    },
    output: {
      sha256: sha256(outputBytes),
      sizeBytes: outputBytes.byteLength,
      pages: outputAudit.document.pages,
    },
    dpi: settings.dpi,
    format: settings.imageFormat,
    jpegQuality: settings.jpegQuality,
    mode: settings.mode,
    packageVersions: outputAudit.versions,
    assetHashes: outputAudit.assetHashes,
  };
  await testInfo.attach(`${fixture.id}-verification.json`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
}

async function attachSourceEvidence(
  testInfo: TestInfo,
  fixture: ExportFixture,
  sourceAudit: OcrAudit,
  path: VerificationSpec["path"],
): Promise<void> {
  const sourcePath = testInfo.outputPath("evidence/source.pdf");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, fixture.bytes);
  await testInfo.attach("source.pdf", { path: sourcePath, contentType: "application/pdf" });
  for (const [pageIndex, raster] of sourceAudit.rasters.entries()) {
    await testInfo.attach(`source-page-${pageIndex + 1}.png`, {
      body: raster.png,
      contentType: "image/png",
    });
  }
  await testInfo.attach("source-ocr.txt", {
    body: Buffer.from(sourceAudit.textByPage.join("\n\n")),
    contentType: "text/plain",
  });
  await testInfo.attach("source-audit.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          fixture: fixtureDescriptor(fixture),
          rules: verificationSpec(fixture, path),
          sha256: sha256(fixture.bytes),
          sizeBytes: fixture.bytes.byteLength,
          pages: sourceAudit.document.pages,
          textLayerTextByPage: fixture.textLayerTextByPage,
          packageVersions: sourceAudit.versions,
          assetHashes: sourceAudit.assetHashes,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
}

async function auditAndAssert(
  page: Page,
  testInfo: TestInfo,
  fixture: ExportFixture,
  sourceAudit: OcrAudit,
  outputBytes: Uint8Array,
  mode: GeometryExportOptions["mode"],
  dpi: number,
  imageFormat: GeometryExportOptions["imageFormat"],
  jpegQuality: number,
  path: VerificationSpec["path"],
): Promise<void> {
  const outputPath = testInfo.outputPath("evidence/output-under-test.pdf");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, outputBytes);
  await testInfo.attach("output-under-test.pdf", {
    path: outputPath,
    contentType: "application/pdf",
  });
  let outputAudit: OcrAudit;
  try {
    outputAudit = await auditPdfWithIndependentOcr(page, outputBytes, fixture.rotations);
  } catch (error: unknown) {
    await testInfo.attach("output-audit-error.json", {
      body: Buffer.from(
        JSON.stringify(
          {
            fixture: fixture.id,
            path,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    throw error;
  }
  const spec = verificationSpec(fixture, path);
  const result = compareFixture(spec, sourceAudit.document, outputAudit.document);
  await attachEvidence(
    testInfo,
    fixture,
    fixture.bytes,
    outputBytes,
    sourceAudit,
    outputAudit,
    result,
    path,
    { mode, dpi, imageFormat, jpegQuality },
  );
  expect(
    Object.values(outputAudit.assetHashes.productBrowser).every((entry) => entry.matches),
    `los hashes de assets OCR del producto deben coincidir con assets.lock.json: ${JSON.stringify(outputAudit.assetHashes.productBrowser)}`,
  ).toBe(true);
  expect(
    outputAudit.assetHashes.verifier.language.matches,
    `el modelo spa ejecutado debe coincidir con assets.lock.json: ${JSON.stringify(outputAudit.assetHashes.verifier.language)}`,
  ).toBe(true);
  expect(result.status, `verificación independiente: ${JSON.stringify(result)}`).toBe("CUMPLE");
}

async function saveAndReload(testInfo: TestInfo, name: string, bytes: Uint8Array): Promise<Buffer> {
  const path = testInfo.outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return readFile(path);
}

for (const row of GEOMETRY_CASES) {
  test(`ADR-148 ${row.label}`, async ({ page }, testInfo) => {
    await installSettingsOverride(page, {
      nerEnabled: false,
      ocrLanguages: ["spa"],
      performancePreset: "medium",
    });
    await openApp(page, "networkidle");
    const fixture = await buildExportFixture(row.fixtureId, page);
    const sourceAudit = await auditPdfWithIndependentOcr(page, fixture.bytes, fixture.rotations);
    await attachSourceEvidence(testInfo, fixture, sourceAudit, "geometry");
    assertFixtureRules(fixture);
    assertReadableOriginal(verificationSpec(fixture, "geometry"), sourceAudit.document);
    const produced = await exportThroughRealEngines(page, fixture, row);
    const output = await saveAndReload(testInfo, "geometry-output.pdf", produced);
    await auditAndAssert(
      page,
      testInfo,
      fixture,
      sourceAudit,
      output,
      row.mode,
      row.dpi,
      row.imageFormat,
      row.jpegQuality,
      "geometry",
    );
  });
}

const END_TO_END_CASES: ReadonlyArray<{
  readonly fixtureId: ExportFixtureId;
  readonly label: string;
}> = [
  { fixtureId: "native", label: "native E2E redact JPEG 150 DPI" },
  { fixtureId: "scan", label: "scan E2E redact JPEG 150 DPI" },
  { fixtureId: "mixed", label: "mixed E2E redact JPEG 150 DPI" },
  { fixtureId: "stamp", label: "stamp E2E redact JPEG 150 DPI" },
];

for (const row of END_TO_END_CASES) {
  test(`ADR-148 ${row.label}`, async ({ page, electronApp }, testInfo) => {
    await installSettingsOverride(page, {
      nerEnabled: false,
      ocrLanguages: ["spa"],
      performancePreset: "medium",
    });
    await openApp(page, "networkidle");
    const fixture = await buildExportFixture(row.fixtureId, page);
    const sourceAudit = await auditPdfWithIndependentOcr(page, fixture.bytes, fixture.rotations);
    await attachSourceEvidence(testInfo, fixture, sourceAudit, "e2e");
    assertFixtureRules(fixture);
    if (fixture.id === "mixed") {
      await testInfo.attach("mixed-source-text-layer.json", {
        body: Buffer.from(JSON.stringify({ textByPage: fixture.textLayerTextByPage }, null, 2)),
        contentType: "application/json",
      });
      assertMixedFixtureTextLayer(fixture);
    }
    assertReadableOriginal(verificationSpec(fixture, "e2e"), sourceAudit.document);
    const diagnosticsKey = `__adr148Diagnostics${fixture.id}`;
    try {
      await installProductDiagnostics(page, diagnosticsKey);
      await page.locator('input[type="file"]').setInputFiles({
        name: `${fixture.id}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(fixture.bytes),
      });
      try {
        await expect
          .poll(
            () =>
              page.evaluate((key) => {
                const value = (globalThis as typeof globalThis & Record<string, unknown>)[key];
                return (
                  typeof value === "object" &&
                  value !== null &&
                  "pipelineReady" in value &&
                  value.pipelineReady !== undefined
                );
              }, diagnosticsKey),
            { timeout: 240_000 },
          )
          .toBe(true);
      } catch (error: unknown) {
        await attachProductDiagnostics(
          testInfo,
          await collectProductDiagnostics(page, diagnosticsKey),
        );
        throw error;
      }
      const readyDiagnostics = await collectProductDiagnostics(page, diagnosticsKey);
      await attachProductDiagnostics(testInfo, readyDiagnostics);
      const targets = fixture.targets.filter((target) => !target.geometryOnly);
      const groups = targets.map((target) => detectedGroup(page, target.value));
      try {
        for (const group of groups) await expect(group).toBeVisible({ timeout: 30_000 });
      } catch (error: unknown) {
        await attachProductDiagnostics(
          testInfo,
          await collectProductDiagnostics(page, diagnosticsKey),
        );
        throw error;
      }
      const productDiagnostics = await collectProductDiagnostics(page, diagnosticsKey);
      await attachProductDiagnostics(testInfo, productDiagnostics);
      if (fixture.id === "scan" || fixture.id === "mixed")
        expect(productDiagnostics.ocrPageFinished.length).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });
      for (const group of groups) {
        const modeButton = group.getByRole("button", { name: /^Modo de reemplazo de / });
        await modeButton.click();
        await page
          .getByRole("group", { name: "Modo de reemplazo" })
          .getByRole("button", { name: /^Tapar con negro/ })
          .click();
        await expect(modeButton).toHaveAccessibleName(/Tapar con negro/);
      }
      await page.getByRole("button", { name: "Exportar" }).click();
      const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
      await dialog.getByRole("button", { name: "Exportar" }).click();
      const download = dialog.getByRole("link", { name: "Descargar" });
      await expect(download).toBeVisible({ timeout: 240_000 });
      const output = await captureDownload(
        electronApp,
        () => download.click(),
        testInfo.outputPath("final.pdf"),
      );
      await auditAndAssert(
        page,
        testInfo,
        fixture,
        sourceAudit,
        output,
        "redact",
        150,
        "jpeg",
        0.85,
        "e2e",
      );
    } finally {
      await removeProductDiagnostics(page, diagnosticsKey);
    }
  });
}

for (const angle of [90, 180, 270] as const) {
  test(`ADR-148 native E2E rechazo /Rotate ${angle}, PDF source, no-export, 288 DPI`, async ({
    page,
    electronApp,
  }) => {
    await installSettingsOverride(page, {
      nerEnabled: false,
      ocrLanguages: ["spa"],
      performancePreset: "medium",
    });
    await openApp(page, "networkidle");
    const fixture = await addPdfRotation(await buildExportFixture("native"), angle);
    let downloadCount = 0;
    try {
      await electronApp.evaluate(({ session }) => {
        const state = globalThis as typeof globalThis & {
          __adr148DownloadCount?: number;
          __adr148DownloadListener?: () => void;
        };
        state.__adr148DownloadCount = 0;
        state.__adr148DownloadListener = () => {
          state.__adr148DownloadCount = (state.__adr148DownloadCount ?? 0) + 1;
        };
        session.defaultSession.on("will-download", state.__adr148DownloadListener);
      });
      await page.evaluate(() => {
        type Core = {
          readonly bus: {
            on(channel: string, event: string, callback: (payload: unknown) => void): () => void;
          };
        };
        const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
        if (core === undefined) throw new Error("__anonlyCore ausente antes de importar.");
        const scope = globalThis as typeof globalThis & {
          __adr148PipelineError?: unknown;
          __adr148PipelineErrorUnlisten?: () => void;
        };
        scope.__adr148PipelineError = undefined;
        scope.__adr148PipelineErrorUnlisten = core.bus.on(
          "pipeline",
          "PIPELINE_FAILED",
          (payload) => {
            scope.__adr148PipelineError = payload;
          },
        );
      });
      await page.locator('input[type="file"]').setInputFiles({
        name: `native-rotate-${angle}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(fixture.bytes),
      });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const event = (
                globalThis as typeof globalThis & {
                  __adr148PipelineError?: { error?: { code?: unknown } };
                }
              ).__adr148PipelineError;
              return typeof event?.error?.code === "string" ? event.error.code : undefined;
            }),
          { timeout: 120_000 },
        )
        .toBe("PDF_PAGE_ROTATED");
      const observedCode = await page.evaluate(() => {
        const event = (
          globalThis as typeof globalThis & {
            __adr148PipelineError?: { error?: { code?: unknown } };
          }
        ).__adr148PipelineError;
        return typeof event?.error?.code === "string" ? event.error.code : undefined;
      });
      expect(observedCode).toBe("PDF_PAGE_ROTATED");
      await expect(page.getByText(/Una de las páginas de este PDF está girada/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Exportar" })).toBeHidden();
      downloadCount = await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & { __adr148DownloadCount?: number };
        return state.__adr148DownloadCount ?? 0;
      });
      expect(downloadCount).toBe(0);
    } finally {
      try {
        await page.evaluate(() => {
          const scope = globalThis as typeof globalThis & {
            __adr148PipelineErrorUnlisten?: () => void;
          };
          scope.__adr148PipelineErrorUnlisten?.();
          delete scope.__adr148PipelineErrorUnlisten;
        });
      } finally {
        downloadCount = await electronApp.evaluate(({ session }) => {
          const state = globalThis as typeof globalThis & {
            __adr148DownloadCount?: number;
            __adr148DownloadListener?: () => void;
          };
          if (state.__adr148DownloadListener !== undefined)
            session.defaultSession.removeListener("will-download", state.__adr148DownloadListener);
          const count = state.__adr148DownloadCount ?? 0;
          delete state.__adr148DownloadCount;
          delete state.__adr148DownloadListener;
          return count;
        });
      }
    }
    expect(downloadCount).toBe(0);
  });

  test(`ADR-148 scan E2E redact JPEG 150 DPI /Rotate ${angle}`, async ({
    page,
    electronApp,
  }, testInfo) => {
    await installSettingsOverride(page, {
      nerEnabled: false,
      ocrLanguages: ["spa"],
      performancePreset: "medium",
    });
    await openApp(page, "networkidle");
    const fixture = await addPdfRotation(await buildExportFixture("scan", page), angle);
    const sourceAudit = await auditPdfWithIndependentOcr(page, fixture.bytes, fixture.rotations);
    await attachSourceEvidence(testInfo, fixture, sourceAudit, "e2e");
    assertFixtureRules(fixture);
    assertReadableOriginal(verificationSpec(fixture, "e2e"), sourceAudit.document);
    const ocrUnlistenKey = "__adr148RotatedOcrUnlisten";
    try {
      await page.evaluate((key) => {
        type Core = {
          readonly bus: { on(channel: string, event: string, callback: () => void): () => void };
        };
        const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
        if (core === undefined) throw new Error("__anonlyCore ausente antes de importar.");
        const scope = globalThis as typeof globalThis & Record<string, unknown>;
        scope.__adr148RotatedOcr = 0;
        scope[key] = core.bus.on("ocr", "OCR_PAGE_FINISHED", () => {
          const current = scope.__adr148RotatedOcr;
          scope.__adr148RotatedOcr = typeof current === "number" ? current + 1 : 1;
        });
      }, ocrUnlistenKey);
      const targets = fixture.targets.filter((item) => !item.geometryOnly);
      if (targets.length === 0) throw new Error("El fixture rotado no tiene objetivos detectados.");
      await page.locator('input[type="file"]').setInputFiles({
        name: `scan-rotate-${angle}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(fixture.bytes),
      });
      const groups = targets.map((target) => detectedGroup(page, target.value));
      for (const group of groups) await expect(group).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });
      for (const group of groups) {
        await group.getByRole("button", { name: /^Modo de reemplazo de / }).click();
        await page
          .getByRole("group", { name: "Modo de reemplazo" })
          .getByRole("button", { name: /^Tapar con negro/ })
          .click();
      }
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (globalThis as typeof globalThis & { __adr148RotatedOcr?: number })
                  .__adr148RotatedOcr,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "Exportar" }).click();
      const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
      await dialog.getByRole("button", { name: "Exportar" }).click();
      const download = dialog.getByRole("link", { name: "Descargar" });
      await expect(download).toBeVisible({ timeout: 240_000 });
      const output = await captureDownload(
        electronApp,
        () => download.click(),
        testInfo.outputPath("final.pdf"),
      );
      await auditAndAssert(
        page,
        testInfo,
        fixture,
        sourceAudit,
        output,
        "redact",
        150,
        "jpeg",
        0.85,
        "e2e",
      );
    } finally {
      await page.evaluate((key) => {
        const scope = globalThis as typeof globalThis & Record<string, unknown>;
        const unlisten = scope[key];
        if (typeof unlisten === "function") unlisten();
        delete scope[key];
        delete scope.__adr148RotatedOcr;
      }, ocrUnlistenKey);
    }
  });
}

test("ADR-148 infrastructure controls PDF final, JPEG/PNG 288 DPI: sensitivity, geometry shift, blank/black loss, missing page, inconclusive OCR", async ({
  page,
}, testInfo) => {
  await installSettingsOverride(page, {
    nerEnabled: false,
    ocrLanguages: ["spa"],
    performancePreset: "medium",
  });
  await openApp(page, "networkidle");
  const fixture = await buildExportFixture("native");
  const spec = verificationSpec(fixture, "geometry");
  const sourceAudit = await auditPdfWithIndependentOcr(page, fixture.bytes, fixture.rotations);
  await attachSourceEvidence(testInfo, fixture, sourceAudit, "geometry");
  assertReadableOriginal(spec, sourceAudit.document);
  const imageOnlyPdf = await PDFDocument.create();
  for (const [index, raster] of sourceAudit.rasters.entries()) {
    const size = fixture.pageSizes[index];
    if (size === undefined) throw new Error(`Falta tamaño para página ${index + 1}.`);
    const image = await imageOnlyPdf.embedPng(raster.png);
    imageOnlyPdf.addPage([size.width, size.height]).drawImage(image, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
  }
  const controlSourceBytes = await imageOnlyPdf.save();
  const controlSourceTextLayer = await extractPdfTextLayer(page, controlSourceBytes);
  expect(controlSourceTextLayer.every((text) => text.trim().length === 0)).toBe(true);
  const controlSourceAudit = await auditPdfWithIndependentOcr(page, controlSourceBytes, [0, 0]);
  await testInfo.attach("controls-source-image-only.pdf", {
    body: Buffer.from(controlSourceBytes),
    contentType: "application/pdf",
  });
  await testInfo.attach("controls-source-text-layer.json", {
    body: Buffer.from(JSON.stringify({ textByPage: controlSourceTextLayer }, null, 2)),
    contentType: "application/json",
  });
  await testInfo.attach("controls-source-ocr.txt", {
    body: Buffer.from(controlSourceAudit.textByPage.join("\n\n")),
    contentType: "text/plain",
  });
  await testInfo.attach("controls-source-audit.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          sha256: sha256(controlSourceBytes),
          pages: controlSourceAudit.document.pages,
          versions: controlSourceAudit.versions,
          assetHashes: controlSourceAudit.assetHashes,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
  assertReadableOriginal(spec, controlSourceAudit.document);
  await testInfo.attach("controls-source.pdf", {
    body: Buffer.from(controlSourceBytes),
    contentType: "application/pdf",
  });
  const controls: Array<{
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly expectedCause: string;
  }> = [];
  controls.push({
    name: "uncensored-copy",
    bytes: controlSourceBytes,
    expectedCause: "fragmento numérico prohibido",
  });
  const shiftedPdf = await PDFDocument.load(controlSourceBytes);
  const firstTarget = fixture.targets[0];
  const shiftedPage = shiftedPdf.getPage(0);
  shiftedPage.drawRectangle({
    x: firstTarget!.rectPdf.x + 80,
    y: firstTarget!.rectPdf.y,
    width: firstTarget!.rectPdf.width,
    height: firstTarget!.rectPdf.height,
    color: rgb(0, 0, 0),
  });
  controls.push({
    name: "shifted-box-80pt",
    bytes: await shiftedPdf.save(),
    expectedCause: "fragmento numérico prohibido",
  });
  for (const [name, color] of [
    ["white-page", rgb(1, 1, 1)],
    ["black-page", rgb(0, 0, 0)],
  ] as const) {
    const pdf = await PDFDocument.load(controlSourceBytes);
    const targetPage = pdf.getPage(0);
    targetPage.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color });
    controls.push({ name, bytes: await pdf.save(), expectedCause: "falta vecino" });
  }
  const missingPdf = await PDFDocument.load(controlSourceBytes);
  missingPdf.removePage(1);
  controls.push({
    name: "missing-second-page",
    bytes: await missingPdf.save(),
    expectedCause: "páginas",
  });

  const observed: Record<string, VerificationResult> = {};
  for (const control of controls) {
    const persistedControl = await saveAndReload(
      testInfo,
      `controls/${control.name}.pdf`,
      control.bytes,
    );
    const outputAudit = await auditPdfWithIndependentOcr(page, persistedControl, fixture.rotations);
    const result = compareFixture(spec, controlSourceAudit.document, outputAudit.document);
    observed[control.name] = result;
    await testInfo.attach(`control-${control.name}.pdf`, {
      path: testInfo.outputPath(`controls/${control.name}.pdf`),
      contentType: "application/pdf",
    });
    for (const [pageIndex, raster] of outputAudit.rasters.entries()) {
      await testInfo.attach(`control-${control.name}-page-${pageIndex + 1}.png`, {
        body: raster.png,
        contentType: "image/png",
      });
    }
    await testInfo.attach(`control-${control.name}-ocr.txt`, {
      body: Buffer.from(outputAudit.textByPage.join("\n\n")),
      contentType: "text/plain",
    });
  }
  const blankPdf = await PDFDocument.create();
  blankPdf.addPage([595, 842]);
  blankPdf.addPage([595, 842]);
  const blankBytes = await blankPdf.save();
  const persistedBlank = await saveAndReload(
    testInfo,
    "controls/original-ocr-empty.pdf",
    blankBytes,
  );
  const blankAudit = await auditPdfWithIndependentOcr(page, persistedBlank, [0, 0]);
  const inconclusive = compareFixture(spec, blankAudit.document, controlSourceAudit.document);
  await testInfo.attach("control-original-ocr-empty.pdf", {
    path: testInfo.outputPath("controls/original-ocr-empty.pdf"),
    contentType: "application/pdf",
  });
  await testInfo.attach("control-original-ocr-empty.txt", {
    body: Buffer.from(blankAudit.textByPage.join("\n\n")),
    contentType: "text/plain",
  });
  const report = {
    results: observed,
    inconclusiveOriginal: inconclusive,
    fixture: spec,
    source: {
      sha256: sha256(controlSourceBytes),
      sizeBytes: controlSourceBytes.byteLength,
      pages: controlSourceAudit.document.pages,
    },
    blankSource: {
      sha256: sha256(blankBytes),
      sizeBytes: blankBytes.byteLength,
      pages: blankAudit.document.pages,
    },
    versions: controlSourceAudit.versions,
    assetHashes: controlSourceAudit.assetHashes,
    settings: { dpi: 288, format: "PNG raster + OCR", tesseractMode: "LSTM / auto" },
  };
  await testInfo.attach("control-results.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
  for (const control of controls) {
    const result = observed[control.name];
    expect(result?.status, `${control.name}: ${JSON.stringify(result)}`).toBe("NO CUMPLE");
    if (result?.status === "NO CUMPLE") {
      expect(
        result.reasons.some((reason) => reason.includes(control.expectedCause)),
        `${control.name} debe fallar por su causa esperada: ${JSON.stringify(result.reasons)}`,
      ).toBe(true);
    }
  }
  expect(inconclusive.status).toBe("INCONCLUSO");
  expect(
    Object.values(controlSourceAudit.assetHashes.productBrowser).every((entry) => entry.matches),
  ).toBe(true);
  expect(controlSourceAudit.assetHashes.verifier.language.matches).toBe(true);
});
