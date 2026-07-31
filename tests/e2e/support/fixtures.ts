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

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { generateCorrupt, generateText10p } from "../../fixtures/generate.js";

export interface E2eFilePayload {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");

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
 * `protected.pdf` (`tests/fixtures/README.md`, ADR-048 §7 punto 1): único
 * fixture binario commiteado de este PR — pdf-lib no implementa encriptación,
 * así que no se arma en memoria como el resto de este archivo. Generado una
 * única vez con `qpdf --encrypt test1234 test1234 256 -- text-10p.pdf
 * protected.pdf` (ver el comentario de cabecera de
 * `scenario-3-protected-pdf.spec.ts` para el detalle). Password: "test1234".
 */
export async function protectedFile(): Promise<E2eFilePayload> {
  const buffer = await readFile(resolve(FIXTURES_DIR, "protected.pdf"));
  return { name: "protected.pdf", mimeType: "application/pdf", buffer };
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
