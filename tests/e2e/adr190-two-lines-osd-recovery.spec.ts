import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  convertPdfRectsToRegions,
  rasterizeToScannedPdf,
  samplePdfRegions,
} from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(360_000);

const PAGE_WIDTH = 280;
const PAGE_HEIGHT = 220;
const FONT_SIZE = 26;
const DNI = "34.567.891";

async function buildTwoLineDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const lines = [
    { text: "Juan Perez", y: 160 },
    { text: `DNI ${DNI}`, y: 110 },
  ];
  for (const line of lines)
    page.drawText(line.text, { x: 24, y: line.y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
  const prefixWidth = font.widthOfTextAtSize("DNI ", FONT_SIZE);
  const dniWidth = font.widthOfTextAtSize(DNI, FONT_SIZE);
  return {
    bytes: await pdf.save(),
    dniRect: {
      pageIndex: 0,
      x0: 24 + prefixWidth - 3,
      y0: 107,
      x1: 24 + prefixWidth + dniWidth + 3,
      y1: 110 + FONT_SIZE + 3,
    },
  };
}

for (const angle of [90, 180, 270] as const) {
  test(`ADR-190: OSD ausente recupera dos renglones a ${angle}° y exporta el DNI tapado`, async ({
    page,
    electronApp,
  }) => {
    await installSettingsOverride(page, { nerEnabled: false });
    await openApp(page, "networkidle");
    const { bytes: sourcePdf, dniRect } = await buildTwoLineDocument();
    const scanned = await rasterizeToScannedPdf(page, sourcePdf, 300 / 72);
    const importButton = page.getByRole("button", { name: "Elegir archivo" });
    const exportButton = page.getByRole("button", { name: "Exportar" });
    const outputDir = resolve(".measure", "adr190-e2e");
    await mkdir(outputDir, { recursive: true });
    await expect(importButton, `${angle}°: pantalla lista antes de importar`).toBeVisible();
    const rotatedDoc = await PDFDocument.load(scanned.buffer);
    rotatedDoc.getPage(0).setRotation(degrees(angle));
    const rotatedPdf = await rotatedDoc.save();
    const regions = await convertPdfRectsToRegions(page, rotatedPdf, [dniRect]);
    const [sourceRegion] = await samplePdfRegions(page, rotatedPdf, regions);
    expect(
      sourceRegion?.darkFraction ?? 0,
      `${angle}°: fixture tiene tinta en el DNI`,
    ).toBeGreaterThan(0.05);

    await page.locator('input[type="file"]').setInputFiles({
      name: `two-lines-${angle}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(rotatedPdf),
    });
    await expect(exportButton, `${angle}°: OCR completa la página`).toBeVisible({
      timeout: 180_000,
    });
    await expect(
      page.getByText(/no se pudo leer/i),
      `${angle}°: sin aviso de ilegible`,
    ).toHaveCount(0);
    const entityGroup = page.getByRole("treeitem", { name: DNI });
    await expect(entityGroup, `${angle}°: Regex recupera el DNI`).toBeVisible();
    const replacementMode = entityGroup.getByRole("button", { name: /^Modo de reemplazo de / });
    await replacementMode.click();
    await page
      .getByRole("group", { name: "Modo de reemplazo" })
      .getByRole("button", { name: /^Tapar con negro/ })
      .click();

    await exportButton.click();
    const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await expect(exportDialog).toBeVisible();
    await exportDialog.getByRole("button", { name: "Exportar" }).click();
    const pendingPagesDialog = page.getByRole("dialog", {
      name: "Páginas que no se pudieron leer",
    });
    await expect(pendingPagesDialog).toHaveCount(0);
    const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
    await expect(downloadLink).toBeVisible({ timeout: 180_000 });
    const exportedPdf = await captureDownload(
      electronApp,
      async () => downloadLink.click(),
      resolve(outputDir, `two-lines-${angle}-${Date.now()}.pdf`),
    );
    const [exportedRegion] = await samplePdfRegions(page, exportedPdf, regions);
    expect(
      exportedRegion?.blackFraction ?? 0,
      `${angle}°: export tapa la entidad DNI`,
    ).toBeGreaterThanOrEqual(0.6);

    await exportDialog.getByRole("button", { name: "Abrir otro documento" }).click();
  });
}
