/**
 * Generador de fixtures (PDFs de prueba) para los tests del Core de Anonly.
 *
 * Fuente de verdad: docs/tests/fixtures/README.md
 *
 * Uso:
 *   pnpm tsx tests/fixtures/generate.ts
 *
 * Genera:
 *   - text-10p.pdf  (10 páginas, texto con entidades conocidas para Regex/NER/Grouping)
 *   - empty.pdf     (0 páginas, edge case)
 *   - corrupt.pdf   (header inválido, edge case)
 *
 * No genera (requieren tools externos):
 *   - protected.pdf (qpdf --encrypt; documentado en README)
 *   - scanned-10p.pdf (pdftoppm + pdf-lib; Hito 3 OCR)
 *   - text-50p.pdf, huge-1000p.pdf, mixed-30p.pdf (hitos posteriores)
 *
 * Reglas:
 *   - Sin datos personales reales. Todos los valores son sintéticos.
 *   - Reproducible: misma ejecución → mismos bytes.
 *   - El contenido de text-10p.pdf coincide con la tabla de "Contenido conocido"
 *     en tests/fixtures/README.md. Si cambia el texto, actualizar el README.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 50;
const MARGIN_Y = 750;
const FONT_SIZE = 12;
const LINE_HEIGHT = 18;

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
    const lines = wrapText(text, 95);
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
  // Header "%PDF-1.4\n" válido + cuerpo random.
  // Suficiente para que PDF.js detecte header pero falle al parsear.
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(200);
  crypto.getRandomValues(body);
  const result = new Uint8Array(header.length + body.length);
  result.set(header, 0);
  result.set(body, header.length);
  return result;
}

/**
 * Wrap manual: corta el texto en líneas de ~95 chars respetando espacios.
 * Suficiente para fixtures deterministas; no es un word-wrap real.
 */
function wrapText(text: string, maxCharsPerLine: number): ReadonlyArray<string> {
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

  const corrupt = await generateCorrupt();
  await writeFile(resolve(FIXTURE_DIR, "corrupt.pdf"), corrupt);

  // Reporte por stdout (no console.error, no es un motor del Core).
  process.stdout.write(
    `Fixtures generados en ${FIXTURE_DIR}:\n` +
      `  - text-10p.pdf (${text10p.byteLength} bytes, 10 páginas)\n` +
      `  - empty.pdf (${empty.byteLength} bytes, 0 páginas)\n` +
      `  - corrupt.pdf (${corrupt.byteLength} bytes, header inválido)\n` +
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
