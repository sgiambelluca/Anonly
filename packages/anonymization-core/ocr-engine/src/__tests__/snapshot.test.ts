/**
 * `snapshot.test.ts` — ADR-160 §1/§6: "el corpus... tiene que dar
 * idéntico... cualquier diferencia es un defecto de la conversión, no una
 * degradación aceptable" (mismo criterio que ADR-158 §6). No hay dos
 * kernels para comparar en vivo — el que decodificaba la página completa en
 * el camino común ya no existe —, así que el snapshot ES la referencia
 * congelada: `words`/`confidence` de una entrada determinista, fijados la
 * primera vez que este archivo corrió contra el kernel de ADR-160.
 * Cualquier cambio futuro que los mueva tiene que revisarse a mano
 * (`vitest -u` solo si el cambio es intencional).
 */
import type { EngineContext } from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  // ADR-112 §1 / ADR-119 §1: el kernel lee estos dos a nivel de módulo, así
  // que el doble tiene que traerlos o la evaluación del import falla.
  PSM: { AUTO: "3", SPARSE_TEXT: "11" },
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
}));

import { OcrEngine } from "../ocr.engine.js";
import type { OcrImageProducer } from "../ocr.types.js";

import {
  createEncodedPageImage,
  createEngineContext,
  createValidOcrPageInput,
  createValidOcrPageRequest,
  mockDetectData,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
  setStubDecodedPixel,
} from "./fixtures/test-helpers.js";

describe("OcrEngine — snapshot (ADR-160 §1/§6)", () => {
  let engine: OcrEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new OcrEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("words and confidence are identical to the pre-ADR kernel for the same PNG", async () => {
    /*
     * PNG es sin pérdida (ADR-158 §2): los bytes que llegan al core con el
     * camino nuevo son bit a bit los mismos que producía `convertToBlob()`
     * con el camino viejo. Este mock modela exactamente esa premisa — no
     * distingue `Blob` de `OffscreenCanvas`, solo responde con datos fijos
     * —, así que el resultado depende únicamente de que el KERNEL siga
     * mapeando esos datos de la misma forma que antes de ADR-160.
     */
    const CUERPO = [
      { text: "Pérez", confidence: 91.5, bbox: { x0: 12, y0: 8, x1: 52, y1: 24 } },
      { text: "34.567.891", confidence: 88.2, bbox: { x0: 60, y0: 8, x1: 98, y1: 24 } },
    ];
    const detect = vi.fn((_image: unknown) => Promise.resolve(mockDetectData(0)));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockRecognizeData(CUERPO, 89.8), { detect }),
    );

    await engine.init(ctx);
    const output = await engine.processPage(
      { ...createValidOcrPageInput("doc-snapshot", 0), image: createEncodedPageImage(100, 40) },
      ctx,
    );

    // `durationMs` es reloj de pared, no parte de lo que este test fija
    // (words/confidence) — incluirlo haría el snapshot no determinista.
    expect(typeof output.durationMs).toBe("number");
    const { durationMs: _durationMs, ...comparable } = output;
    expect(comparable).toMatchSnapshot();
  });

  it("active strips preserve ADR-121 words, confidence, bboxes and fusion", async () => {
    const BODY = [{ text: "cuerpo", confidence: 95, bbox: { x0: 60, y0: 10, x1: 90, y1: 22 } }];
    const recognize = vi.fn(() =>
      Promise.resolve({ jobId: "j", data: mockRecognizeData(BODY, 95) }),
    );
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockRecognizeData(BODY, 95), { recognize }),
    );
    await engine.init(ctx);
    const output = await engine.processPage(
      { ...createValidOcrPageInput("doc-162-active", 0), image: createEncodedPageImage(100, 40) },
      ctx,
    );
    const { durationMs: _durationMs, ...comparable } = output;
    expect(comparable).toMatchSnapshot();
  });

  // OCR_Engine.md §13 caso 33 / §14 (ADR-164): una sesión con las cuatro
  // orientaciones 0/90/180/270, una de ellas producida con demora (página
  // "tardía") y con el mecanismo de margen del ADR-121 ejecutándose para las
  // cuatro (blanco/transparente: aporta 0 palabras, el caso normal — la
  // recuperación de una franja con contenido real ya tiene su propio test,
  // caso 16/25). Sirve como control congelado de que palabras, confianza,
  // orden y cajas no se mueven entre orientaciones mezcladas, con transporte
  // PNG sin transferencia (ADR-158 §5) y processSession (ventana/presupuesto
  // de §6, degenerados acá a un único consumidor para que el orden de
  // llegada sea determinista).
  it("preserves words confidence and geometry for mixed page orientations", async () => {
    setStubDecodedPixel([255, 255, 255, 255]); // ADR-162: franjas blancas -> 0 llamadas de margen

    const orientationsByRequestIndex = [0, 90, 180, 270] as const;
    let detectCallIndex = 0;
    const detect = vi.fn(() =>
      Promise.resolve(mockDetectData(orientationsByRequestIndex[detectCallIndex++] ?? 0)),
    );

    const wordsByRequestIndex = [
      [{ text: "upright-word", confidence: 91, bbox: { x0: 5, y0: 5, x1: 40, y1: 20 } }],
      [{ text: "ninety-word", confidence: 88, bbox: { x0: 6, y0: 6, x1: 42, y1: 21 } }],
      [{ text: "upside-down-word", confidence: 93, bbox: { x0: 7, y0: 7, x1: 44, y1: 22 } }],
      [{ text: "two-seventy-word", confidence: 85, bbox: { x0: 8, y0: 8, x1: 46, y1: 23 } }],
    ];
    let recognizeCallIndex = 0;
    const recognize = vi.fn(() => {
      const idx = recognizeCallIndex++;
      return Promise.resolve({
        jobId: `mock-job-${idx}`,
        data: mockRecognizeData(wordsByRequestIndex[idx] ?? []),
      });
    });

    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockEmptyRecognizeData(), { detect, recognize }),
    );

    // Un solo consumidor (ocrPoolSize: 1): el orden de llegada a detect()/
    // recognize() queda determinado por el orden del array de requests, así
    // que la demora de la página 270° ("tardía") no reordena nada — ejercita
    // que una página rotada que llega después sigue geometrizándose bien, sin
    // reintroducir el no-determinismo de la concurrencia real (esa la cubren
    // los casos 34-38).
    const serialCtx = createEngineContext({
      config: { ...ctx.config, workerPool: { ...ctx.config.workerPool, ocrPoolSize: 1 } },
    });
    const requests = [
      createValidOcrPageRequest("doc-mixed-orientations", 0),
      createValidOcrPageRequest("doc-mixed-orientations", 1),
      createValidOcrPageRequest("doc-mixed-orientations", 2),
      createValidOcrPageRequest("doc-mixed-orientations", 3),
    ];
    const produce: OcrImageProducer = (request) =>
      new Promise((resolve) => {
        const delayMs = request.pageIndex === 3 ? 15 : 0;
        setTimeout(() => resolve(createEncodedPageImage(100, 40)), delayMs);
      });

    await engine.init(serialCtx);
    const outputs = await engine.processSession(requests, produce, serialCtx);

    const comparable = outputs.map(({ documentId, pageIndex, words, confidence }) => ({
      documentId,
      pageIndex,
      words,
      confidence,
    }));
    expect(comparable).toMatchSnapshot();
  });
});
