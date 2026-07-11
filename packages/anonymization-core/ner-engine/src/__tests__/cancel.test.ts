/**
 * Cancelación cooperativa (NER_Engine.md §13 caso 10: "aborta en < 200 ms,
 * libera sesión temporal, responde CANCELLED. El modelo cargado no se
 * descarta"). Comportamiento funcional, no el gate de performance real (el
 * SLA estricto se valida en Hito 9/11 con un pool real, ADR-021 §1) — este
 * test usa timers reales (no vi.useFakeTimers) para ejercitar el mecanismo
 * de principio a fin: Promise.race contra AbortSignal dentro de
 * classifyWithTimeout (ner.engine.ts), mismo patrón que
 * ocr-engine/src/ocr.engine.ts (recognizeWithTimeout).
 */
import { CancelledError, type EngineContext } from "@anonly/shared";
import { pipeline } from "@xenova/transformers";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import { NerEngine } from "../ner.engine.js";

import {
  asPipelineMock,
  createEngineContext,
  createMockConfig,
  makeNerPageInput,
  mockTokenClassificationPipeline,
} from "./fixtures/test-helpers.js";

describe("NerEngine — cancellation", () => {
  let engine: NerEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new NerEngine();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  // Caso 10 (§13): cancelación a mitad de página.
  it("cancel within 200ms", async () => {
    const abortController = new AbortController();
    // batchSize=1 fuerza varios lotes (uno por palabra): el checkpoint entre
    // batches solo importa si hay más de uno en vuelo.
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: true,
      },
    });
    const ctx: EngineContext = createEngineContext({ abortSignal: abortController.signal, config });

    // classify() nunca resuelve por sí sola: el único camino de salida es el
    // abort de abortSignal, escuchado vía Promise.race dentro de
    // classifyWithTimeout.
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => new Promise(() => {})),
    );

    await engine.init(ctx);
    const input = makeNerPageInput("doc-cancel-sla", 0, ["Juan", "Pérez", "vive", "en", "Madrid"]);

    const startedAt = Date.now();
    const resultPromise = engine.processPage(input, ctx);
    setTimeout(() => abortController.abort(), 20);

    await expect(resultPromise).rejects.toThrow(CancelledError);
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeLessThan(200);
  });

  it("cancel before any batch starts throws CancelledError immediately", async () => {
    const abortController = new AbortController();
    const ctx = createEngineContext({ abortSignal: abortController.signal });
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    abortController.abort();

    await engine.init(ctx);
    const input = makeNerPageInput("doc-cancel-early", 0, ["Hola"]);

    const startedAt = Date.now();
    await expect(engine.processPage(input, ctx)).rejects.toThrow(CancelledError);
    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("model remains loaded (not discarded) after a cancellation", async () => {
    const abortController = new AbortController();
    const ctx = createEngineContext({ abortSignal: abortController.signal });
    let callCount = 0;
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise(() => {});
        }
        return Promise.resolve([]);
      }),
    );

    await engine.init(ctx);
    const input = makeNerPageInput("doc-cancel-keep-model", 0, ["Hola"]);
    const resultPromise = engine.processPage(input, ctx);
    setTimeout(() => abortController.abort(), 20);
    await expect(resultPromise).rejects.toThrow(CancelledError);

    // Caso 10 (§13): "el modelo cargado no se descarta" — isModelReady()
    // sigue en true tras la cancelación (el classifier no se libera; solo
    // dispose() lo hace).
    expect(engine.isModelReady()).toBe(true);

    // Una nueva llamada con un AbortController fresco reutiliza el modelo ya
    // cargado (pipeline() no se vuelve a invocar).
    const freshCtx = createEngineContext();
    const secondInput = makeNerPageInput("doc-cancel-keep-model", 1, ["Chau"]);
    await engine.processPage(secondInput, freshCtx);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });
});
