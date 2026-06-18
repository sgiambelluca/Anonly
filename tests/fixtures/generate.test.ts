/**
 * Tests del generador de fixtures.
 *
 * Valida que las funciones exportadas de generate.ts producen PDFs correctos
 * con el contenido conocido documentado en tests/fixtures/README.md.
 *
 * No lee archivos commiteados (esos se validan en CI cuando se commitean).
 * En su lugar, ejecuta las funciones generadoras y valida el output en memoria.
 * Esto permite correr el test sin depender de que los fixtures estén commiteados.
 */

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  TEXT_10P_PAGES,
  generateCorrupt,
  generateEmpty,
  generateText10p,
} from "./generate.js";

/**
 * Helper para acceder a un índice con la garantía de que existe.
 * Lanza si el índice está fuera de rango (lo cual sería un bug del script,
 * no del test).
 */
function at<T>(arr: ReadonlyArray<T>, index: number, label: string): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`generate.test.ts: ${label} fuera de rango (índice ${index})`);
  }
  return value;
}

describe("generate.ts — text-10p.pdf", () => {
  it("produce 10 páginas", async () => {
    const bytes = await generateText10p();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(10);
  });

  it("el header es %PDF-", async () => {
    const bytes = await generateText10p();
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("el peso es menor a 500 KB (fixture liviano)", async () => {
    const bytes = await generateText10p();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeLessThan(500_000);
  });

  it("la primera página contiene 'Juan Pérez' (texto conocido p0)", () => {
    const p0 = at(TEXT_10P_PAGES, 0, "TEXT_10P_PAGES[0]");
    expect(p0).toContain("Juan Pérez");
    expect(p0).toContain("DNI 34.567.891");
  });

  it("las páginas 3-9 son texto neutro (sin entidades para tests de no-false-positives)", () => {
    for (let i = 3; i < 10; i++) {
      const text = at(TEXT_10P_PAGES, i, `TEXT_10P_PAGES[${i}]`);
      // No debe contener DNIs, CUITs, emails, etc.
      expect(text).not.toMatch(/\bDNI\b/);
      expect(text).not.toMatch(/\bCUIT\b/);
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/\d{2}\.\d{3}\.\d{3}/);
    }
  });

  it("las páginas 0-2 contienen las entidades esperadas para Grouping", () => {
    const p0 = at(TEXT_10P_PAGES, 0, "TEXT_10P_PAGES[0]");
    const p1 = at(TEXT_10P_PAGES, 1, "TEXT_10P_PAGES[1]");
    const p2 = at(TEXT_10P_PAGES, 2, "TEXT_10P_PAGES[2]");

    expect(p0).toContain("Juan Pérez");
    expect(p0).toContain("34.567.891");
    expect(p0).toContain("20-12345678-9");
    expect(p1).toContain("María Gómez");
    expect(p1).toContain("18.445.212");
    expect(p2).toContain("Carlos López");
    expect(p2).toContain("42.998.103");
  });
});

describe("generate.ts — empty.pdf", () => {
  it("produce 1 página sin contenido (textlessPages-compatible)", async () => {
    const bytes = await generateEmpty();
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});

describe("generate.ts — corrupt.pdf", () => {
  it("tiene header %PDF- pero el cuerpo es determinista no-PDF (no es un PDF válido)", async () => {
    const bytes = await generateCorrupt();
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    // El fixture es un PDF "falso" para que el PDF Engine (PDF.js) rechace en
    // su parsing. pdf-lib es tolerante y parsea cualquier cosa con header %PDF-,
    // por lo que este test NO valida con pdf-lib — el test real es en el PDF
    // Engine (Hito 2) usando PDF.js que es más estricto.
    // Validamos que el cuerpo NO contiene un marcador de PDF válido.
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    expect(text).not.toContain("%%EOF");
  });
});
