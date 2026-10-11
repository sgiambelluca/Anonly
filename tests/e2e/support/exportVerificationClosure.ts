/** Two additions to ADR-148. Synthetic fixtures only; security reads final PDF. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ElectronApplication, Page, TestInfo } from "@playwright/test";

import { REPLACEMENT_FONT_HEIGHT_RATIO } from "../../../packages/anonymization-core/shared/src/index.js";

import { captureDownload, expect, openApp } from "./electronApp.js";
import { auditPdfWithIndependentOcr, type OcrAudit } from "./exportVerificationOcr.js";
import { verifyExport, type OcrDocument } from "./exportVerificationOracle.js";
import { lineDocumentFile, type LineGeometry } from "./fixtures.js";
import {
  compareShiftedRegion,
  findExactShift,
  installPageImageCapture,
  listPageShots,
  type PixelRect,
} from "./pagePixels.js";
import { rasterizeToScannedPdf, type ScanDegradation } from "./scannedPdf.js";
import { installSettingsOverride } from "./settingsOverride.js";

export type ClosureCase = "line-repaint" | "faint-ink";
export const FAINT_INK_RECIPE: ScanDegradation = {
  recipe: "adr148-faint-ink-v1",
  seed: 148203,
  blurSigmaPx: 1.2,
  blackLevel: 32,
  whiteLevel: 255,
  noiseSigma: 0,
};
const CASES = {
  "line-repaint": {
    value: "38.471.629",
    line: "Consta DNI 38.471.629 PERICIA CONTABLE PUBLICA",
    replacement: "[IDENTIFICADOR PERSONAL 01]",
    neighbors: ["PERICIA", "CONTABLE", "PUBLICA"],
  },
  "faint-ink": {
    value: "56.284.713",
    line: "Acta DNI 56.284.713 INFORME PUBLICO GENERAL",
    replacement: "[DNI-01]",
    neighbors: ["INFORME", "PUBLICO", "GENERAL"],
  },
} as const;
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface ObservedGroup {
  readonly canonicalValue: string;
  readonly replacementValue: string;
  readonly replacementMode: string;
  readonly members: ReadonlyArray<{
    readonly value: string;
    readonly bbox: Box;
    readonly source: string;
  }>;
}
interface ClosureProbe {
  group: ObservedGroup | null;
  parsed: Array<{ pageIndex: number; wordCount: number; requiresOCR: boolean }>;
  ocr: Array<{ pageIndex: number; wordCount: number }>;
  sequence: Array<{
    event: "PAGE_PARSED" | "OCR_PAGE_FINISHED" | "IDENTIFIER_GROUP";
    pageIndex: number;
    count: number;
  }>;
  exportOptions: {
    dpi: number;
    imageFormat: string;
    jpegQuality: number;
    includeMarkerLegend: boolean;
  } | null;
}
declare global {
  var __anonlyClosureProbe: ClosureProbe | undefined;
}

async function installClosureProbe(page: Page, identifier: string): Promise<void> {
  await page.evaluate((expected) => {
    const scope = globalThis as typeof globalThis & {
      __anonlyCore?: {
        bus: { on(channel: string, event: string, callback: (payload: unknown) => void): unknown };
      };
    };
    const core = scope.__anonlyCore;
    if (core === undefined) throw new Error("Closure gate: core unavailable");
    const state: ClosureProbe = {
      group: null,
      parsed: [],
      ocr: [],
      sequence: [],
      exportOptions: null,
    };
    globalThis.__anonlyClosureProbe = state;
    const observe = (payload: unknown): void => {
      if (typeof payload !== "object" || payload === null || !("group" in payload)) return;
      const group = payload.group;
      if (
        typeof group !== "object" ||
        group === null ||
        !("canonicalValue" in group) ||
        typeof group.canonicalValue !== "string" ||
        group.canonicalValue.replace(/[^0-9]/g, "") !== expected ||
        !("replacementValue" in group) ||
        typeof group.replacementValue !== "string" ||
        !("replacementMode" in group) ||
        typeof group.replacementMode !== "string" ||
        !("members" in group) ||
        !Array.isArray(group.members)
      )
        return;
      const members: Array<{ value: string; bbox: Box; source: string }> = [];
      for (const member of group.members) {
        if (
          typeof member !== "object" ||
          member === null ||
          !("value" in member) ||
          typeof member.value !== "string" ||
          !("source" in member) ||
          typeof member.source !== "string" ||
          !("bbox" in member)
        )
          return;
        const bbox = member.bbox;
        if (
          typeof bbox !== "object" ||
          bbox === null ||
          !("x" in bbox) ||
          typeof bbox.x !== "number" ||
          !("y" in bbox) ||
          typeof bbox.y !== "number" ||
          !("width" in bbox) ||
          typeof bbox.width !== "number" ||
          !("height" in bbox) ||
          typeof bbox.height !== "number"
        )
          return;
        members.push({
          value: member.value,
          source: member.source,
          bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        });
      }
      state.group = {
        canonicalValue: group.canonicalValue,
        replacementValue: group.replacementValue,
        replacementMode: group.replacementMode,
        members,
      };
      state.sequence.push({ event: "IDENTIFIER_GROUP", pageIndex: 0, count: members.length });
    };
    core.bus.on("grouping", "ENTITY_GROUP_CREATED", observe);
    core.bus.on("grouping", "ENTITY_GROUP_UPDATED", observe);
    core.bus.on("pdf", "PAGE_PARSED", (payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "pageIndex" in payload &&
        typeof payload.pageIndex === "number" &&
        "wordCount" in payload &&
        typeof payload.wordCount === "number" &&
        "requiresOCR" in payload &&
        typeof payload.requiresOCR === "boolean"
      ) {
        state.parsed.push({
          pageIndex: payload.pageIndex,
          wordCount: payload.wordCount,
          requiresOCR: payload.requiresOCR,
        });
        state.sequence.push({
          event: "PAGE_PARSED",
          pageIndex: payload.pageIndex,
          count: payload.wordCount,
        });
      }
    });
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "pageIndex" in payload &&
        typeof payload.pageIndex === "number" &&
        "wordCount" in payload &&
        typeof payload.wordCount === "number"
      ) {
        state.ocr.push({ pageIndex: payload.pageIndex, wordCount: payload.wordCount });
        state.sequence.push({
          event: "OCR_PAGE_FINISHED",
          pageIndex: payload.pageIndex,
          count: payload.wordCount,
        });
      }
    });
    core.bus.on("ui", "EXPORT_REQUESTED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("options" in payload)) return;
      const options = payload.options;
      if (
        typeof options !== "object" ||
        options === null ||
        !("dpi" in options) ||
        typeof options.dpi !== "number" ||
        !("imageFormat" in options) ||
        typeof options.imageFormat !== "string" ||
        !("jpegQuality" in options) ||
        typeof options.jpegQuality !== "number" ||
        !("includeMarkerLegend" in options) ||
        typeof options.includeMarkerLegend !== "boolean"
      )
        return;
      state.exportOptions = {
        dpi: options.dpi,
        imageFormat: options.imageFormat,
        jpegQuality: options.jpegQuality,
        includeMarkerLegend: options.includeMarkerLegend,
      };
    });
  }, identifier);
}
async function observedGroup(page: Page): Promise<ObservedGroup> {
  const value = await page.evaluate(() => globalThis.__anonlyClosureProbe?.group ?? null);
  if (value === null || value.members.length !== 1)
    throw new Error("Closure gate: expected one detected occurrence");
  return value;
}
function wordsRegion(line: LineGeometry, first: number, last: number): PixelRect {
  const a = line.words[first];
  const b = line.words[last];
  if (a === undefined || b === undefined) throw new Error("Closure fixture incomplete");
  const x = Math.ceil(a.left);
  const right = Math.floor(b.right) - 1;
  const y = Math.floor(842 - (line.baseline + 0.8 * line.size));
  const bottom = Math.ceil(842 - (line.baseline - 0.25 * line.size));
  return { x, y, width: right - x, height: bottom - y };
}
async function shotKey(page: Page, kind: "original" | "anonimizado"): Promise<string> {
  let result = "";
  await expect
    .poll(
      async () => {
        result =
          (await listPageShots(page)).find(
            (shot) =>
              shot.key.startsWith(`Página 1, ${kind}@`) &&
              shot.width === 595 &&
              shot.height === 842,
          )?.key ?? "";
        return result;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  return result;
}
async function assertScaleOnePair(page: Page, originalKey: string, anonymizedKey: string) {
  const shots = await listPageShots(page);
  const original = shots.find((shot) => shot.key === originalKey);
  const anonymized = shots.find((shot) => shot.key === anonymizedKey);
  expect(original, "ADR-210 original render missing").toBeDefined();
  expect(anonymized, "ADR-210 anonymized render missing").toBeDefined();
  expect(original).toMatchObject({ width: 595, height: 842 });
  expect(anonymized).toMatchObject({ width: 595, height: 842 });
  expect({ width: anonymized?.width, height: anonymized?.height }).toEqual({
    width: original?.width,
    height: original?.height,
  });
  return {
    original: { width: original?.width, height: original?.height },
    anonymized: { width: anonymized?.width, height: anonymized?.height },
    scale: 1,
  };
}
async function showView(page: Page, kind: "Original" | "Anonimizado"): Promise<void> {
  await page.getByRole("tab", { name: kind }).click();
  await expect(page.getByRole("tab", { name: kind })).toHaveAttribute("aria-selected", "true");
}
async function mapHighlight(page: Page, word: string, expectedWidth: number) {
  await page.getByRole("searchbox", { name: "Buscar en el documento" }).fill(word);
  const highlight = page
    .locator('[class*="border-warning-strong"][class*="bg-warning/30"]')
    .first();
  await expect
    .poll(
      async () => {
        const box = await highlight.boundingBox();
        return box !== null && Math.abs(box.width - expectedWidth) < 3;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const result = await highlight.boundingBox();
  if (result === null) throw new Error("Closure map highlight missing");
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  return result;
}
async function measurePath(page: Page, line: LineGeometry, kind: ClosureCase) {
  const originalKey = await shotKey(page, "original");
  await showView(page, "Anonimizado");
  const anonymizedKey = await shotKey(page, "anonimizado");
  const renderPair = await assertScaleOnePair(page, originalKey, anonymizedKey);
  await expect
    .poll(
      async () =>
        (await compareShiftedRegion(page, originalKey, anonymizedKey, wordsRegion(line, 2, 2), 0))
          .mismatches,
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  const shift = await findExactShift(
    page,
    originalKey,
    anonymizedKey,
    wordsRegion(line, 4, 5),
    200,
  );
  const first = await compareShiftedRegion(
    page,
    originalKey,
    anonymizedKey,
    wordsRegion(line, 3, 3),
    shift.exactShifts[0] ?? 0,
  );
  expect(shift.exactShifts, JSON.stringify(shift)).toHaveLength(1);
  expect(first.mismatches, JSON.stringify(first)).toBe(0);
  const pixels = shift.exactShifts[0];
  if (pixels === undefined) throw new Error("Closure path inconclusive");
  if (kind === "line-repaint") expect(pixels).toBeGreaterThan(0);
  else expect(pixels).toBe(0);
  let map: { originalX: number; anonymizedX: number; shiftPx: number } | null = null;
  if (kind === "line-repaint") {
    const word = line.words[4];
    if (word === undefined) throw new Error("Closure neighbor missing");
    const canvas = await page.getByRole("img", { name: "Página 1, anonimizado" }).boundingBox();
    if (canvas === null) throw new Error("Closure page missing");
    const cssPerPx = canvas.width / 595;
    const anon = await mapHighlight(page, word.text, (word.right - word.left) * cssPerPx);
    await showView(page, "Original");
    const original = await mapHighlight(page, word.text, (word.right - word.left) * cssPerPx);
    expect(anon.x - original.x).toBeGreaterThan(0);
    expect(Math.abs(anon.x - original.x - pixels * cssPerPx)).toBeLessThan(0.3);
    map = { originalX: original.x, anonymizedX: anon.x, shiftPx: (anon.x - original.x) / cssPerPx };
  }
  return { pixels, shift, first, map, renderPair };
}
async function advances(page: Page, group: ObservedGroup) {
  const bbox = group.members[0]?.bbox;
  if (bbox === undefined) throw new Error("Closure bbox missing");
  return page.evaluate(
    ({ bbox, label, ratio }) => {
      const context = new OffscreenCanvas(1, 1).getContext("2d");
      if (context === null) throw new Error("Closure canvas unavailable");
      const size = Math.max(8, bbox.height * ratio);
      const font = `${size}px monospace, sans-serif`;
      context.font = font;
      return {
        bbox,
        font,
        decisionSizePt: size,
        measuredAdvancePt: context.measureText(label).width,
        availablePt: bbox.width,
      };
    },
    { bbox, label: group.replacementValue, ratio: REPLACEMENT_FONT_HEIGHT_RATIO },
  );
}
async function persistPdf(testInfo: TestInfo, name: string, bytes: Uint8Array): Promise<Buffer> {
  const path = testInfo.outputPath(`${name}.pdf`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await testInfo.attach(`${name}.pdf`, { path, contentType: "application/pdf" });
  return readFile(path);
}
async function attachAudit(testInfo: TestInfo, name: string, audit: OcrAudit): Promise<void> {
  await testInfo.attach(`${name}-ocr.txt`, {
    body: Buffer.from(audit.textByPage.join("\n\n")),
    contentType: "text/plain",
  });
  for (const [pageIndex, raster] of audit.rasters.entries())
    await testInfo.attach(`${name}-${pageIndex + 1}.png`, {
      body: raster.png,
      contentType: "image/png",
    });
}
function compare(kind: ClosureCase, source: OcrDocument, output: OcrDocument) {
  const config = CASES[kind];
  const identifier = config.value.replace(/[^0-9]/g, "");
  return verifyExport({
    id: `closure-${kind}`,
    expectedPageCount: 1,
    source,
    output,
    neighborsByPage: [config.neighbors],
    sourceIdentifiersByPage: [[identifier]],
    forbiddenIdentifiers: [identifier],
  });
}
async function edgeRing(page: Page, source: OcrAudit, output: OcrAudit, bbox: Box) {
  const sourceRaster = source.rasters[0];
  const outputRaster = output.rasters[0];
  if (sourceRaster === undefined || outputRaster === undefined)
    throw new Error("Closure edge rasters missing");
  return page.evaluate(
    async ({ original, final, bbox, pageWidthPt }) => {
      const read = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context === null) throw new Error("Closure ring canvas unavailable");
        context.drawImage(image, 0, 0);
        const scale = canvas.width / pageWidthPt;
        const inner = {
          x0: Math.floor(bbox.x * scale),
          x1: Math.ceil((bbox.x + bbox.width) * scale),
          y0: Math.floor(bbox.y * scale),
          y1: Math.ceil((bbox.y + bbox.height) * scale),
        };
        const padding = Math.ceil(2 * scale);
        const x0 = Math.max(0, inner.x0 - padding);
        const x1 = Math.min(canvas.width, inner.x1 + padding);
        const y0 = Math.max(0, inner.y0 - padding);
        const y1 = Math.min(canvas.height, inner.y1 + padding);
        const pixels: Array<{ x: number; y: number; rgba: number[] }> = [];
        let dark = 0;
        let faint = 0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            if (x >= inner.x0 && x < inner.x1 && y >= inner.y0 && y < inner.y1) continue;
            const rgba = [...context.getImageData(x, y, 1, 1).data];
            const luma = ((rgba[0] ?? 255) + (rgba[1] ?? 255) + (rgba[2] ?? 255)) / 3;
            if (luma < 128) dark++;
            if (luma >= 128 && luma < 250) faint++;
            pixels.push({ x, y, rgba });
          }
        return { scale, paddingPt: 2, inner, pixels, dark, faint };
      };
      return { original: await read(original), exported: await read(final) };
    },
    {
      original: sourceRaster.png.toString("base64"),
      final: outputRaster.png.toString("base64"),
      bbox,
      pageWidthPt: sourceRaster.widthPt,
    },
  );
}

export async function runClosureExportCase(
  page: Page,
  app: ElectronApplication,
  testInfo: TestInfo,
  kind: ClosureCase,
): Promise<void> {
  const config = CASES[kind];
  await installSettingsOverride(page, {
    nerEnabled: false,
    performancePreset: "medium",
    ocrLanguages: ["spa"],
  });
  await installPageImageCapture(page);
  await openApp(page, "networkidle");
  const fixture = await lineDocumentFile(`closure-${kind}.pdf`, [config.line], { size: 12 });
  const line = fixture.lines[0];
  if (line === undefined) throw new Error("Closure fixture missing line");
  const source =
    kind === "faint-ink"
      ? (await rasterizeToScannedPdf(page, fixture.file.buffer, 3, 1, FAINT_INK_RECIPE)).buffer
      : fixture.file.buffer;
  const sourceBytes = await persistPdf(testInfo, "closure-source", source);
  const sourceAudit = await auditPdfWithIndependentOcr(page, sourceBytes, [0]);
  await attachAudit(testInfo, "closure-source", sourceAudit);
  // Integrated discriminating control: same uncensored bytes rejected by the same oracle.
  const controlBytes = await persistPdf(testInfo, "closure-uncensored-control", sourceBytes);
  const controlAudit = await auditPdfWithIndependentOcr(page, controlBytes, [0]);
  await attachAudit(testInfo, "closure-control", controlAudit);
  const control = compare(kind, sourceAudit.document, controlAudit.document);
  await testInfo.attach("closure-control-result.json", {
    body: Buffer.from(JSON.stringify(control, null, 2)),
    contentType: "application/json",
  });
  expect(control.status, `Original OCR is infrastructure: ${JSON.stringify(control)}`).not.toBe(
    "INCONCLUSO",
  );
  expect(control.status, JSON.stringify(control)).toBe("NO CUMPLE");
  if (control.status === "NO CUMPLE")
    expect(control.reasons.some((reason) => reason.includes("fragmento numérico prohibido"))).toBe(
      true,
    );
  await installClosureProbe(page, config.value.replace(/[^0-9]/g, ""));
  await page.locator('input[type="file"]').setInputFiles({
    name: `closure-${kind}.pdf`,
    mimeType: "application/pdf",
    buffer: sourceBytes,
  });
  await expect(page.getByRole("button", { name: "Exportar", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  const row = page.getByRole("treeitem", {
    name: new RegExp(`^${config.value.replaceAll(".", "\\.")}(?:,|$)`),
  });
  await expect(row).toBeVisible({ timeout: 30_000 });
  if (kind === "faint-ink") {
    // DetectionSource is "regex" even for OCR text. The page events establish
    // that detection had no native text and only proceeded after successful OCR.
    const probe = await page.evaluate(() => globalThis.__anonlyClosureProbe);
    expect(probe?.parsed).toEqual([{ pageIndex: 0, wordCount: 0, requiresOCR: true }]);
    expect(probe?.ocr).toHaveLength(1);
    expect(probe?.ocr[0]?.pageIndex).toBe(0);
    expect(probe?.ocr[0]?.wordCount ?? 0).toBeGreaterThan(0);
    const parsedAt =
      probe?.sequence.findIndex(
        (event) => event.event === "PAGE_PARSED" && event.pageIndex === 0 && event.count === 0,
      ) ?? -1;
    const ocrAt =
      probe?.sequence.findIndex(
        (event) => event.event === "OCR_PAGE_FINISHED" && event.pageIndex === 0 && event.count > 0,
      ) ?? -1;
    const groupAt = probe?.sequence.findIndex((event) => event.event === "IDENTIFIER_GROUP") ?? -1;
    expect(parsedAt).toBeGreaterThanOrEqual(0);
    expect(ocrAt).toBeGreaterThan(parsedAt);
    expect(groupAt).toBeGreaterThan(ocrAt);
  }
  await expect(row.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Etiquetar/,
  );
  await row.getByRole("button", { name: "Más acciones" }).click();
  await page
    .getByRole("group", { name: "Acciones del grupo" })
    .getByRole("button", { name: "Editar reemplazo…" })
    .click();
  const edit = page.getByRole("dialog", { name: "Editar reemplazo" });
  await edit.getByRole("textbox", { name: "Texto de reemplazo" }).fill(config.replacement);
  await edit.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect
    .poll(async () => (await observedGroup(page)).replacementValue, { timeout: 15_000 })
    .toBe(config.replacement);
  const group = await observedGroup(page);
  const importProbe = await page.evaluate(() => ({
    parsed: globalThis.__anonlyClosureProbe?.parsed,
    ocr: globalThis.__anonlyClosureProbe?.ocr,
    sequence: globalThis.__anonlyClosureProbe?.sequence,
  }));
  const measured = await advances(page, group);
  const path = await measurePath(page, line, kind);
  await testInfo.attach("closure-layout.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          kind,
          line,
          group,
          importProbe,
          measured,
          path,
          recipe: kind === "faint-ink" ? FAINT_INK_RECIPE : null,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
  if (kind === "line-repaint")
    expect(measured.measuredAdvancePt).toBeGreaterThan(measured.availablePt);
  else expect(measured.measuredAdvancePt).toBeLessThanOrEqual(measured.availablePt);
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await dialog.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = dialog.getByRole("link", { name: "Descargar" });
  await expect(download).toBeVisible({ timeout: 240_000 });
  const produced = await captureDownload(
    app,
    () => download.click(),
    testInfo.outputPath("closure-final-download.pdf"),
  );
  const finalBytes = await persistPdf(testInfo, "closure-final", produced);
  const finalAudit = await auditPdfWithIndependentOcr(page, finalBytes, [0]);
  await attachAudit(testInfo, "closure-final", finalAudit);
  const exportOptions = await page.evaluate(
    () => globalThis.__anonlyClosureProbe?.exportOptions ?? null,
  );
  expect(exportOptions).toEqual({
    dpi: 150,
    imageFormat: "jpeg",
    jpegQuality: 0.92,
    includeMarkerLegend: false,
  });
  const result = compare(kind, sourceAudit.document, finalAudit.document);
  const ring =
    kind === "faint-ink" ? await edgeRing(page, sourceAudit, finalAudit, measured.bbox) : null;
  await testInfo.attach("closure-final-verification.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          result,
          control,
          sourcePages: sourceAudit.document.pages,
          finalPages: finalAudit.document.pages,
          group,
          importProbe,
          measured,
          path,
          ring,
          recipe: kind === "faint-ink" ? FAINT_INK_RECIPE : null,
          settings: { ...exportOptions, replacement: config.replacement },
          versions: finalAudit.versions,
          assetHashes: finalAudit.assetHashes,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
  expect(Object.values(finalAudit.assetHashes.productBrowser).every((entry) => entry.matches)).toBe(
    true,
  );
  expect(finalAudit.assetHashes.verifier.language.matches).toBe(true);
  expect(result.status, JSON.stringify(result)).toBe("CUMPLE");
}
