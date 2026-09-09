/**
 * PDF mínimo de una página, escrito byte a byte con Helvetica base-14 (sin
 * fuente embebida) y un content stream arbitrario inyectado tal cual.
 *
 * ADR-142, Contexto §2: `pdf-lib` no genera un operador `TJ` con un ajuste de
 * kerning grande dentro del mismo array de glifos — la forma exacta que hace
 * que `getTextContent()` de pdf.js corte un item en dos sin insertar ningún
 * espacio (`compareWithLastPosition` → `flushTextContentItem`, medido contra
 * `pdfjs-dist@4.10.38` real). Por eso estos fixtures no salen del generador
 * del repo: se arman a mano, en memoria, sin tocar el disco.
 */
export function buildMinimalPdf(contentStream: string): ArrayBuffer {
  const objects: string[] = [];
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );
  objects.push(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  const streamBytes = Buffer.from(contentStream, "latin1");
  objects.push(
    `5 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  );

  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const bytes = Buffer.from(pdf, "latin1");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
