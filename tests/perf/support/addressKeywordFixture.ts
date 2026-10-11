/**
 * M-D2: el PDF digital (con capa de texto, sin OCR) que lleva las 165 páginas de
 * `addressKeywordSentences.ts`, una oración de prueba por página. Mismo layout que M-D1
 * (`addressHeightFixture.ts`): tres párrafos de texto corrido, el relleno fijo de antes, la oración y el
 * relleno fijo de después, en la escritura de la página. Helvetica estándar de `pdf-lib` (WinAnsi) tiene
 * las vocales con tilde y diéresis en mayúscula, la «Ñ», el signo de grado (U+00B0) y el ordinal
 * masculino (U+00BA). Si una oración tuviera un carácter que la fuente no dibuja, `pdf-lib` lo rechaza al
 * dibujar y la generación falla: es un hallazgo, no se sustituye.
 */

import { WRAP_CHARS, wrapText } from "../../fixtures/generate.js";

import { buildLinesPdf } from "./addressHeightFixture.js";
import { keywordPageParagraphs, type KeywordPage } from "./addressKeywordSentences.js";

/** Renglones de una página: cada párrafo envuelto como texto corrido. */
export function keywordPageLines(page: KeywordPage): ReadonlyArray<ReadonlyArray<string>> {
  return keywordPageParagraphs(page).map((paragraph) => wrapText(paragraph, WRAP_CHARS));
}

/** Un PDF con una página por entrada de `pages`, en ese orden. Determinista. */
export async function buildAddressKeywordPdf(
  pages: ReadonlyArray<KeywordPage>,
): Promise<Uint8Array> {
  return buildLinesPdf(pages.map((page) => keywordPageLines(page)));
}
