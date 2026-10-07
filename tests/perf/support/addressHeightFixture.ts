/**
 * M-D1: el PDF digital (con capa de texto, sin OCR) que lleva las oraciones de `addressHeightSentences.ts`,
 * una oración de prueba por página. Cada página tiene tres párrafos de texto corrido, en este orden: el
 * relleno fijo de antes, la oración y el relleno fijo de después. Si una oración no entra en un renglón
 * se parte en renglones como cualquier texto corrido; no se acorta. Layout de `tests/fixtures/generate.ts`
 * (Helvetica, 12 pt, A4), el mismo de los documentos de texto de las demás campañas.
 *
 * Helvetica estándar de `pdf-lib` usa la codificación WinAnsi: tiene las tildes, la eñe, el signo de
 * grado (U+00B0) y el ordinal masculino (U+00BA). Si una oración tuviera un carácter que la fuente no
 * dibuja, `pdf-lib` lo rechaza al dibujar y la generación falla: es un hallazgo, no se sustituye.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  FONT_SIZE,
  LINE_HEIGHT,
  MARGIN_X,
  MARGIN_Y,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  WRAP_CHARS,
  wrapText,
} from "../../fixtures/generate.js";

import {
  FILLER_AFTER,
  FILLER_BEFORE,
  type AddressHeightSentence,
} from "./addressHeightSentences.js";

/** Los tres párrafos de la página de una oración, en orden de lectura. */
export function pageParagraphs(sentence: AddressHeightSentence): ReadonlyArray<string> {
  return [FILLER_BEFORE, sentence.text, FILLER_AFTER];
}

/** Renglones de una página: cada párrafo envuelto como texto corrido. */
export function pageLines(sentence: AddressHeightSentence): ReadonlyArray<ReadonlyArray<string>> {
  return pageParagraphs(sentence).map((paragraph) => wrapText(paragraph, WRAP_CHARS));
}

/** Un PDF con una página por oración, en el orden de `sentences`. Determinista. */
export async function buildAddressHeightPdf(
  sentences: ReadonlyArray<AddressHeightSentence>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fixedDate = new Date("2026-01-01T00:00:00.000Z");
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const sentence of sentences) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = MARGIN_Y;
    for (const paragraph of pageLines(sentence)) {
      for (const line of paragraph) {
        page.drawText(line, { x: MARGIN_X, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
        y -= LINE_HEIGHT;
      }
      // Un renglón en blanco entre párrafos.
      y -= LINE_HEIGHT;
    }
  }
  return doc.save();
}
