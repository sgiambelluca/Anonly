/**
 * ADR-190 §"Pruebas exigidas" (E2E de regresión, segunda): "una página con
 * tinta y sin texto legible (formas, no texto): aparece el aviso, la
 * confirmación lista la página, y con 'Tapar página entera' el export sale
 * negro en esa página y en el resto no cambia nada."
 *
 * Documento de dos páginas, escaneado (sin capa de texto,
 * `support/scannedPdf.ts#rasterizeToScannedPdf`, mismo mecanismo que
 * `scenario-2-scanned-ocr.spec.ts`):
 *
 * - **Página 0**: solo formas (dos rectángulos sólidos) — tinta de sobra
 *   (`inkRatio` del OSD, ADR-190 §3, la ve sin problema) pero nada que
 *   Tesseract pueda leer como palabra. Es el caso que
 *   `ocr.engine.ts#processPageInternal` marca `unreadableInk: true` en vez de
 *   fallar en silencio (ADR-190 §2/§4): la cadena entera (pasos 2-4) prueba
 *   ángulos y upscale sin encontrar ninguna lectura confiable, y termina la
 *   página igual, con el aviso prendido.
 *
 *   **Solo rectángulos sólidos, nada de líneas finas ni elipses** (hallazgo
 *   durante la implementación, diagnóstico manual, no queda en el repo): una
 *   línea diagonal gruesa + una elipse le dieron a Tesseract un trazo lo
 *   bastante parecido a un carácter como para "leer" una palabra de una letra
 *   con confianza 0.6 — justo el umbral de "lectura fiable" de ADR-190 §2 —,
 *   así que la página NO quedaba `unreadableInk`. Dos bloques rectangulares
 *   opacos, sin ninguna curva ni trazo fino, dan `wordCount: 0` limpio. No es
 *   una vuelta de tuerca al producto: es evitar la forma que por accidente se
 *   parece a una letra, no la ausencia de texto en sí.
 * - **Página 1**: texto legible sin ningún patrón de entidad ("página de
 *   control"), a propósito — así "el resto no cambia nada" se puede afirmar
 *   por píxeles (tinta conservada, nada tapado de negro) sin la ambigüedad de
 *   qué reemplazo eligió el usuario para una entidad real ahí.
 *
 * Sin entidades habilitadas en todo el documento (cero grupos): el pre-flight
 * existente de `ExportDialog` ("No hay entidades habilitadas…",
 * `exportPreflight.ts`) se dispara primero — el spec lo atraviesa con
 * "Continuar" antes de llegar a la confirmación de ADR-190 §4, que es la que
 * importa acá.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  rasterizeToScannedPdf,
  samplePdfRegions,
  type PdfRegionSample,
} from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(300_000);

const PAGE_WIDTH = 260;
const PAGE_HEIGHT = 180;
const CONTROL_TEXT = "Pagina de control sin datos";
const FONT_SIZE = 20;
const MARGIN = 20;

interface TwoPageFixture {
  readonly sourceTextPdf: Uint8Array;
  readonly shapesInkRegion: { x: number; y: number; width: number; height: number };
  readonly controlTextRegion: { x: number; y: number; width: number; height: number };
}

/** `y` en la región va en espacio de canvas (arriba-izquierda): sin rotación
 * en este fixture, `canvasY = pageHeight - pdfY`, así que se calcula directo
 * (a diferencia de `adr190-sparse-page-readable.spec.ts`, acá no hace falta
 * `convertPdfRectsToRegions` porque ninguna página lleva `/Rotate`). */
function toCanvasRegion(rect: { x0: number; y0: number; x1: number; y1: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: rect.x0,
    y: PAGE_HEIGHT - rect.y1,
    width: rect.x1 - rect.x0,
    height: rect.y1 - rect.y0,
  };
}

