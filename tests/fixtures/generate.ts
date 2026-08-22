/**
 * Generador de fixtures (PDFs de prueba) para los tests del Core de Anonly.
 *
 * Fuente de verdad: tests/fixtures/README.md
 *
 * Uso:
 *   pnpm tsx tests/fixtures/generate.ts
 *
 * Genera:
 *   - text-10p.pdf  (10 páginas, texto con entidades conocidas para Regex/NER/Grouping)
 *   - empty.pdf     (1 página sin contenido; pdf-lib no permite 0 páginas)
 *   - corrupt.pdf   (header %PDF- válido + cuerpo no-PDF determinista)
 *
 * No genera (requieren tools externos):
 *   - protected.pdf (qpdf --encrypt; documentado en README)
 *   - scanned-10p.pdf (pdftoppm + pdf-lib; Hito 3 OCR)
 *   - text-50p.pdf, huge-1000p.pdf, mixed-30p.pdf (hitos posteriores)
 *
 * Reglas:
 *   - Sin datos personales reales. Todos los valores son sintéticos.
 *   - Reproducible: misma ejecución → mismo contenido semántico.
 *   - El contenido de text-10p.pdf coincide con la tabla de "Contenido conocido"
 *     en tests/fixtures/README.md. Si cambia el texto, actualizar el README.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/*
 * Layout de `text-10p.pdf`. Exportado porque `tests/e2e/support/fixtures.ts`
 * arma variantes del mismo documento en memoria y tiene que renderizar
 * idénticas las páginas que no toca: hasta acá replicaba estos seis valores
 * y `wrapText`, de modo que un cambio de layout podía desincronizar las
 * variantes sin que nada fallara. El borde de import entre los dos módulos
 * ya existía (ese archivo importa `TEXT_10P_PAGES` de acá).
 */
export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN_X = 50;
export const MARGIN_Y = 750;
export const FONT_SIZE = 12;
export const LINE_HEIGHT = 18;
/** Corte de línea de `text-10p.pdf`, en caracteres. */
export const WRAP_CHARS = 95;

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Detección de entry point portable (no depende de `import.meta.main` ni
 * `isMainModule` que no está tipado en todas las versiones de @types/node).
 * Compara la URL del módulo actual con el primer argumento de process.argv.
 */
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

/**
 * Contenido de text-10p.pdf.
 * Debe coincidir con la tabla de "Contenido conocido" en tests/fixtures/README.md.
 * Fuente: docs/core/PDF_Engine.md §13 + docs/roadmap/MVP.md §11.2.
 */
export const TEXT_10P_PAGES: ReadonlyArray<string> = [
  "Juan Pérez vive en Belgrano 1234, DNI 34.567.891, CUIT 20-12345678-9, teléfono +54 11 1234-5678, email juan.perez@example.com.",
  "María Gómez, DNI 18.445.212, trabaja en Empresa S.A. con sede en Rivadavia 455.",
  "Carlos López, DNI 42.998.103, IBAN ES00 1234 5678 9012 3456 7890, tarjeta 4532 1234 5678 9901.",
  "Página 4 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 5 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 6 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 7 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 8 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 9 sin datos sensibles — texto neutro para tests de no-false-positives.",
  "Página 10 sin datos sensibles — texto neutro para tests de no-false-positives.",
];

export async function generateText10p(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const text of TEXT_10P_PAGES) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // Wrap manual por línea (sin word-wrap automático de pdf-lib).
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

  return doc.save();
}

/**
 * PNG mínimo **con canal alfa**, en bytes literales.
 *
 * El alfa es el punto: `pdf-lib` lo embebe como un **SMask**, y el SMask es
 * uno de los caminos por los que pdf.js pide un canvas auxiliar a su
 * `CanvasFactory`. Ese es exactamente el camino que ningún fixture del repo
 * ejercitaba, y por el que un defecto real —pdf.js tocando `document` dentro
 * de un Worker— convivió con 57 tests de unidad en verde mientras cualquier
 * PDF con imágenes fallaba entero (`roadmap/Post_Hito10.8_Pendientes.md` §21).
 *
 * Literal y no generado: son 8×8 px, y una dependencia nueva para dibujarlo
 * necesitaría ADR (R-12) por un fixture de 100 bytes.
 */
const ALPHA_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAPUlEQVR42mNkYPhfz0AEYBxVSF" +
  "+FjIwMDP+JUcjIyMjwn0iFjIyMDP+JVMjIyMjwn0iFjIyMDP+JVAgAtxwT8g8JYckAAAAASUVO" +
  "RK5CYII=";

