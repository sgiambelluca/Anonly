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

import {
  FONT_SIZE,
  generateCorrupt,
  generateText10p,
  LINE_HEIGHT,
  MARGIN_X,
  MARGIN_Y,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TEXT_10P_PAGES,
  wrapText,
  WRAP_CHARS,
} from "../../fixtures/generate.js";

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

// Dos páginas neutras de `TEXT_10P_PAGES` (índices 3 y 4 — "Página 4"/"Página
// 5 sin datos sensibles…") se reemplazan por una oración limpia con un
// nombre de persona inequívoco cada una. Dos candidatos, no uno, para no
// depender de que el modelo cuantizado reconozca un nombre puntual: la
// oración de la página 1 ("Juan Pérez vive en Belgrano 1234, DNI…") está
// confirmada empíricamente (dos corridas, ver docblock de
// `scenario-9-ner-runtime-reanalyze.spec.ts`) como no reconocida por el
// modelo en este fixture — el nombre queda pegado a una lista de otras
// entidades en la misma oración. Acá cada nombre va solo, en una oración
// corta sin otros datos alrededor, para maximizar la chance de que el
// modelo lo etiquete B-PER/I-PER. Las páginas con los tres DNI (índices 0-2,
// de las que depende el resto de cada escenario) no se tocan.
const PERSON_PAGE_INDEX_A = 3;
const PERSON_PAGE_INDEX_B = 4;
const PERSON_SENTENCE_A =
  "El informe fue redactado por Marina Suárez, coordinadora del área legal.";
const PERSON_SENTENCE_B =
  "La reunión fue presidida por Alberto Gutiérrez, director general de la institución.";

/**
 * Variante de `text-10p.pdf` para el E2E de ADR-055 §6 ("al menos una
 * entidad NER de tipo Persona llega al panel de Entidades"): mismo
 * contenido que `TEXT_10P_PAGES` — mismos tres DNI en las páginas 1-3, de
 * los que depende el resto del escenario elegido — salvo dos páginas
 * neutras (4 y 5) reemplazadas por `PERSON_SENTENCE_A`/`PERSON_SENTENCE_B`.
 * Se arma enteramente en memoria, igual que el resto de este archivo: no se
 * toca `tests/fixtures/generate.ts` ni se commitea ningún binario nuevo.
 */
export async function textTenPagesWithPersonFile(): Promise<E2eFilePayload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const pages = TEXT_10P_PAGES.map((text, index) => {
    if (index === PERSON_PAGE_INDEX_A) return PERSON_SENTENCE_A;
    if (index === PERSON_PAGE_INDEX_B) return PERSON_SENTENCE_B;
    return text;
  });

  for (const text of pages) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const lines = wrapText(text, WRAP_CHARS);
    let y = MARGIN_Y;
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN_X,
        y,
        size: FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
      y -= LINE_HEIGHT;
    }
  }

  const bytes = await doc.save();
  return {
    name: "text-10p-person.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  };
}
