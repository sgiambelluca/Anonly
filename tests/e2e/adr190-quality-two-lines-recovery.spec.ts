import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import { convertPdfRectsToRegions, samplePdfRegions } from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

const FIXTURE_DIR = resolve("tests", "fixtures", "adr190");
const DNI = "34.567.891";
const EXPECTED_HASH: Record<90 | 180 | 270, string> = {
  90: "8520a63d65a286990b629d3a1cc5170c90276a27addabfeeadbd632a34b1c616",
  180: "928264cf2d4c2eafc79aa162299d74eab4d6d63d661c5d187c97e3e1ddc10c39",
  270: "e0bd2f2fbc0d887c1494776b90987fdcb89fb5ef3f33b7eca17a47916ee7b1ef",
};

function rotateRect(
  rect: { x0: number; y0: number; x1: number; y1: number },
  angle: 90 | 180 | 270,
) {
  const sourceWidth = 595.28;
  const sourceHeight = 841.89;
  if (angle === 90)
    return {
      pageIndex: 0,
      x0: rect.y0,
      y0: sourceWidth - rect.x1,
      x1: rect.y1,
      y1: sourceWidth - rect.x0,
    };
  if (angle === 180)
    return {
      pageIndex: 0,
      x0: sourceWidth - rect.x1,
      y0: sourceHeight - rect.y1,
      x1: sourceWidth - rect.x0,
      y1: sourceHeight - rect.y0,
    };
  return {
    pageIndex: 0,
    x0: sourceHeight - rect.y1,
    y0: rect.x0,
    x1: sourceHeight - rect.y0,
    y1: rect.x1,
  };
}

test.setTimeout(360_000);

for (const angle of [90, 180, 270] as const) {
  test(`ADR-190 QUALITY exacta: ${angle}° recupera y exporta DNI tapado`, async ({
    page,
    electronApp,
  }) => {
    await installSettingsOverride(page, { nerEnabled: false });
    await openApp(page, "networkidle");
    const pdfPath = resolve(FIXTURE_DIR, `two-lines-300-${angle}.pdf`);
    const pdfBytes = await readFile(pdfPath);
    expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(EXPECTED_HASH[angle]);
    const pdf = await PDFDocument.load(pdfBytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(angle === 180 ? 595.28 : 841.89, 1);
    expect(height).toBeCloseTo(angle === 180 ? 841.89 : 595.28, 1);

    const measure = await PDFDocument.create();
    const font = await measure.embedFont(StandardFonts.Helvetica);
    const originalRect = {
      x0: 54 + font.widthOfTextAtSize("DNI ", 12) - 2,
      y0: 758,
      x1: 54 + font.widthOfTextAtSize(`DNI ${DNI}`, 12) + 2,
      y1: 774,
    };
    const rect = rotateRect(originalRect, angle);
    const regions = await convertPdfRectsToRegions(page, pdfBytes, [rect]);
    const [sourceRegion] = await samplePdfRegions(page, pdfBytes, regions);
    expect(sourceRegion?.darkFraction ?? 0, `${angle}° source DNI pixels`).toBeGreaterThan(0.02);

    await page.locator('input[type="file"]').setInputFiles({
      name: `quality-two-lines-${angle}.pdf`,
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    const exportButton = page.getByRole("button", { name: "Exportar" });
    await expect(exportButton, `${angle}° OCR completes`).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/no se pudo leer/i)).toHaveCount(0);
    const entityGroup = page.getByRole("treeitem", { name: DNI });
    await expect(entityGroup, `${angle}° exact DNI entity`).toBeVisible();
    await entityGroup.getByRole("button", { name: /^Modo de reemplazo de / }).click();
    await page
      .getByRole("group", { name: "Modo de reemplazo" })
      .getByRole("button", { name: /^Tapar con negro/ })
      .click();

    await exportButton.click();
    const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await exportDialog.getByRole("button", { name: "Exportar" }).click();
    await expect(page.getByRole("dialog", { name: "Páginas que no se pudieron leer" })).toHaveCount(
      0,
    );
    const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
    await expect(downloadLink).toBeVisible({ timeout: 180_000 });
    const exported = await captureDownload(
      electronApp,
      async () => downloadLink.click(),
      resolve(".measure", "adr190-e2e", `quality-${angle}-${Date.now()}.pdf`),
    );
    const [exportRegion] = await samplePdfRegions(page, exported, regions);
    expect(exportRegion?.blackFraction ?? 0, `${angle}° exported DNI mask`).toBeGreaterThanOrEqual(
      0.6,
    );
  });
}
