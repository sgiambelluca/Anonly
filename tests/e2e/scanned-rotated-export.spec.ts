/**
 * `PDF_Engine.md` §15, item 35 (ADR-140 §2, revisión de la ronda A, B-5):
 * verificación E2E de una hoja **escaneada** (sin capa de texto) con
 * `/Rotate 90` sobre el producto real — Electron, OCR real, exportación real
 * — hasta leer los píxeles del PDF exportado.
 *
 * `tests/integration/scanned-rotated-export.test.ts` (B-5, mismo ADR) ya
 * cubre la fusión OCR→bbox y el render `mode:"full"` con mocks de
 * `pdfjs-dist`/Tesseract, pero llama a `RenderEngine.renderPage` DIRECTO —
 * nunca pasa por `ExportEngine`/pdf-lib de verdad (el stub de
 * `OffscreenCanvas.convertToBlob()` no produce un PNG real, ver el comentario
 * de cabecera de ese archivo). Este spec es el que efectivamente ejercita
 * `worker/assembler.ts` (`addPage([pageWidthPt, pageHeightPt]) + drawImage`,
 * sin `/Rotate` en la página de salida) contra un PDF de origen que sí lo
 * tiene.
 *
 * Alcance (espíritu de ADR-148, sin implementarlo entero — pedido explícito
 * del planificador para este PR): un único documento, una única página, una
 * única entidad, modo de reemplazo "Tapar con negro" (igual que
 * `t5-orientation-pixel.spec.ts`, por la misma razón: cobertura sólida y
 * pixel-exacta, sin la ambigüedad de un pseudónimo de texto). No reanaliza,
 * no prueba OCR multi-idioma, no verifica más de un giro: eso es T-5 (opt-in,
 * `ANONLY_T5_E2E=1`) y queda fuera de este PR.
 *
 * Fixture: página sintética de ~260×340pt (el ancho exacto depende de las
 * métricas reales de Helvetica, calculado en `buildFixture()` — nunca
 * hardcodeado) generada con pdf-lib. Se rasteriza en el browser
 * (`support/scannedPdf.ts#rasterizeToScannedPdf`, igual que el Escenario 2)
 * para producir un PDF de solo imagen sin capa de texto — así el guard
 * `PdfPageRotatedError` (ADR-140 §1) no la rechaza pese al `/Rotate` (el
 * guard solo mira páginas con texto nativo). Recién sobre ESE PDF rasterizado
 * se aplica `page.setRotation(degrees(90))` con pdf-lib — exactamente el
 * pedido del planificador.
 *
 * Densidad de texto (encontrado empíricamente, no en ningún spec): con solo
 * dos líneas sueltas en una página casi en blanco, el paso de detección de
 * orientación de `orientation-kernel.ts` (Tesseract OSD, disparado por
 * `OcrEngine#processPage` para TODA página OCR — ver ese archivo) no tiene
 * suficiente señal y clasifica mal el ángulo incluso cuando el ráster que
 * `RenderEngine.rasterizePage` ya le entregó está en la orientación visual
 * correcta (pdf.js aplicó `/Rotate` al armar el viewport) — el resultado es
 * `OCR_PAGE_FINISHED` con `wordCount: 0` y **sin** `OCR_PAGE_FAILED` (fallo
 * silencioso). Confirmado con un spec de descarte (no incluido en este PR):
 * la MISMA página con `/Rotate 90` pero diez líneas de relleno reconoce el
 * DNI sin problema y con `bbox.rotation: 270` (la convención de ADR-141 §3
 * para `/Rotate 90`). Si esto es solo densidad del fixture o un riesgo del
 * producto (una página escasa real que sale con 0 palabras y sin aviso) está
 * **abierto**: ver el riesgo de OSD en páginas escasas en `MVP.md` (Hito 11)
 * y en la ronda B de `Revision_Por_Bloques_Hardening.md`. Este test no lo
 * cubre ni lo descarta. Por eso el fixture repite el DNI y
 * agrega líneas de relleno neutras: no es realismo, es la señal mínima para
 * que el propio Tesseract del producto (no un mock) resuelva el ángulo.
 *
 * Geometría de las regiones de muestreo: `viewportTransformFor` (mismo
 * matcher que corrigió N-1 en `tests/integration/fixtures/mocks.ts`, ADR-141
 * §2) da, para `/Rotate 90` y origen de página en `(0,0)`: `canvasX = pdfY`,
 * `canvasY = pdfX` (matriz `[0,1,1,0,0,0]`). Como el DNI y el texto vecino se
 * dibujan en espacio PDF sin rotar (antes de rasterizar), sus rectángulos se
 * transforman con esa misma fórmula para obtener las regiones a muestrear
 * sobre el PDF YA rotado — sin adivinar números a mano.
 *
 * Por qué las MISMAS regiones sirven para la fuente y para el export:
 * `worker/assembler.ts` arma la página de salida con
 * `pdfDoc.addPage([page.width, page.height])` — `page.width/height` del
 * modelo del Core son los dimensiones YA VISUALES (ADR-141 §2, intercambiadas
 * a 90°/270°) — más un `drawImage` de bordes a bordes del render `full` (que
 * ya pintó en orientación vertical). La página de salida no lleva `/Rotate`
 * (queda en su default, 0), pero su contenido y sus dimensiones ya son las
 * visuales: al muestrearla con `getViewport({scale:1})` (rotate 0) da el
 * mismo sistema de coordenadas top-left que muestrear la fuente con
 * `/Rotate 90` aplicado. Por eso `sensitiveRegion`/`neighborRegion` se
 * calculan una sola vez y se usan contra `sourceBytes` (control) y
 * `exportedPdf` (verificación) sin transformarlas de nuevo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  rasterizeToScannedPdf,
  samplePdfRegions,
  type PdfRegionSample,
} from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(300_000);

const FONT_SIZE = 22;
const MARGIN = 20;
const LINE_SPACING = 24;
const TOP_BASELINE_Y = 310;
const UNROTATED_HEIGHT = 340;
const DNI_VALUE = "34.567.891";
const DNI_LABEL = `DNI ${DNI_VALUE}`;
const NEIGHBOR_TEXT = "Texto vecino intacto";
const FILLER_LINE_COUNT = 10;
// Índice 0 = DNI (arriba), 1..10 = relleno, 11 = vecino (abajo) — ver el
// docblock de cabecera sobre por qué hacen falta líneas de relleno.
const DNI_LINE_INDEX = 0;
const NEIGHBOR_LINE_INDEX = FILLER_LINE_COUNT + 1;
const RECT_PAD = 4;

function fillerLine(index: number): string {
  return `Linea de relleno numero ${index} para deteccion de orientacion`;
}

function baselineYForLine(lineIndex: number): number {
  return TOP_BASELINE_Y - lineIndex * LINE_SPACING;
}

interface UnrotatedRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** `canvasX = pdfY`, `canvasY = pdfX` — ver el docblock de cabecera. */
function toRotated90Region(rect: UnrotatedRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: rect.y0,
    y: rect.x0,
    width: rect.y1 - rect.y0,
    height: rect.x1 - rect.x0,
  };
}

