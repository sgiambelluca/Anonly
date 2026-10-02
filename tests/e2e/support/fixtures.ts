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

const T5_ORIENTATION_PAGE_WIDTH = 595;
const T5_ORIENTATION_PAGE_HEIGHT = 842;
const T5_ORIENTATION_FONT_SIZE = 18;
const T5_ORIENTATION_LINE_BASELINE = 790;
const T5_ORIENTATION_FIELDS = [
  "DNI 34.567.891 Nombre Marina Suarez domicilio Belgrano 1234",
  "DNI 18.445.212 Nombre Alberto Gomez domicilio Rivadavia 2345",
  "DNI 42.998.103 Nombre Lucia Fernandez domicilio Moreno 3456",
  "DNI 34.567.891 Nombre Marina Suarez domicilio Belgrano 1234",
  "DNI 18.445.212 Nombre Alberto Gomez domicilio Rivadavia 2345",
] as const;
const T5_ORIENTATION_ROTATIONS = [0, 90, 180, 0, 270] as const;

export interface T5OrientationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface T5OrientationGroundTruthPage {
  readonly pageIndex: number;
  readonly rotation: (typeof T5_ORIENTATION_ROTATIONS)[number];
  /** Convención de BoundingBox: la inversa del giro físico del raster. */
  readonly expectedOcrRotation: (typeof T5_ORIENTATION_ROTATIONS)[number];
  readonly expectedText: string;
  readonly expectedEntityValue: string;
  readonly expectedEntities: ReadonlyArray<string>;
  /** Coordenadas en el PDF ya girado, independientes del OCR. */
  readonly sensitiveRegions: ReadonlyArray<T5OrientationRect>;
  /** Texto neutro fuera de todas las regiones sensibles. */
  readonly externalRegion: T5OrientationRect;
}

function rotateT5Rect(
  rect: T5OrientationRect,
  rotation: (typeof T5_ORIENTATION_ROTATIONS)[number],
): T5OrientationRect {
  if (rotation === 0) return rect;
  if (rotation === 90) {
    return {
      x: T5_ORIENTATION_PAGE_HEIGHT - (rect.y + rect.height),
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  if (rotation === 180) {
    return {
      x: T5_ORIENTATION_PAGE_WIDTH - (rect.x + rect.width),
      y: T5_ORIENTATION_PAGE_HEIGHT - (rect.y + rect.height),
      width: rect.width,
      height: rect.height,
    };
  }
  return {
    x: rect.y,
    y: T5_ORIENTATION_PAGE_WIDTH - (rect.x + rect.width),
    width: rect.height,
    height: rect.width,
  };
}

/** `text-10p.pdf` (`tests/fixtures/README.md`): 10 páginas, entidades conocidas. */
export async function textTenPagesFile(): Promise<E2eFilePayload> {
  const bytes = await generateText10p();
  return { name: "text-10p.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}

/** Cinco páginas OCR con rotaciones físicas 0/90/180/0/270; el helper de
 * rasterización se ejecuta en el browser del E2E y no usa `/Rotate`. */
export async function t5PixelOrientationSourceFile(): Promise<E2eFilePayload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [pageIndex, field] of T5_ORIENTATION_FIELDS.entries()) {
    const page = doc.addPage([T5_ORIENTATION_PAGE_WIDTH, T5_ORIENTATION_PAGE_HEIGHT]);
    for (let line = 0; line < 18; line += 1) {
      page.drawText(`${field} linea ${line + 1}`, {
        x: 36,
        y: T5_ORIENTATION_LINE_BASELINE - line * 40,
        size: T5_ORIENTATION_FONT_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
    }
    page.drawText(`Pagina sintetica ${pageIndex + 1}`, {
      x: 36,
      y: 40,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await doc.save();
  return {
    name: "t5-orientation-source.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  };
}

/** Ground truth geométrico del mismo fixture, construido desde el texto fuente. */
export async function t5PixelOrientationGroundTruth(): Promise<
  ReadonlyArray<T5OrientationGroundTruthPage>
> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return T5_ORIENTATION_FIELDS.map((field, pageIndex) => {
    const rotation = T5_ORIENTATION_ROTATIONS[pageIndex] ?? 0;
    const sensitiveValue = field.slice("DNI ".length, "DNI ".length + 10);
    const sensitiveX = 36 + font.widthOfTextAtSize("DNI ", T5_ORIENTATION_FONT_SIZE);
    const sensitiveWidth = font.widthOfTextAtSize(sensitiveValue, T5_ORIENTATION_FONT_SIZE);
    const sensitiveRegions = Array.from({ length: 18 }, (_, line) =>
      rotateT5Rect(
        {
          x: sensitiveX,
          y:
            T5_ORIENTATION_PAGE_HEIGHT -
            (T5_ORIENTATION_LINE_BASELINE - line * 40 + T5_ORIENTATION_FONT_SIZE),
          width: sensitiveWidth,
          height: T5_ORIENTATION_FONT_SIZE + 2,
        },
        rotation,
      ),
    );
    return {
      pageIndex,
      rotation,
      expectedOcrRotation: rotation === 90 ? 270 : rotation === 270 ? 90 : rotation,
      expectedText: field,
      expectedEntityValue: sensitiveValue,
      expectedEntities: [sensitiveValue.replaceAll(".", "")],
      sensitiveRegions,
      externalRegion: rotateT5Rect({ x: 36, y: 784, width: 190, height: 24 }, rotation),
    };
  });
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
