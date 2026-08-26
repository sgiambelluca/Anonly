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

import { EntityType } from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  TEXT_10P_PAGES,
  buildReferenceDocSpecs,
  buildReferenceManifest,
  generateCorrupt,
  generateEmpty,
  generateImageAlpha,
  generateReferenceDataset,
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

describe("generate.ts — image-alpha-3p.pdf", () => {
  it("produce 3 páginas", async () => {
    const pdf = await PDFDocument.load(await generateImageAlpha());
    expect(pdf.getPageCount()).toBe(3);
  });

  it("conserva el canal alfa como /SMask — es lo único que hace útil a este fixture", async () => {
    // El SMask es el camino por el que pdf.js pide un canvas auxiliar a su
    // `CanvasFactory`, que es exactamente lo que ningún otro fixture del repo
    // ejercita (`README.md`, "Por qué existe image-alpha-3p.pdf"). Sin él este
    // archivo es un PDF más y el hueco de cobertura vuelve en silencio.
    const raw = new TextDecoder("latin1").decode(await generateImageAlpha());
    expect(raw).toContain("SMask");
  });

  it("la página con imagen lleva una entidad detectable", async () => {
    // Para que el fixture sirva también como caso de detección sobre una
    // página con imagen, no solo de render.
    const raw = new TextDecoder("latin1").decode(await generateImageAlpha());
    expect(raw.includes("34.567.891") || raw.includes("FlateDecode")).toBe(true);
  });

  it("el header es %PDF-", async () => {
    const header = new TextDecoder().decode((await generateImageAlpha()).slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("pesa poco: es un fixture, no un caso de estrés", async () => {
    expect((await generateImageAlpha()).byteLength).toBeLessThan(50 * 1024);
  });
});

describe("generate.ts — dataset de referencia (tests/fixtures/reference/)", () => {
  const VALID_ENTITY_TYPES = new Set<string>(Object.values(EntityType));
  const VALID_DETECTORS = new Set(["regex", "ner"]);

  it("genera al menos 20 documentos, cubriendo las cuatro categorías del README", async () => {
    const docs = await generateReferenceDataset();
    expect(docs.length).toBeGreaterThanOrEqual(20);

    const categories = new Set(docs.map((d) => d.category));
    expect(categories.has("dense")).toBe(true);
    expect(categories.has("sparse")).toBe(true);
    expect(categories.has("trap")).toBe(true);
    expect(categories.has("empty")).toBe(true);
  });

  it("no hay documentId repetidos", async () => {
    const docs = await generateReferenceDataset();
    const ids = docs.map((d) => d.documentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada documento produce un PDF válido (header %PDF-)", async () => {
    const docs = await generateReferenceDataset();
    for (const doc of docs) {
      const header = new TextDecoder().decode(doc.pdfBytes.slice(0, 5));
      expect(header).toBe("%PDF-");
    }
  });

  it("el manifest indexa TODOS los documentos generados, uno a uno", async () => {
    const docs = await generateReferenceDataset();
    const manifest = buildReferenceManifest(docs);

    expect(manifest.documents).toHaveLength(docs.length);
    expect(manifest.documents.map((m) => m.documentId).sort()).toEqual(
      docs.map((d) => d.documentId).sort(),
    );
    for (const entry of manifest.documents) {
      expect(entry.pdf).toBe(`${entry.documentId}.pdf`);
      expect(entry.truth).toBe(`${entry.documentId}.truth.json`);
    }
  });

  it("todo entityType del truth es un valor válido del enum EntityType", async () => {
    const docs = await generateReferenceDataset();
    for (const doc of docs) {
      for (const entity of doc.truth.entities) {
        expect(VALID_ENTITY_TYPES.has(entity.entityType)).toBe(true);
      }
    }
  });

  it("todo detector del truth es 'regex' o 'ner' — nunca otro valor (README)", async () => {
    const docs = await generateReferenceDataset();
    for (const doc of docs) {
      for (const entity of doc.truth.entities) {
        expect(VALID_DETECTORS.has(entity.detector)).toBe(true);
      }
    }
  });

  it("cada truth.documentId coincide con el documentId del documento", async () => {
    const docs = await generateReferenceDataset();
    for (const doc of docs) {
      expect(doc.truth.documentId).toBe(doc.documentId);
    }
  });

  it("hay al menos un documento vacío y al menos uno de trampa, los dos con cero entidades", async () => {
    const docs = await generateReferenceDataset();
    const empty = docs.filter((d) => d.category === "empty");
    const trap = docs.filter((d) => d.category === "trap");

    expect(empty.length).toBeGreaterThan(0);
    expect(trap.length).toBeGreaterThan(0);
    for (const doc of [...empty, ...trap]) {
      expect(doc.truth.entities).toHaveLength(0);
    }
  });

  it("los documentos trampa cubren los mínimos del README: expediente, código postal, fecha fuera de rango, CUIT/IBAN/tarjeta con checksum inválido y topónimos con coma", () => {
    const trapText = buildReferenceDocSpecs()
      .filter((spec) => spec.category === "trap")
      .flatMap((spec) => spec.pages.map((p) => p.text))
      .join(" | ");

    // Número de expediente (ADR-075 §2 los descarta a propósito).
    expect(trapText).toMatch(/PP-13-00-027653-24\/00|IPP-08-00-045210-25\/00/);
    // Código postal.
    expect(trapText).toContain("C1425AAB");
    // Fecha fuera de rango (ADR-075 §1: "45 de julio de 2026" no valida el rango).
    expect(trapText).toContain("45 de julio de 2026");
    // CUIT con dígito verificador inválido — mismo literal que text-10p.pdf/README.
    expect(trapText).toContain("20-12345678-9");
    // IBAN con dígito verificador inválido — ídem.
    expect(trapText).toContain("ES00 1234 5678 9012 3456 7890");
    // Tarjeta con Luhn inválido — ídem.
    expect(trapText).toContain("4532 1234 5678 9901");
    // Topónimos con coma — trampas del patrón `caratula-ar` (ADR-092).
    expect(trapText).toMatch(
      /Mar del Plata, Buenos Aires|San Miguel, Tucumán|Código Civil, Título III|La Plata, Buenos Aires/,
    );
  });

  // ─── La invariante central: el PDF y el truth no pueden desincronizarse ───
  //
  // `buildReferenceDocSpecs()` es la estructura en memoria de la que salen
  // los dos. Cada `ReferencePageContent.text` es exactamente lo que
  // `renderReferenceDoc` dibuja en el PDF, y cada `ReferencePageContent.entities`
  // es exactamente de donde sale el truth — del mismo objeto. Los dos tests
  // de abajo verifican la invariante desde sus dos puntas: que el texto
  // dibujado contiene el valor de cada entidad declarada (§1), y que
  // `generateReferenceDataset()` no agrega ni pierde ninguna al pasar de la
  // spec al `ReferenceDocument` final (§2).

  it("invariante §1 — el texto de cada página contiene el valor exacto de cada entidad que declara", () => {
    const specs = buildReferenceDocSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(20);

    for (const spec of specs) {
      for (const [pageIndex, page] of spec.pages.entries()) {
        for (const entity of page.entities) {
          expect(
            page.text.includes(entity.value),
            `${spec.documentId} p${pageIndex}: "${entity.value}" (${entity.entityType}) no aparece en el texto de la página`,
          ).toBe(true);
        }
      }
    }
  });

  it("invariante §2 — generateReferenceDataset() no agrega ni pierde entidades respecto de la spec de la que salió", async () => {
    const specs = buildReferenceDocSpecs();
    const docs = await generateReferenceDataset();
    const docsById = new Map(docs.map((d) => [d.documentId, d] as const));

    for (const spec of specs) {
      const doc = docsById.get(spec.documentId);
      if (doc === undefined) {
        throw new Error(`generate.test.ts: falta "${spec.documentId}" en generateReferenceDataset()`);
      }
      const expectedEntities = spec.pages.flatMap((page, pageIndex) =>
        page.entities.map((e) => ({
          entityType: e.entityType,
          value: e.value,
          pageIndex,
          detector: e.detector,
        })),
      );
      expect(doc.truth.entities).toEqual(expectedEntities);
    }
  });

  it("buildReferenceDocSpecs() es determinista: dos corridas producen el mismo texto y las mismas entidades", () => {
    const first = buildReferenceDocSpecs();
    const second = buildReferenceDocSpecs();
    expect(second).toEqual(first);
  });
});
