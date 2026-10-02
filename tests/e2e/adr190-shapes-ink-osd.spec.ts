import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import { convertPdfRectsToRegions, samplePdfRegionsAt144Dpi } from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

const FIXTURE_DIR = resolve("tests", "fixtures", "adr190");
const SHAPES_HASH: Record<150 | 200 | 250 | 300, string> = {
  150: "7ce03f3ba456a4cdb11260fa79b16064d2a2bc3fa894bd0d7e0b07d79a8f8d01",
  200: "3b7c422712fd4e3c655cf930ee8bbd7bffb2df5f0663cad6fcb8bfff52255d0c",
  250: "0a3e2592d6cc4ee9b0cd113977da3bff03e7f84bfc958720e6730d16361778be",
  300: "f003a4b1a388c4e2b72a5c5a94d66a62c9e524c5d1debb36b828071d4c3751b7",
};
const WARNING =
  "Esta página tiene contenido que no se pudo leer. Revisala: si tiene datos sensibles, no se van a tapar solos.";

test.setTimeout(240_000);

for (const dpi of [150, 200, 250, 300] as const) {
  test(`ADR-190: OSD ausente y tinta shapes a ${dpi} DPI avisa sin palabras fiables`, async ({
    page,
    electronApp,
  }) => {
    await installSettingsOverride(page, { nerEnabled: false });
    await openApp(page, "networkidle");
    const fixture = await readFile(resolve(FIXTURE_DIR, `shapes-${dpi}-0.pdf`));
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(SHAPES_HASH[dpi]);
    const sourceDoc = await PDFDocument.load(fixture);
    const { width, height } = sourceDoc.getPage(0).getSize();
    const wholePage = await convertPdfRectsToRegions(page, fixture, [
      { pageIndex: 0, x0: 2, y0: 2, x1: width - 2, y1: height - 2 },
    ]);

    await page.evaluate(() => {
      const scope = window as unknown as {
        __anonlyCore?: {
          bus: { on(channel: string, event: string, cb: (payload: unknown) => void): void };
          engines: {
            ocr: { ctx?: { cache?: { get<T>(key: string): T | undefined } } };
          };
        };
      };
      const core = scope.__anonlyCore;
      if (!core) throw new Error("__anonlyCore ausente");
      core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
        if (typeof payload !== "object" || payload === null) return;
        const event = payload as {
          documentId?: unknown;
          pageIndex?: unknown;
          unreadableInk?: unknown;
        };
        if (typeof event.documentId !== "string" || typeof event.pageIndex !== "number") return;
        const words = core.engines.ocr.ctx?.cache?.get<Array<{ text: string; confidence: number }>>(
          `ocr-words:${event.documentId}:${event.pageIndex}`,
        );
        const target = globalThis as typeof globalThis & {
          __adr190ShapesOutput?: { unreadableInk: unknown; cacheHit: boolean; words: unknown };
        };
        target.__adr190ShapesOutput = {
          unreadableInk: event.unreadableInk,
          cacheHit: words !== undefined,
          words: words ?? [],
        };
      });
    });

    await page.locator('input[type="file"]').setInputFiles({
      name: `shapes-${dpi}-0.pdf`,
      mimeType: "application/pdf",
      buffer: fixture,
    });
    await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(WARNING)).toBeVisible();
    await expect(
      page.getByRole("complementary").getByText("Todavía no hay datos detectados"),
    ).toBeVisible();
    await page.waitForFunction(
      () =>
        (
          globalThis as typeof globalThis & {
            __adr190ShapesOutput?: unknown;
          }
        ).__adr190ShapesOutput !== undefined,
    );
    const observed = await page.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __adr190ShapesOutput?: { unreadableInk: unknown; cacheHit: boolean; words: unknown };
      };
      return target.__adr190ShapesOutput;
    });
    expect(observed?.unreadableInk).toBe(true);
    expect(observed?.cacheHit).toBe(true);
    expect(
      (observed?.words as Array<{ confidence: number }> | undefined)?.some(
        (word) => word.confidence >= 0.6,
      ),
    ).toBe(false);

    const exportButton = page.getByRole("button", { name: "Exportar" });
    await exportButton.click();
    const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await exportDialog.getByRole("button", { name: "Exportar" }).click();
    const noGroups = page.getByRole("dialog", { name: "Exportar sin nada anonimizado" });
    await expect(noGroups).toBeVisible();
    await noGroups.getByRole("button", { name: "Continuar" }).click();
    const unreadableDialog = page.getByRole("dialog", { name: "Páginas que no se pudieron leer" });
    await expect(unreadableDialog).toBeVisible();
    await expect(unreadableDialog.getByText("Página 1")).toBeVisible();
    await expect(
      unreadableDialog.getByRole("checkbox", { name: "Tapar página entera" }),
    ).toBeChecked();
    await unreadableDialog.getByRole("button", { name: "Exportar" }).click();
    const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
    await expect(downloadLink).toBeVisible({ timeout: 180_000 });
    const exported = await captureDownload(
      electronApp,
      async () => downloadLink.click(),
      resolve(".measure", "adr190-e2e", `shapes-${dpi}-unreadable-${Date.now()}.pdf`),
    );
    const [coveredPage] = await samplePdfRegionsAt144Dpi(page, exported, wholePage);
    expect(
      coveredPage?.blackFraction ?? 0,
      `${dpi} DPI export covers the page`,
    ).toBeGreaterThanOrEqual(0.95);
  });
}
