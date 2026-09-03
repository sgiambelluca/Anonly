/**
 * ADR-097 sobre un PDF **real**, con `pdfjs-dist` sin mockear.
 *
 * **Por qué este archivo existe aparte**: el resto de la suite del motor
 * mockea `getDocument` y le da glifos inventados, así que puede verificar la
 * aritmética pero no que los avances que pdf.js reporta de verdad sean los de
 * la fuente. Acá el fixture se lee del disco y las posiciones se contrastan
 * contra las **métricas AFM de Helvetica**, calculadas a mano — el único
 * oráculo que no sale del mismo código que se está probando.
 *
 * **Por qué el oráculo no es `tests/fixtures/generate.ts`**: ese archivo
 * dibuja la línea entera con un solo `drawText` en `x = 50`. Su
 * `font.widthOfTextAtSize` nunca toca el archivo — solo predice dónde va a
 * caer cada palabra, y su predicción difiere de la AFM canónica (ADR-097,
 * Contexto §5). Las posiciones reales de la tinta las determina el renderer
 * aplicando las métricas de la fuente.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EngineContext, Word } from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { PdfEngine } from "../pdf.engine.js";

import { createEngineContext } from "./fixtures/test-helpers.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const QA_STAMP = resolve(REPO_ROOT, "tests/fixtures/qa-stamp.pdf");

/*
 * Anchos de Helvetica en unidades de glifo (1/1000 em), de la AFM canónica.
 * Solo los caracteres que usa la línea 2 del cuerpo del fixture.
 */
const HELVETICA: Readonly<Record<string, number>> = {
  " ": 278,
  ",": 278,
  ".": 278,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  B: 667,
  D: 722,
  E: 667,
  I: 278,
  J: 500,
  N: 722,
  P: 667,
  a: 556,
  c: 500,
  d: 556,
  e: 556,
  g: 556,
  i: 222,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  r: 333,
  t: 278,
  u: 556,
  v: 500,
  z: 500,
  é: 556,
};

const FONT_SIZE = 12;
const MARGIN_X = 50;
const LINE = "El actor, Juan Pérez, DNI 34.567.891, con domicilio en Belgrano 1234, promueve";

/** Ancho AFM de un texto, en puntos. Lanza ante un carácter no tabulado. */
function afmWidth(text: string): number {
  let units = 0;
  for (const ch of text) {
    const w = HELVETICA[ch];
    if (w === undefined) throw new Error(`Carácter fuera de la tabla AFM: ${JSON.stringify(ch)}`);
    units += w;
  }
  return (units / 1000) * FONT_SIZE;
}

describe("PdfEngine — avances reales sobre un PDF de verdad (ADR-097)", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) await engine.dispose();
  });

  async function wordsOfFirstPage(): Promise<ReadonlyArray<Word>> {
    const buffer = (await readFile(QA_STAMP)).buffer as ArrayBuffer;
    await engine.init(ctx);
    const output = await engine.process({ documentId: "qa-stamp-097", buffer }, ctx);
    return output.document.pages[0]!.words;
  }

  it("ubica cada palabra de la línea en su posición AFM exacta", async () => {
    const words = await wordsOfFirstPage();

    /*
     * La línea 2 del cuerpo es un solo `TextItem` de 78 caracteres: todas sus
     * palabras salvo la primera caen en el MEDIO del item, que es el único
     * caso que el ancho promedio dañaba (ADR-097, Contexto §1).
     */
    for (const match of LINE.matchAll(/\S+/g)) {
      const token = match[0];
      const esperadoX = MARGIN_X + afmWidth(LINE.slice(0, match.index));
      const esperadoAncho = afmWidth(token);

      const word = words.find(
        (w) => w.text === token && Math.abs(w.bbox.x - esperadoX) < 1 && w.bbox.y > 0,
      );
      expect(word, `sin Word para ${JSON.stringify(token)} cerca de x=${esperadoX}`).toBeDefined();
      expect(word!.bbox.x).toBeCloseTo(esperadoX, 2);
      expect(word!.bbox.width).toBeCloseTo(esperadoAncho, 2);
    }
  });

  it("cubre el primer glifo de `Juan`, que es lo que se veía en el export", async () => {
    /*
     * La fuga concreta del gate (`Post_Hito10.8_Pendientes.md` §23e): la caja
     * arrancaba 8,25 pt a la derecha del primer glifo y la `J` —6,0 pt— más
     * parte de la `u` quedaban a la vista como `Ju[HOMBRE 01]`.
     */
    const words = await wordsOfFirstPage();
    const inicioReal = MARGIN_X + afmWidth("El actor, ");
    const juan = words.find((w) => w.text === "Juan" && Math.abs(w.bbox.x - inicioReal) < 1);

    expect(juan).toBeDefined();
    expect(juan!.bbox.x).toBeLessThanOrEqual(inicioReal + 0.01);
    // El prorrateo la ponía acá; es el valor que este test tiene que excluir.
    expect(juan!.bbox.x).toBeLessThan(105);
  });
});
