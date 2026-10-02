/** Aceptación funcional opt-in de T-5: OCR real sobre PNGs físicamente
 * girados, seguido del flujo real de censura y exportación. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import { t5PixelOrientationGroundTruth, t5PixelOrientationSourceFile } from "./support/fixtures.js";
import {
  rasterizePixelRotationsToScannedPdf,
  samplePdfRegions,
  samplePdfRegionsAt144Dpi,
  type PdfRegionStats,
} from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.skip(
  process.env.ANONLY_T5_E2E !== "1",
  "El E2E de aceptación T-5 requiere ANONLY_T5_E2E=1 y assets first-party.",
);
test.setTimeout(360_000);

function compareExternalInk(
  source: PdfRegionStats,
  candidate: PdfRegionStats,
): { readonly precision: number; readonly recall: number; readonly accepted: boolean } {
  if (candidate.widthPx !== source.widthPx || candidate.heightPx !== source.heightPx)
    throw new Error("Dimensiones de recorte distintas.");
  const sourceInk = source.inkMask;
  const candidateInk = candidate.inkMask;
  const neighbors = (index: number, width: number, height: number): ReadonlyArray<number> => {
    const x = index % width;
    const y = Math.floor(index / width);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) result.push(ny * width + nx);
      }
    return result;
  };
  const sourceCount = sourceInk.filter(Boolean).length;
  const candidateCount = candidateInk.filter(Boolean).length;
  if (sourceCount === 0) throw new Error("Denominador de tinta fuente cero.");
  if (candidateCount === 0) return { precision: 0, recall: 0, accepted: false };
  const recall =
    sourceInk.reduce(
      (sum, ink, index) =>
        sum +
        (ink && neighbors(index, source.widthPx, source.heightPx).some((n) => candidateInk[n])
          ? 1
          : 0),
      0,
    ) / sourceCount;
  const precision =
    candidateInk.reduce(
      (sum, ink, index) =>
        sum +
        (ink && neighbors(index, source.widthPx, source.heightPx).some((n) => sourceInk[n])
          ? 1
          : 0),
      0,
    ) / candidateCount;
  return { precision, recall, accepted: recall >= 0.95 && precision >= 0.95 };
}

function assertExternalInkPreserved(source: PdfRegionStats, candidate: PdfRegionStats): void {
  const metrics = compareExternalInk(source, candidate);
  expect(metrics.accepted).toBe(true);
}

test("T-5 reconoce giros de píxeles intercalados y exporta la censura", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false, ocrLanguages: ["spa"] });
  await openApp(page, "networkidle");
  const observedPages = new Map<
    number,
    ReadonlyArray<{
      readonly text: string;
      readonly bbox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly rotation?: number;
      };
    }>
  >();
  const observedEntities: Array<{
    readonly normalizedValue: string;
    readonly pageIndex: number;
    readonly entityType: string;
  }> = [];
  await page.evaluate(() => {
    const scope = window as unknown as {
      readonly __anonlyCore?: {
        readonly bus: {
          on: (channel: string, event: string, listener: (payload: unknown) => void) => void;
        };
        readonly engines: {
          readonly ocr: {
            readonly ctx?: { readonly cache?: { get: <T>(key: string) => T | undefined } };
          };
        };
      };
    };
    const core = scope.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente");
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const value = payload as { readonly documentId?: unknown; readonly pageIndex?: unknown };
      if (typeof value.documentId !== "string" || typeof value.pageIndex !== "number") return;
      const words = core.engines.ocr.ctx?.cache?.get(
        `ocr-words:${value.documentId}:${value.pageIndex}`,
      );
      const target = globalThis as typeof globalThis & {
        __t5OrientationWords?: Record<number, unknown>;
        __t5OrientationFinished?: number;
      };
      (target.__t5OrientationWords ??= {})[value.pageIndex] = words ?? [];
      target.__t5OrientationFinished = (target.__t5OrientationFinished ?? 0) + 1;
    });
    core.bus.on("ocr", "OCR_PAGE_FAILED", (payload: unknown) => {
      const target = globalThis as typeof globalThis & { __t5OrientationFailures?: unknown[] };
      (target.__t5OrientationFailures ??= []).push(payload);
    });
    core.bus.on("regex", "ENTITY_FOUND", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const value = payload as {
        readonly occurrence?: {
          readonly normalizedValue?: unknown;
          readonly pageIndex?: unknown;
          readonly entityType?: unknown;
        };
      };
      const occurrence = value.occurrence;
      if (
        occurrence === undefined ||
        typeof occurrence.normalizedValue !== "string" ||
        typeof occurrence.pageIndex !== "number" ||
        typeof occurrence.entityType !== "string"
      )
        return;
      const target = globalThis as typeof globalThis & {
        __t5OrientationEntities?: Array<{
          readonly normalizedValue: string;
          readonly pageIndex: number;
          readonly entityType: string;
        }>;
      };
      (target.__t5OrientationEntities ??= []).push({
        normalizedValue: occurrence.normalizedValue,
        pageIndex: occurrence.pageIndex,
        entityType: occurrence.entityType,
      });
    });
  });

  const source = await t5PixelOrientationSourceFile();
  const file = await rasterizePixelRotationsToScannedPdf(page, source.buffer, [0, 90, 180, 0, 270]);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 240_000 });

  const observed = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __t5OrientationWords?: Record<number, unknown>;
      __t5OrientationFinished?: number;
    };
    return {
      words: target.__t5OrientationWords ?? {},
      finished: target.__t5OrientationFinished ?? 0,
    };
  });
  const failures = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { __t5OrientationFailures?: unknown[] };
    return target.__t5OrientationFailures ?? [];
  });
  const entities = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __t5OrientationEntities?: Array<{
        readonly normalizedValue: string;
        readonly pageIndex: number;
        readonly entityType: string;
      }>;
    };
    return target.__t5OrientationEntities ?? [];
  });
  observedEntities.push(...entities);
  expect(failures, `fallos OCR: ${JSON.stringify(failures)}`).toEqual([]);
  const groundTruth = await t5PixelOrientationGroundTruth();
  for (const expected of groundTruth) {
    const pageIndex = expected.pageIndex;
    const words = observed.words[pageIndex];
    expect(
      Array.isArray(words),
      `faltan palabras OCR para la página ${pageIndex}; observado ${JSON.stringify(observed)}`,
    ).toBe(true);
    const text = (words as ReadonlyArray<{ readonly text: string }>)
      .map((word) => word.text)
      .join(" ");
    expect(text).toContain(
      expected.expectedText.slice(0, expected.expectedText.indexOf(" Nombre")),
    );
    expect(text).toContain(`Pagina sintetica ${pageIndex + 1}`);
    expect((words as ReadonlyArray<unknown>).length).toBeGreaterThan(0);
    expect(
      (words as ReadonlyArray<{ readonly text: string }>).some((word) => word.text.length > 1),
      `OCR sin texto útil en página ${pageIndex}: ${JSON.stringify(words)}`,
    ).toBe(true);
  }
  for (const expected of groundTruth) {
    const words = observed.words[expected.pageIndex] as ReadonlyArray<{
      readonly bbox: { readonly rotation?: number };
    }>;
    expect(
      words.some((word) => (word.bbox.rotation ?? 0) === expected.expectedOcrRotation),
      `ángulo inesperado en página ${expected.pageIndex}: ${JSON.stringify(words)}`,
    ).toBe(true);
  }
  const normalizedEntities = [
    ...new Set(observedEntities.map((entity) => entity.normalizedValue)),
  ].sort();
  const expectedEntities = [
    ...new Set(groundTruth.flatMap((expected) => expected.expectedEntities)),
  ].sort();
  expect(normalizedEntities).toEqual(expectedEntities);
  const occurrenceKey = (entity: {
    readonly normalizedValue: string;
    readonly pageIndex: number;
    readonly entityType: string;
  }): string => `${entity.pageIndex}/${entity.entityType}/${entity.normalizedValue}`;
  const expectedOccurrenceKeys = [
    ...new Set(
      groundTruth.flatMap((expected) =>
        expected.expectedEntities.map(
          (normalizedValue) => `${expected.pageIndex}/DNI/${normalizedValue}`,
        ),
      ),
    ),
  ].sort();
  expect([...new Set(observedEntities.map(occurrenceKey))].sort()).toEqual(expectedOccurrenceKeys);

  const sensitiveRegions = groundTruth.flatMap((expected) =>
    expected.sensitiveRegions.map((rect) => ({ pageIndex: expected.pageIndex, ...rect })),
  );
  const externalRegions = groundTruth.map((expected) => ({
    pageIndex: expected.pageIndex,
    ...expected.externalRegion,
  }));
  const sourceSensitive = await samplePdfRegions(page, file.buffer, sensitiveRegions);
  const sourceExternal = await samplePdfRegions(page, file.buffer, externalRegions);
  expect(sourceSensitive.every((region) => region.darkFraction > 0.02)).toBe(true);
  expect(sourceExternal.every((region) => region.darkFraction > 0.01)).toBe(true);

  const finishedBeforeReanalysis = observed.finished;
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __t5OrientationWords?: Record<number, unknown>;
      __t5OrientationEntities?: Array<{
        readonly normalizedValue: string;
        readonly pageIndex: number;
        readonly entityType: string;
      }>;
      __t5OrientationFailures?: unknown[];
    };
    // Cada sesión tiene su propia colección: evita que datos de la generación
    // previa satisfagan por accidente la aceptación de la siguiente.
    target.__t5OrientationWords = {};
    target.__t5OrientationEntities = [];
    target.__t5OrientationFailures = [];
  });
  await page.getByRole("button", { name: "Configuración" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("checkbox", { name: "Inglés" }).click();
  await settingsDialog.getByRole("button", { name: "Guardar" }).click();
  const reanalyzeDialog = page.getByRole("dialog", { name: "Reanalizar documento" });
  await expect(reanalyzeDialog).toBeVisible();
  await reanalyzeDialog.getByRole("button", { name: "Reanalizar" }).click();
  await expect(reanalyzeDialog).toHaveCount(0, { timeout: 300_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const target = globalThis as typeof globalThis & {
            __t5OrientationFinished?: number;
          };
          return target.__t5OrientationFinished ?? 0;
        }),
      { timeout: 300_000 },
    )
    .toBeGreaterThan(finishedBeforeReanalysis);
  const reanalyzed = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __t5OrientationWords?: Record<number, unknown>;
      __t5OrientationFinished?: number;
    };
    return {
      words: target.__t5OrientationWords ?? {},
      finished: target.__t5OrientationFinished ?? 0,
    };
  });
  expect(reanalyzed.finished).toBeGreaterThan(finishedBeforeReanalysis);
  expect(Object.keys(reanalyzed.words)).toHaveLength(5);
  for (const pageIndex of [0, 1, 2, 3, 4]) {
    const beforeWords = observed.words[pageIndex] as ReadonlyArray<{
      readonly text: string;
      readonly source: string;
      readonly pageIndex: number;
      readonly confidence: number;
      readonly bbox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly rotation?: number;
      };
    }>;
    const afterWords = reanalyzed.words[pageIndex] as ReadonlyArray<(typeof beforeWords)[number]>;
    expect(
      afterWords.map(({ text, source, pageIndex: index, bbox }) => ({
        text,
        source,
        pageIndex: index,
        bbox,
      })),
    ).toEqual(
      beforeWords.map(({ text, source, pageIndex: index, bbox }) => ({
        text,
        source,
        pageIndex: index,
        bbox,
      })),
    );
    expect(
      afterWords.every(
        ({ confidence }) => Number.isFinite(confidence) && confidence >= 0 && confidence <= 1,
      ),
    ).toBe(true);
  }
  for (const expected of groundTruth) {
    const words = reanalyzed.words[expected.pageIndex] as ReadonlyArray<{
      readonly text: string;
      readonly bbox: { readonly rotation?: number };
    }>;
    const text = words.map((word) => word.text).join(" ");
    expect(text).toContain(
      expected.expectedText.slice(0, expected.expectedText.indexOf(" Nombre")),
    );
    expect(
      words.some((word) => (word.bbox.rotation ?? 0) === expected.expectedOcrRotation),
      `ángulo inesperado tras reanálisis en página ${expected.pageIndex}`,
    ).toBe(true);
  }
  const reanalyzedEntities = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __t5OrientationEntities?: Array<{
        readonly normalizedValue: string;
        readonly pageIndex: number;
        readonly entityType: string;
      }>;
    };
    return target.__t5OrientationEntities ?? [];
  });
  expect([...new Set(reanalyzedEntities.map(occurrenceKey))].sort()).toEqual(
    expectedOccurrenceKeys,
  );
  expect(new Set(reanalyzedEntities.map((entity) => entity.pageIndex))).toEqual(
    new Set([0, 1, 2, 3, 4]),
  );
  const postReanalysisFailures = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { __t5OrientationFailures?: unknown[] };
    return target.__t5OrientationFailures ?? [];
  });
  expect(postReanalysisFailures).toEqual([]);

  const expectedEntityValues = [
    ...new Set(groundTruth.map((expected) => expected.expectedEntityValue)),
  ];
  for (const entityValue of expectedEntityValues) {
    const entityGroup = page.getByRole("treeitem", { name: entityValue });
    const replacementModeSelect = entityGroup.getByRole("button", {
      name: /^Modo de reemplazo de /,
    });
    await replacementModeSelect.click();
    await page
      .getByRole("group", { name: "Modo de reemplazo" })
      .getByRole("button", { name: /^Tapar con negro/ })
      .click();
    await expect(replacementModeSelect).toHaveAccessibleName(/Tapar con negro/);
  }

  await page.getByRole("button", { name: "Exportar" }).click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await dialog.getByRole("button", { name: "Exportar" }).click();
  const downloadLink = dialog.getByRole("link", { name: "Descargar" });
  await expect(downloadLink).toBeVisible({ timeout: 300_000 });
  const outputDir = resolve(".measure", "t5-e2e", `orientation-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const exportedPdf = await captureDownload(
    electronApp,
    async () => downloadLink.click(),
    resolve(outputDir, "anonymizado.pdf"),
  );
  const exportedSensitive = await samplePdfRegions(page, exportedPdf, sensitiveRegions);
  const exportedExternal = await samplePdfRegions(page, exportedPdf, externalRegions);
  expect(
    exportedSensitive.every((region) => region.blackFraction >= 0.6),
    `regiones sensibles sin cobertura negra: ${JSON.stringify(exportedSensitive)}`,
  ).toBe(true);
  const sourceExternal144 = await samplePdfRegionsAt144Dpi(page, file.buffer, externalRegions);
  const exportedExternal144 = await samplePdfRegionsAt144Dpi(page, exportedPdf, externalRegions);
  const blackExternal144 = await samplePdfRegionsAt144Dpi(
    page,
    file.buffer,
    externalRegions,
    "black",
  );
  const whiteExternal144 = await samplePdfRegionsAt144Dpi(
    page,
    file.buffer,
    externalRegions,
    "white",
  );
  expect(sourceExternal144).toHaveLength(5);
  expect(exportedExternal144).toHaveLength(5);
  expect(blackExternal144).toHaveLength(5);
  expect(whiteExternal144).toHaveLength(5);
  const externalMetrics: Array<Record<string, unknown>> = [];
  for (const [index, sourceRegion] of sourceExternal144.entries()) {
    const candidate = exportedExternal144[index];
    const black = blackExternal144[index];
    const white = whiteExternal144[index];
    expect(candidate).toBeDefined();
    expect(black).toBeDefined();
    expect(white).toBeDefined();
    if (candidate === undefined || black === undefined || white === undefined) continue;
    const metrics = compareExternalInk(sourceRegion, candidate);
    expect(candidate.pageWidthPx).toBe(sourceRegion.pageWidthPx);
    expect(candidate.pageHeightPx).toBe(sourceRegion.pageHeightPx);
    const blackMetrics = compareExternalInk(sourceRegion, black);
    const whiteMetrics = compareExternalInk(sourceRegion, white);
    assertExternalInkPreserved(sourceRegion, sourceRegion);
    expect(metrics.accepted).toBe(true);
    expect(blackMetrics.accepted).toBe(false);
    expect(whiteMetrics.accepted).toBe(false);
    externalMetrics.push({
      index,
      pageWidthPx: sourceRegion.pageWidthPx,
      pageHeightPx: sourceRegion.pageHeightPx,
      widthPx: sourceRegion.widthPx,
      heightPx: sourceRegion.heightPx,
      sourceInkPixels: sourceRegion.inkMask.filter(Boolean).length,
      exportedInkPixels: candidate.inkMask.filter(Boolean).length,
      precision: metrics.precision,
      recall: metrics.recall,
      controls: {
        sourceSelf: {
          ...compareExternalInk(sourceRegion, sourceRegion),
          inkPixels: sourceRegion.inkMask.filter(Boolean).length,
        },
        blackOpaque: { ...blackMetrics, inkPixels: black.inkMask.filter(Boolean).length },
        whiteOpaque: { ...whiteMetrics, inkPixels: white.inkMask.filter(Boolean).length },
      },
    });
  }
  await writeFile(
    resolve(outputDir, "external-regions-144dpi.json"),
    JSON.stringify(
      {
        scale: 2,
        dpi: 144,
        regions: externalMetrics,
        controls: { sourceSelf: "pass", blackOpaque: "fail", whiteOpaque: "fail" },
      },
      null,
      2,
    ),
    "utf8",
  );
  for (const [index, region] of exportedExternal.entries()) {
    const sourceRegion = sourceExternal[index];
    expect(region.darkFraction).toBeGreaterThan(0.01);
    expect(sourceRegion).toBeDefined();
    expect(region.darkFraction).toBeGreaterThan((sourceRegion?.darkFraction ?? 0) * 0.2);
  }
  // Control negativo permanente: el antiguo mínimo de tinta aceptaría esta
  // región negra; la comparación de luminancia debe rechazarla.
  for (const [pageIndex, words] of Object.entries(reanalyzed.words)) {
    observedPages.set(
      Number(pageIndex),
      words as ReadonlyArray<{
        readonly text: string;
        readonly bbox: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
          readonly rotation?: number;
        };
      }>,
    );
  }
  expect(observedPages.size).toBe(5);
});
