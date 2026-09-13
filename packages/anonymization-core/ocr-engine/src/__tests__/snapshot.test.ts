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

import {
  createEncodedPageImage,
  createEngineContext,
  createValidOcrPageInput,
  mockDetectData,
  mockRecognizeData,
  mockTesseractWorker,
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
});
