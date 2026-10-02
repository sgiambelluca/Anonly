/**
 * ADR-190 §"Pruebas exigidas" (E2E de regresión, primera): "una página escasa
 * (nombre y DNI) a 150 y a 300 dpi, derecha y girada: sin aviso y con la
 * entidad tapada en el export".
 *
 * Este es exactamente el caso que la cadena de verificación (ADR-190 §2) está
 * para resolver **sin** que el usuario lo note: una página real y legible,
 * pero con muy poca señal de texto, es justo la que el `docblock` de
 * `scanned-rotated-export.spec.ts` describe como riesgo abierto — el OSD de
 * Tesseract puede adivinar mal el ángulo (o fallar del todo) cuando solo hay
 * un nombre y un DNI, y sin reintentos la página termina con 0 palabras y
 * SIN aviso al usuario, mientras el dato queda sin tapar en el export. Este
 * spec corre el pipeline real (OCR real, Tesseract.js, sin mocks) y prueba
 * el otro lado: con la cadena de ADR-190, esa misma página escasa **sí**
 * termina legible, sin aviso de "no se pudo leer", y con el DNI tapado.
 *
 * Cuatro combinaciones en un único test (una instancia de Electron, ciclo de
 * abrir → exportar → "Abrir otro documento", mismo patrón que
 * `scenario-7-open-close-cycle.spec.ts`) en vez de cuatro specs: cada una abre
 * su propio Electron + carga el modelo de OCR real, y el costo dominante es
 * ese arranque, no el OCR de una sola página escasa.
 *
 * - **150/300 dpi**: controla `ExportDialog`/`ocr.engine.ts` vía
 *   `ocrDpiCap` (`pdf.engine.ts#deriveOcrDpiCap`, ADR-163) — a 150 dpi
 *   `effectiveOcrDpi < 300` y el paso 4 de la cadena (upscale ×2) entra en
 *   juego si los pasos 1-3 no alcanzan; a 300 dpi nunca hace falta.
 *   `rasterizeToScannedPdf(page, bytes, scale)` rasteriza a `scale = dpi/72`
 *   (72 dpi = escala 1, la unidad nativa de PDF).
 * - **derecha/girada**: girada aplica `/Rotate 90` sobre el PDF YA
 *   rasterizado (igual técnica que `scanned-rotated-export.spec.ts` —
 *   pdf.js aplica esa rotación al renderizar, así que el ráster que el OCR
 *   real recibe queda visualmente girado sin tocar los píxeles a mano).
 *
 * **Fixture de dos líneas.** La página tiene solo dos renglones sueltos
 * ("Juan Perez" / "DNI 34.567.891"), el caso escaso original de ADR-190. Con
 * tan poca señal el OSD de Tesseract puede elegir el cuadrante equivocado
 * (o no dar veredicto) y "leer" ese cuadrante con confianza alta pero texto
 * basura ("168", "295", "INC"). La cadena de verificación de ADR-190 §2 lo
 * resuelve: con veredicto girado y tinta siempre compara contra 0° (caso 44),
 * y sin veredicto ensaya los cuatro ángulos y se queda con la lectura de mayor
 * confianza de página (caso 48). Antes esta prueba engrosaba la fixture a
 * cuatro líneas para esquivar el problema; ya no hace falta y no demuestra
 * nada sobre el caso escaso, así que se volvió a las dos líneas. Si alguna
 * combinación fallara con dos líneas, no se engrosa: se marca `test.fixme`
 * apuntando a ADR-190 y se reporta.
 *
 * NER queda desactivado (`installSettingsOverride`, mismo criterio que
 * `scenario-2-scanned-ocr.spec.ts`): la entidad de control es el DNI
 * (Regex), y activar NER solo sumaría el costo del modelo ONNX ×4
 * iteraciones sin aportar señal sobre la cadena de OCR, que es lo que este
 * spec verifica. El nombre igual va en la página (pide el ADR "nombre y
 * DNI" como contenido) — sencillamente no es la entidad que se afirma acá.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import {
  convertPdfRectsToRegions,
  rasterizeToScannedPdf,
  samplePdfRegions,
  type PdfRegionSample,
} from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(600_000);

const FONT_SIZE = 26;
const MARGIN = 24;
const LINE_SPACING = 50;
const TOP_BASELINE_Y = 160;
const UNROTATED_WIDTH = 280;
const UNROTATED_HEIGHT = 220;
const RECT_PAD = 4;
const NAME_TEXT = "Juan Perez";
const DNI_VALUE = "34.567.891";
const DNI_LABEL = `DNI ${DNI_VALUE}`;
const NAME_LINE_INDEX = 0;
const DNI_LINE_INDEX = 1;

function baselineYForLine(lineIndex: number): number {
  return TOP_BASELINE_Y - lineIndex * LINE_SPACING;
}

interface SparsePageFixture {
  readonly sourceTextPdf: Uint8Array;
  readonly dniRect: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Página escasa de dos líneas cortas — nombre y DNI —, sin ningún renglón de
 * relleno que le dé señal extra al OSD (ver el docblock de cabecera).
 */