/**
 * Fixture con **imagen con transparencia** — el camino que ningún otro
 * fixture toca (ver `ALPHA_PNG_BASE64`).
 *
 * Tres páginas, cada una ejercitando algo distinto del mismo camino:
 *
 * 1. La imagen con alfa sola (SMask).
 * 2. La imagen con alfa **más** texto encima, que es la forma en que aparece
 *    en un documento real (un logo o un sello sobre el que sigue habiendo
 *    contenido).
 * 3. Rectángulos con `opacity` superpuestos, que es el otro camino que pide
 *    canvas auxiliares.
 *
 * El texto de la página 2 lleva una entidad detectable a propósito: sirve
 * para que el fixture valga también como caso de detección sobre una página
 * con imagen, no solo de render.
 */
export async function generateImageAlpha(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(Buffer.from(ALPHA_PNG_BASE64, "base64"));

  const imageOnly = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  imageOnly.drawImage(png, { x: 200, y: 500, width: 180, height: 180 });

  const imageAndText = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  imageAndText.drawImage(png, { x: 60, y: 600, width: 120, height: 120 });
  imageAndText.drawText("Juan Perez, DNI 34.567.891, sobre una pagina con imagen.", {
    x: MARGIN_X,
    y: MARGIN_Y,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });

  const translucent = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  translucent.drawRectangle({
    x: 120,
    y: 400,
    width: 240,
    height: 200,
    color: rgb(0.2, 0.4, 0.9),
    opacity: 0.5,
  });
  translucent.drawRectangle({
    x: 220,
    y: 300,
    width: 240,
    height: 200,
    color: rgb(0.9, 0.3, 0.2),
    opacity: 0.5,
  });

  return doc.save();
}

export async function generateEmpty(): Promise<Uint8Array> {
  // "empty.pdf" = PDF con 1 página sin contenido (sin texto dibujado, sin
  // /Contents). pdf-lib no permite generar PDFs con 0 páginas (doc.save()
  // falla), así que el nombre es histórico: representa una página "vacía"
  // desde el punto de vista del extractor de texto. El PDF Engine (Hito 2)
  // detectará esta página como textlessPages-compatible.
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

export async function generateCorrupt(): Promise<Uint8Array> {
  // Header "%PDF-1.4\n" válido + cuerpo no-PDF determinista (200 bytes de 0x41).
  // Suficiente para que PDF.js detecte header pero falle al parsear.
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(200).fill(0x41);
  const result = new Uint8Array(header.length + body.length);
  result.set(header, 0);
  result.set(body, header.length);
  return result;
}

/**
 * Wrap manual: corta el texto en líneas de ~95 chars respetando espacios.
 * Suficiente para fixtures deterministas; no es un word-wrap real.
 *
 * Exportado por el mismo motivo que las constantes de layout de arriba.
 */
export function wrapText(text: string, maxCharsPerLine: number): ReadonlyArray<string> {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

async function main(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const text10p = await generateText10p();
  await writeFile(resolve(FIXTURE_DIR, "text-10p.pdf"), text10p);

  const empty = await generateEmpty();
  await writeFile(resolve(FIXTURE_DIR, "empty.pdf"), empty);

  const imageAlpha = await generateImageAlpha();
  await writeFile(resolve(FIXTURE_DIR, "image-alpha-3p.pdf"), imageAlpha);

  const corrupt = await generateCorrupt();
  await writeFile(resolve(FIXTURE_DIR, "corrupt.pdf"), corrupt);

  // Reporte por stdout (no console.error, no es un motor del Core).
  process.stdout.write(
    `Fixtures generados en ${FIXTURE_DIR}:\n` +
      `  - text-10p.pdf (${text10p.byteLength} bytes, 10 páginas)\n` +
      `  - image-alpha-3p.pdf (${imageAlpha.byteLength} bytes, 3 páginas con imagen alfa y transparencias)\n` +
      `  - empty.pdf (${empty.byteLength} bytes, 1 página sin contenido)\n` +
      `  - corrupt.pdf (${corrupt.byteLength} bytes, header %PDF- + cuerpo no-PDF)\n` +
      `\n` +
      `Pendientes (requieren tools externos):\n` +
      `  - protected.pdf: qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf\n`,
  );
}

// Solo ejecutar main() cuando se corre como script (`tsx generate.ts`),
// no cuando se importa (test). Detección: si el módulo es el entry point.
if (isMainModule()) {
  await main();
}