async function buildFixture(): Promise<{
  readonly sourceTextPdf: Uint8Array;
  readonly unrotatedWidth: number;
  readonly sensitiveRegion: { x: number; y: number; width: number; height: number };
  readonly neighborRegion: { x: number; y: number; width: number; height: number };
}> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const dniPrefixWidth = font.widthOfTextAtSize("DNI ", FONT_SIZE);
  const dniValueWidth = font.widthOfTextAtSize(DNI_VALUE, FONT_SIZE);
  const dniLabelWidth = dniPrefixWidth + dniValueWidth;
  const neighborWidth = font.widthOfTextAtSize(NEIGHBOR_TEXT, FONT_SIZE);
  const fillerWidths = Array.from({ length: FILLER_LINE_COUNT }, (_, index) =>
    font.widthOfTextAtSize(fillerLine(index + 1), FONT_SIZE),
  );
  const unrotatedWidth = Math.ceil(
    Math.max(dniLabelWidth, neighborWidth, ...fillerWidths) + MARGIN * 2,
  );

  const page = doc.addPage([unrotatedWidth, UNROTATED_HEIGHT]);
  page.drawText(DNI_LABEL, {
    x: MARGIN,
    y: baselineYForLine(DNI_LINE_INDEX),
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
  for (let index = 0; index < FILLER_LINE_COUNT; index += 1) {
    page.drawText(fillerLine(index + 1), {
      x: MARGIN,
      y: baselineYForLine(index + 1),
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }
  page.drawText(NEIGHBOR_TEXT, {
    x: MARGIN,
    y: baselineYForLine(NEIGHBOR_LINE_INDEX),
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });

  const dniX0 = MARGIN + dniPrefixWidth;
  const dniX1 = dniX0 + dniValueWidth;
  const dniBaselineY = baselineYForLine(DNI_LINE_INDEX);
  const neighborBaselineY = baselineYForLine(NEIGHBOR_LINE_INDEX);
  const sensitiveRegion = toRotated90Region({
    x0: dniX0 - RECT_PAD,
    y0: dniBaselineY - RECT_PAD,
    x1: dniX1 + RECT_PAD,
    y1: dniBaselineY + FONT_SIZE + RECT_PAD,
  });
  const neighborRegion = toRotated90Region({
    x0: MARGIN - RECT_PAD,
    y0: neighborBaselineY - RECT_PAD,
    x1: MARGIN + neighborWidth + RECT_PAD,
    y1: neighborBaselineY + FONT_SIZE + RECT_PAD,
  });

  return { sourceTextPdf: await doc.save(), unrotatedWidth, sensitiveRegion, neighborRegion };
}

test("hoja escaneada con /Rotate 90: la censura cae sobre la entidad y el texto vecino sobrevive (ADR-140 §2, PDF_Engine.md item 35)", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const { sourceTextPdf, sensitiveRegion, neighborRegion } = await buildFixture();

  // Rasteriza a PDF de solo imagen (sin capa de texto) — el guard de
  // ADR-140 §1 (`PdfPageRotatedError`) solo rechaza páginas rotadas CON
  // texto nativo, así que esta página escaneada pasa pese al `/Rotate` que
  // se le agrega a continuación.
  const scanned = await rasterizeToScannedPdf(page, sourceTextPdf);
  const rotatedDoc = await PDFDocument.load(scanned.buffer);
  const rotatedPage = rotatedDoc.getPage(0);
  expect(rotatedPage.getRotation().angle).toBe(0);
  rotatedPage.setRotation(degrees(90));
  const rotatedBytes = await rotatedDoc.save();

  const regions: ReadonlyArray<PdfRegionSample> = [
    { pageIndex: 0, ...sensitiveRegion },
    { pageIndex: 0, ...neighborRegion },
  ];

  // Control (pedido explícito del planificador): antes de tocar el export,
  // confirmar que el ráster original SÍ tiene tinta en las dos regiones —
  // si esto falla, la geometría de la fixture está mal, no el producto.
  const [controlSensitive, controlNeighbor] = await samplePdfRegions(page, rotatedBytes, regions);
  expect(controlSensitive, "región sensible sin datos de control").toBeDefined();
  expect(controlNeighbor, "región vecina sin datos de control").toBeDefined();
  expect(
    controlSensitive?.darkFraction ?? 0,
    `control: la región de la entidad no tiene tinta — geometría de la fixture mal calculada (${JSON.stringify(controlSensitive)})`,
  ).toBeGreaterThan(0.05);
  expect(
    controlNeighbor?.darkFraction ?? 0,
    `control: la región vecina no tiene tinta — geometría de la fixture mal calculada (${JSON.stringify(controlNeighbor)})`,
  ).toBeGreaterThan(0.05);

  await page.locator('input[type="file"]').setInputFiles({
    name: "scanned-rotated.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(rotatedBytes),
  });

  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 180_000 });

  const entityGroup = page.getByRole("treeitem", { name: DNI_VALUE });
  await expect(entityGroup).toBeVisible();
  const replacementModeSelect = entityGroup.getByRole("button", { name: /^Modo de reemplazo de / });
  await replacementModeSelect.click();
  await page
    .getByRole("group", { name: "Modo de reemplazo" })
    .getByRole("button", { name: /^Tapar con negro/ })
    .click();
  await expect(replacementModeSelect).toHaveAccessibleName(/Tapar con negro/);

  await exportButton.click();
  const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Exportar" }).click();
  const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
  await expect(downloadLink).toBeVisible({ timeout: 180_000 });

  const outputDir = resolve(".measure", "b5-e2e", `rotated-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const exportedPdf = await captureDownload(
    electronApp,
    async () => downloadLink.click(),
    resolve(outputDir, "anonimizado.pdf"),
  );

  const exportedDoc = await PDFDocument.load(exportedPdf);
  expect(exportedDoc.getPageCount(), "el PDF exportado debería tener una sola página").toBe(1);

  const [exportedSensitive, exportedNeighbor] = await samplePdfRegions(page, exportedPdf, regions);
  expect(exportedSensitive, "región sensible sin datos en el export").toBeDefined();
  expect(exportedNeighbor, "región vecina sin datos en el export").toBeDefined();

  // Dimensiones correctas: la página exportada no lleva `/Rotate` (ver
  // docblock), pero su contenido ya está en orientación visual — mismo
  // ancho/alto en píxeles (a scale 1) que la fuente rotada.
  expect(exportedSensitive?.pageWidthPx).toBe(controlSensitive?.pageWidthPx);
  expect(exportedSensitive?.pageHeightPx).toBe(controlSensitive?.pageHeightPx);

  // La entidad queda tapada: no es la tinta original, es el reemplazo negro.
  expect(
    exportedSensitive?.blackFraction ?? 0,
    `región sensible sin cobertura negra tras exportar: ${JSON.stringify(exportedSensitive)}`,
  ).toBeGreaterThanOrEqual(0.6);

  // El texto vecino sigue ahí, sin tocar.
  expect(
    exportedNeighbor?.darkFraction ?? 0,
    `región vecina perdió su tinta tras exportar: ${JSON.stringify(exportedNeighbor)}`,
  ).toBeGreaterThan(0.05);
  expect(
    exportedNeighbor?.blackFraction ?? 0,
    `región vecina quedó tapada de negro tras exportar (no debería): ${JSON.stringify(exportedNeighbor)}`,
  ).toBeLessThan(0.3);

  // Evidencia numérica del run, igual criterio que
  // `t5-orientation-pixel.spec.ts` (`external-regions-144dpi.json`): un
  // archivo en `.measure/` (gitignored) en vez de dejar un `console.log` en
  // el spec.
  await writeFile(
    resolve(outputDir, "regions.json"),
    JSON.stringify(
      {
        control: { sensitive: controlSensitive, neighbor: controlNeighbor },
        exported: { sensitive: exportedSensitive, neighbor: exportedNeighbor },
      },
      null,
      2,
    ),
    "utf8",
  );
});