async function buildTwoPageFixture(): Promise<TwoPageFixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Página 0: formas, nada de texto. Solo bloques sólidos (ver docblock de
  // cabecera): ninguna curva ni trazo fino que Tesseract pueda confundir con
  // un carácter.
  const page0 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page0.drawRectangle({ x: 30, y: 90, width: 100, height: 60, color: rgb(0, 0, 0) });
  page0.drawRectangle({ x: 150, y: 30, width: 80, height: 70, color: rgb(0, 0, 0) });
  const shapesInkRegion = { x: 30, y: PAGE_HEIGHT - 150, width: 100, height: 60 };

  // Página 1: texto legible, sin ningún patrón de entidad.
  const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const textWidth = font.widthOfTextAtSize(CONTROL_TEXT, FONT_SIZE);
  const baselineY = PAGE_HEIGHT / 2 - FONT_SIZE / 2;
  page1.drawText(CONTROL_TEXT, {
    x: MARGIN,
    y: baselineY,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  const controlTextRegion = toCanvasRegion({
    x0: MARGIN - 4,
    y0: baselineY - 4,
    x1: MARGIN + Math.min(textWidth, PAGE_WIDTH - MARGIN * 2) + 4,
    y1: baselineY + FONT_SIZE + 4,
  });

  return { sourceTextPdf: await doc.save(), shapesInkRegion, controlTextRegion };
}

test("ADR-190: página con tinta y sin texto legible — aviso, confirmación, 'Tapar página entera' tapa solo esa página", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const { sourceTextPdf, shapesInkRegion, controlTextRegion } = await buildTwoPageFixture();
  const scanned = await rasterizeToScannedPdf(page, sourceTextPdf);

  const regions: ReadonlyArray<PdfRegionSample> = [
    { pageIndex: 0, ...shapesInkRegion },
    { pageIndex: 1, ...controlTextRegion },
  ];

  // Control: la página 0 tiene tinta (las formas) y la página 1 tiene tinta
  // (el texto) — si esto falla, la fixture está mal, no el producto.
  const [controlShapes, controlText] = await samplePdfRegions(page, scanned.buffer, regions);
  expect(controlShapes?.darkFraction ?? 0, "control: la página 0 no tiene tinta").toBeGreaterThan(
    0.05,
  );
  expect(controlText?.darkFraction ?? 0, "control: la página 1 no tiene tinta").toBeGreaterThan(
    0.05,
  );

  await page.locator('input[type="file"]').setInputFiles(scanned);

  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 120_000 });

  // Aviso de ADR-190 §4 (`PageCanvas`, `ui/Components.md` §5.4): la página 0
  // no tiene ninguna entidad y quedó `unreadableInk` — el aviso tiene que
  // estar montado (página 0 es la primera, siempre en el rango visible).
  await expect(
    page.getByText(
      "Esta página tiene contenido que no se pudo leer. Revisala: si tiene datos sensibles, no se van a tapar solos.",
    ),
  ).toBeVisible();

  await exportButton.click();
  const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Exportar" }).click();

  // Sin entidades habilitadas en todo el documento: el pre-flight existente
  // se dispara primero (`exportPreflight.ts`) — no es lo que este spec prueba,
  // solo hay que atravesarlo.
  const noGroupsConfirm = page.getByRole("dialog", { name: "Exportar sin nada anonimizado" });
  await expect(noGroupsConfirm).toBeVisible();
  await noGroupsConfirm.getByRole("button", { name: "Continuar" }).click();

  // La confirmación de ADR-190 §4: lista la página pendiente.
  const pendingPagesDialog = page.getByRole("dialog", { name: "Páginas que no se pudieron leer" });
  await expect(pendingPagesDialog).toBeVisible();
  await expect(pendingPagesDialog.getByText("Página 1")).toBeVisible();

  const coverCheckbox = pendingPagesDialog.getByRole("checkbox", { name: "Tapar página entera" });
  await expect(coverCheckbox, "marcado por defecto (ui/Components.md §7.1)").toBeChecked();

  await pendingPagesDialog.getByRole("button", { name: "Exportar" }).click();

  const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
  await expect(downloadLink).toBeVisible({ timeout: 180_000 });

  const outputDir = resolve(".measure", "adr190-e2e");
  await mkdir(outputDir, { recursive: true });
  const exportedBytes = await captureDownload(
    electronApp,
    async () => downloadLink.click(),
    resolve(outputDir, `unreadable-cover-${Date.now()}.pdf`),
  );

  const exportedDoc = await PDFDocument.load(exportedBytes);
  expect(exportedDoc.getPageCount()).toBe(2);

  // Página 0: tapada entera de negro, mismo tamaño que el original
  // (`export.engine.ts#exportPage`, ADR-190 §4 — sin llamar a `renderFull`).
  const fullPage0Region: PdfRegionSample = {
    pageIndex: 0,
    x: 2,
    y: 2,
    width: PAGE_WIDTH - 4,
    height: PAGE_HEIGHT - 4,
  };
  const [exportedPage0, exportedPage1] = await samplePdfRegions(page, exportedBytes, [
    fullPage0Region,
    { pageIndex: 1, ...controlTextRegion },
  ]);
  expect(exportedPage0?.pageWidthPx).toBe(controlShapes?.pageWidthPx);
  expect(exportedPage0?.pageHeightPx).toBe(controlShapes?.pageHeightPx);
  expect(
    exportedPage0?.blackFraction ?? 0,
    "la página 0 debería salir enteramente negra",
  ).toBeGreaterThanOrEqual(0.9);

  // Página 1: sin cambios — sigue con su tinta, no tapada de negro.
  expect(
    exportedPage1?.darkFraction ?? 0,
    "la página 1 no debería haber perdido su tinta",
  ).toBeGreaterThan(0.05);
  expect(
    exportedPage1?.blackFraction ?? 0,
    "la página 1 no debería haber quedado tapada de negro",
  ).toBeLessThan(0.3);
});
