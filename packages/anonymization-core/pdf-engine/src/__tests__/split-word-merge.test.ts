/**
 * ADR-142 — una palabra partida entre dos items de pdf.js sigue siendo una
 * palabra, contra `PdfEngine.process` real (sin mocks de `getDocument` ni de
 * `getTextContent`; los fixtures son PDFs hechos a mano — ver
 * `fixtures/raw-pdf.ts` para el porqué).
 *
 * `Post_Hito10.8_Pendientes.md` §24 atribuía la fuga del sello de
 * notificación a un origen mal reportado. Reproducido contra el motor real,
 * el origen estaba bien: lo que faltaba era esta regla. La tabla de la
 * sección "Contexto §2" del ADR está reproducida acá fila por fila, medida
 * contra `pdfjs-dist@4.10.38` del repo.
 */
import type { EngineContext } from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { PdfEngine } from "../pdf.engine.js";

import { buildMinimalPdf } from "./fixtures/raw-pdf.js";
import { createEngineContext } from "./fixtures/test-helpers.js";

describe("PdfEngine — palabra partida entre items adyacentes (ADR-142)", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) await engine.dispose();
  });

  async function wordsOf(contentStream: string): Promise<ReadonlyArray<{ text: string }>> {
    const buffer = buildMinimalPdf(contentStream);
    await engine.init(ctx);
    const output = await engine.process({ documentId: "adr-142", buffer }, ctx);
    return output.document.pages[0]!.words;
  }

  function textsOf(words: ReadonlyArray<{ text: string }>): ReadonlyArray<string> {
    return words.map((w) => w.text);
  }

  it("un kerning grande que pdf.js corta en dos items reconstituye la palabra completa", async () => {
    // ADR-142, Contexto §2, fila 1: -4,8 pt entre "N" y "otificado a JUAN
    // PEREZ" — pdf.js devuelve DOS items sin espacio sintetizado.
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n[(N) 400 (otificado a JUAN PEREZ)] TJ\nET",
    );
    expect(textsOf(words)).toEqual(["Notificado", "a", "JUAN", "PEREZ"]);
  });

  it("es el caso que motivó el ADR: un nombre no queda partido en dos fragmentos sin detectar", async () => {
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n[(N) 400 (otificado electronicamente a JUAN PEREZ)] TJ\nET",
    );
    expect(textsOf(words)).toEqual(["Notificado", "electronicamente", "a", "JUAN", "PEREZ"]);
    // Ningún fragmento suelto: ni "N" solo ni "otificado..." solo sobreviven.
    expect(words.some((w) => w.text === "N")).toBe(false);
    expect(words.some((w) => w.text.startsWith("otificado"))).toBe(false);
  });

  it("un kerning chico, que pdf.js NO corta, sigue tokenizando igual que antes", async () => {
    // ADR-142, Contexto §2, fila 2: -0,72 pt, un solo item multi-token — el
    // camino existente de ADR-097/102, sin pasar por el empalme nuevo.
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n[(N) 60 (otificado a JUAN PEREZ)] TJ\nET",
    );
    expect(textsOf(words)).toEqual(["Notificado", "a", "JUAN", "PEREZ"]);
  });

  it("tres items partiendo la misma palabra se pliegan de a pares (transitividad)", async () => {
    const words = await wordsOf("BT\n/F1 12 Tf\n100 700 Td\n[(N) 400 (o) 400 (tificado)] TJ\nET");
    expect(textsOf(words)).toEqual(["Notificado"]);
  });

  it("la caja fusionada envuelve a los dos fragmentos", async () => {
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n[(N) 400 (otificado a JUAN PEREZ)] TJ\nET",
    );
    const notificado = words.find((w) => w.text === "Notificado") as
      | { readonly bbox: { readonly x: number; readonly width: number } }
      | undefined;
    expect(notificado).toBeDefined();
    // "N" se dibuja en x=100 con 8,664 pt de ancho (AFM de Helvetica 12pt) y
    // es el fragmento más a la izquierda acá: la envolvente arranca en su
    // origen y es más ancha que "N" sola — cubre también a "otificado".
    expect(notificado!.bbox.x).toBeCloseTo(100, 5);
    expect(notificado!.bbox.width).toBeGreaterThan(8.664);
  });

  it("dos palabras distintas, pegadas por el mismo kerning y sin espacio real, se fusionan mal a propósito (ADR-142, Consecuencias)", async () => {
    // Fila 4 del ADR: el productor no dejó ninguna diferencia observable
    // entre esto y una palabra partida — el peor caso aceptado es tapar de
    // más, nunca de menos.
    const words = await wordsOf("BT\n/F1 12 Tf\n100 700 Td\n[(JUAN) 400 (PEREZ)] TJ\nET");
    expect(textsOf(words)).toEqual(["JUANPEREZ"]);
  });

  it("cuando pdf.js ya sintetiza el espacio real (kerning positivo), no hay empalme que hacer", async () => {
    // Fila 5 del ADR: +4,8 pt — pdf.js devuelve un único item "JUAN PEREZ",
    // ya correctamente separado por el camino existente.
    const words = await wordsOf("BT\n/F1 12 Tf\n100 700 Td\n[(JUAN) -400 (PEREZ)] TJ\nET");
    expect(textsOf(words)).toEqual(["JUAN", "PEREZ"]);
  });

  it("dos items glifo-adyacentes en líneas distintas no se empalman (condición 5)", async () => {
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n(N) Tj\nET\nBT\n/F1 12 Tf\n100 650 Td\n(otificado) Tj\nET",
    );
    expect(textsOf(words)).toEqual(["N", "otificado"]);
  });

  it("un espacio real entre dos items (item en blanco) no se confunde con una palabra partida", async () => {
    // Un espacio ordinario entre palabras separadas por un `Td` normal: sigue
    // dando dos Word, como siempre.
    const words = await wordsOf(
      "BT\n/F1 12 Tf\n100 700 Td\n(Notificado) Tj\n60 0 Td\n(JUAN) Tj\nET",
    );
    expect(textsOf(words)).toEqual(["Notificado", "JUAN"]);
  });
});
