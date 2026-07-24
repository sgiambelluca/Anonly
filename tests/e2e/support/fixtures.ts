/**
 * `support/fixtures.ts` — adjunta PDFs de fixture a un `<input type="file">`
 * de Playwright sin escribir archivos a disco.
 *
 * Reutiliza los generadores deterministas de `tests/fixtures/generate.ts`
 * (misma fuente que documenta `tests/fixtures/README.md` y que ya validan
 * `tests/fixtures/generate.test.ts`) en vez de duplicar los bytes acá o
 * commitear PDFs binarios nuevos: `Locator.setInputFiles()` de Playwright
 * acepta un `FilePayload` en memoria (`{ name, mimeType, buffer }`), así que
 * no hace falta que el archivo exista en `tests/fixtures/*.pdf` para este PR.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { generateCorrupt, generateText10p } from "../../fixtures/generate.js";

export interface E2eFilePayload {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/** `text-10p.pdf` (`tests/fixtures/README.md`): 10 páginas, entidades conocidas. */
export async function textTenPagesFile(): Promise<E2eFilePayload> {
  const bytes = await generateText10p();
  return { name: "text-10p.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}

/** `corrupt.pdf` (`tests/fixtures/README.md`): header %PDF- válido + cuerpo no-PDF. */
export async function corruptFile(): Promise<E2eFilePayload> {
  const bytes = await generateCorrupt();
  return { name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}

/**
 * PDF sintético de `pageCount` páginas con texto neutro (sin entidades), solo
 * para ejercitar el visor virtualizado con un documento largo (bug 3 del
 * scroll — no forma parte de `tests/fixtures/README.md`: es específico de
 * este spec, no un fixture compartido por el resto del Core).
 */
export async function manyNeutralPagesFile(pageCount: number): Promise<E2eFilePayload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Página ${i + 1} sin datos sensibles.`, {
      x: 50,
      y: 750,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await doc.save();
  return {
    name: `many-${pageCount}p.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  };
}
