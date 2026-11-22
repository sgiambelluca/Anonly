/**
 * F8 de `docs/roadmap/Plan_1.1.md` §7: la 1.1 de punta a punta.
 *
 * Un usuario crea un tipo propio («Legajo») y, con el generador de formatos,
 * un formato que lee «LEG-» más seis dígitos. Guarda, abre un PDF sintético que
 * trae un valor con esa forma, ve el grupo del tipo propio en el panel de
 * entidades y exporta. Lo que se afirma sobre el export no es el estado de la
 * UI sino **el PDF exportado**, leído con el OCR verificador independiente
 * (ADR-148): el valor no está en los bytes finales. Un control sobre el PDF
 * original prueba que el mismo OCR sí lo lee, así que la ausencia no es un OCR
 * ciego.
 *
 * Todo es sintético: el valor sale de este archivo, no de un documento real.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { captureDownload, expect, openApp, test } from "./support/electronApp.js";
import { auditPdfWithIndependentOcr } from "./support/exportVerificationOcr.js";

test.setTimeout(600_000);

/** Seis dígitos que ningún detector de base reconoce solos (ni DNI, ni teléfono). */
const LEGAJO_VALUE = "LEG-482915";
const LEGAJO_DIGITS = "482915";

/** Una página con el valor en un renglón propio, grande, para que el OCR lo lea sin dudas. */
async function legajoFile(): Promise<{
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
  readonly bytes: Uint8Array;
}> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Expediente ${LEGAJO_VALUE} del archivo`, {
    x: 60,
    y: 750,
    size: 20,
    font,
    color: rgb(0, 0, 0),
  });
  const bytes = await doc.save();
  return {
    name: "legajo-sintetico.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
    bytes,
  };
}

/** El texto del OCR sin espacios ni signos, en mayúsculas: tolera cómo parte las palabras. */
function squash(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
}

test("crear un tipo y un formato propios, detectarlos en un PDF y exportarlo sin el valor", async ({
  page,
  electronApp,
}) => {
  const outputDir = await mkdtemp(join(tmpdir(), "anonly-e2e-legajo-"));
  try {
    await openApp(page, "networkidle");

    // 1. Pantalla de inicio: la tarjeta abre «Formatos de detección».
    await page.getByRole("button", { name: /Ver y editar los formatos/ }).click();
    const formats = page.getByRole("dialog", { name: "Formatos de detección" });
    await expect(formats).toBeVisible();

    // 2. Un tipo propio, con su etiqueta corta.
    await formats.getByRole("button", { name: /^Nuevo tipo/ }).click();
    const typeDialog = page.getByRole("dialog", { name: "Nuevo tipo" });
    await expect(typeDialog).toBeVisible();
    await typeDialog.getByRole("textbox", { name: /^Nombre del tipo/ }).fill("Legajo");
    await typeDialog.getByRole("textbox", { name: /^Corta/ }).fill("LEG");
    await typeDialog.getByRole("button", { name: "Crear tipo" }).click();
    await expect(typeDialog).toBeHidden();

    // 3. Su banda trae «Nuevo formato»: abre el generador.
    const band = formats.getByRole("region", { name: "Legajo" });
    await expect(band).toBeVisible();
    await band.getByRole("button", { name: "Nuevo formato en Legajo" }).click();
    const builder = page.getByRole("dialog", { name: "Nuevo formato" });
    await expect(builder).toBeVisible();

    await builder.getByRole("textbox", { name: "Nombre del formato" }).fill("Legajo con prefijo");

    const strip = builder.getByRole("group", { name: "Piezas de la variante" });
    const inspector = builder.getByRole("region", { name: "Ajuste de la pieza" });

    // Pieza 1: texto fijo «LEG-».
    await strip.getByRole("button", { name: "Pieza", exact: true }).click();
    await builder
      .getByRole("group", { name: "Clases de pieza" })
      .getByRole("button", { name: /^Texto fijo/ })
      .click();
    await inspector.getByRole("textbox", { name: /^Texto/ }).fill("LEG-");

    // Pieza 2: seis dígitos (la pieza nueva arranca en uno: cinco veces «Uno más»).
    await strip.getByRole("button", { name: "Pieza", exact: true }).click();
    await builder
      .getByRole("group", { name: "Clases de pieza" })
      .getByRole("button", { name: /^Dígitos/ })
      .click();
    const oneMore = inspector.getByRole("button", { name: "Uno más" });
    for (let step = 0; step < 5; step += 1) await oneMore.click();

    // «Se lee · Ejemplo» confirma la forma antes de guardar.
    await expect(builder.getByText(/LEG-/).first()).toBeVisible();

    const create = builder.getByRole("button", { name: "Crear formato" });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(builder).toBeHidden();

    // El formato quedó en la banda del tipo; «Guardar» lo lleva a la configuración.
    await expect(band.getByText("Legajo con prefijo")).toBeVisible();
    await formats.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(formats).toBeHidden({ timeout: 60_000 });

    // 4. Un PDF sintético con un valor de esa forma.
    const file = await legajoFile();
    await page.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    // 5. El panel de entidades muestra el grupo del tipo propio con ese valor.
    const group = page.getByRole("treeitem", { name: new RegExp(LEGAJO_VALUE) });
    await expect(group).toBeVisible({ timeout: 180_000 });
    // El grupo cuelga de la franja del tipo «Legajo» (su nombre accesible: «<tipo>, N grupos»).
    const typeBand = page.getByRole("treeitem", { name: /^Legajo.*, \d+ grupos?$/ });
    await expect(typeBand.getByRole("treeitem", { name: new RegExp(LEGAJO_VALUE) })).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Exportar" });
    await expect(exportButton).toBeVisible({ timeout: 180_000 });

    // 6. Exportar y leer el PDF exportado.
    await exportButton.click();
    const exportDialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
    await expect(exportDialog).toBeVisible();
    await exportDialog.getByRole("button", { name: "Exportar" }).click();
    const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
    await expect(downloadLink).toBeVisible({ timeout: 300_000 });
    const exported = await captureDownload(
      electronApp,
      async () => downloadLink.click(),
      join(outputDir, "exportado.pdf"),
    );

    // Control: el mismo OCR sí lee el valor en el original.
    const original = await auditPdfWithIndependentOcr(page, file.bytes, [0]);
    expect(squash(original.textByPage.join("\n")), "control: el OCR lee el original").toContain(
      squash(LEGAJO_VALUE),
    );

    const audit = await auditPdfWithIndependentOcr(page, new Uint8Array(exported), [0]);
    const exportedText = squash(audit.textByPage.join("\n"));
    // El OCR del exportado leyó la página: el texto que no es dato sigue a la vista.
    expect(exportedText, "control: el OCR lee el resto del renglón exportado").toContain(
      "EXPEDIENTE",
    );
    expect(exportedText, "el valor completo no está en el PDF exportado").not.toContain(
      squash(LEGAJO_VALUE),
    );
    expect(exportedText, "los seis dígitos no están en el PDF exportado").not.toContain(
      LEGAJO_DIGITS,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