async function buildSparsePageFixture(): Promise<SparsePageFixture> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const dniPrefixWidth = font.widthOfTextAtSize("DNI ", FONT_SIZE);
  const dniValueWidth = font.widthOfTextAtSize(DNI_VALUE, FONT_SIZE);

  const page = doc.addPage([UNROTATED_WIDTH, UNROTATED_HEIGHT]);
  const lines: ReadonlyArray<readonly [string, number]> = [
    [NAME_TEXT, NAME_LINE_INDEX],
    [DNI_LABEL, DNI_LINE_INDEX],
  ];
  for (const [text, lineIndex] of lines) {
    page.drawText(text, {
      x: MARGIN,
      y: baselineYForLine(lineIndex),
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const dniX0 = MARGIN + dniPrefixWidth;
  const dniX1 = dniX0 + dniValueWidth;
  const dniBaselineY = baselineYForLine(DNI_LINE_INDEX);

  return {
    sourceTextPdf: await doc.save(),
    dniRect: {
      x0: dniX0 - RECT_PAD,
      y0: dniBaselineY - RECT_PAD,
      x1: dniX1 + RECT_PAD,
      y1: dniBaselineY + FONT_SIZE + RECT_PAD,
    },
  };
}

interface Combo {
  readonly dpi: 150 | 300;
  readonly rotated: boolean;
}

const COMBOS: ReadonlyArray<Combo> = [
  { dpi: 150, rotated: false },
  { dpi: 150, rotated: true },
  { dpi: 300, rotated: false },
  { dpi: 300, rotated: true },
];

test("ADR-190: página escasa (nombre y DNI) a 150/300 dpi, derecha y girada — sin aviso, entidad tapada en el export", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const { sourceTextPdf, dniRect } = await buildSparsePageFixture();

  const importButton = page.getByRole("button", { name: "Elegir archivo" });
  const exportButton = page.getByRole("button", { name: "Exportar" });
  const unreadableWarning = page.getByText(/no se pudo leer/i);
  const pendingPagesDialog = page.getByRole("dialog", { name: "Páginas que no se pudieron leer" });

  for (const combo of COMBOS) {
    const label = `dpi=${combo.dpi} rotated=${combo.rotated}`;

    await expect(importButton, `${label}: pantalla de carga antes de importar`).toBeVisible();

    const scanned = await rasterizeToScannedPdf(page, sourceTextPdf, combo.dpi / 72);
    let finalBytes: Uint8Array = scanned.buffer;
    if (combo.rotated) {
      const rotatedDoc = await PDFDocument.load(scanned.buffer);
      const rotatedPage = rotatedDoc.getPage(0);
      expect(rotatedPage.getRotation().angle, `${label}: ángulo de partida`).toBe(0);
      rotatedPage.setRotation(degrees(90));
      finalBytes = await rotatedDoc.save();
    }

    const regions: ReadonlyArray<PdfRegionSample> = await convertPdfRectsToRegions(
      page,
      finalBytes,
      [{ pageIndex: 0, ...dniRect }],
    );

    // Control: el ráster de origen tiene tinta donde se espera el DNI — si
    // esto falla, la geometría de la fixture está mal, no el producto.
    const [control] = await samplePdfRegions(page, finalBytes, regions);
    expect(control, `${label}: región del DNI sin datos de control`).toBeDefined();
    expect(
      control?.darkFraction ?? 0,
      `${label}: control sin tinta en la región del DNI — geometría de la fixture mal calculada`,
    ).toBeGreaterThan(0.05);

    await page.locator('input[type="file"]').setInputFiles({
      name: `sparse-${combo.dpi}-${combo.rotated ? "rot" : "up"}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(finalBytes),
    });

    await expect(exportButton, `${label}: pipeline llega a Ready`).toBeVisible({
      timeout: 120_000,
    });

    // Aserción central (ADR-190 §2/§4): la cadena de verificación resuelve la
    // página sola — sin aviso de "no se pudo leer" y con la entidad visible.
    await expect(unreadableWarning, `${label}: no debería aparecer el aviso`).toHaveCount(0);
    const entityGroup = page.getByRole("treeitem", { name: DNI_VALUE });
    await expect(entityGroup, `${label}: el DNI se detectó`).toBeVisible();

    // "Tapar con negro" — mismo criterio que `scanned-rotated-export.spec.ts`:
    // cobertura pixel-exacta, sin la ambigüedad de un pseudónimo de texto.
    const replacementModeSelect = entityGroup.getByRole("button", {
      name: /^Modo de reemplazo de /,
    });
    await replacementModeSelect.click();
    await page
      .getByRole("group", { name: "Modo de reemplazo" })
      .getByRole("button", { name: /^Tapar con negro/ })
      .click();
    await expect(replacementModeSelect, `${label}: modo aplicado`).toHaveAccessibleName(
      /Tapar con negro/,
    );

    await exportButton.click();
    const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await expect(exportDialog, `${label}: diálogo de export abierto`).toBeVisible();
    await exportDialog.getByRole("button", { name: "Exportar" }).click();

    // Sin páginas pendientes: la confirmación de ADR-190 §4 no debería abrirse.
    await expect(
      pendingPagesDialog,
      `${label}: no debería abrirse la confirmación de páginas no leídas`,
    ).toHaveCount(0);

    const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
    await expect(downloadLink, `${label}: link de descarga`).toBeVisible({ timeout: 180_000 });

    const outputDir = resolve(".measure", "adr190-e2e");
    await mkdir(outputDir, { recursive: true });
    const exportedBytes = await captureDownload(
      electronApp,
      async () => downloadLink.click(),
      resolve(outputDir, `sparse-${combo.dpi}-${combo.rotated ? "rot" : "up"}-${Date.now()}.pdf`),
    );

    const [exported] = await samplePdfRegions(page, exportedBytes, regions);
    expect(exported, `${label}: región del DNI sin datos en el export`).toBeDefined();
    expect(
      exported?.blackFraction ?? 0,
      `${label}: la entidad no quedó tapada de negro en el export`,
    ).toBeGreaterThanOrEqual(0.6);

    await exportDialog.getByRole("button", { name: "Abrir otro documento" }).click();
    await expect(importButton, `${label}: vuelve a la pantalla de carga`).toBeVisible();
  }
});
