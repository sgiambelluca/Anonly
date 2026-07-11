import {
  CancelledError,
  EngineEvents,
  EntityType,
  EventChannel,
  type EngineContext,
  type EntityFound,
  type NerFinished,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import { NerEngine } from "../ner.engine.js";
import { NerPageFailedError } from "../ner.errors.js";

import {
  asPipelineMock,
  createEngineContext,
  createMockConfig,
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
} from "./fixtures/test-helpers.js";

describe("NerEngine — unit tests", () => {
  let engine: NerEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new NerEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("confidence ∈ [0,1] (promedio de los scores de los tokens del span)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.8, 0), nerToken("I-PER", "Pérez", 0.6, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-confidence", 0, ["Juan", "Pérez"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    const confidence = output.occurrences[0]?.confidence ?? -1;
    expect(confidence).toBeCloseTo(0.7, 5);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("bbox mapped correctly to words (unión de las Word que componen la entidad)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("I-PER", "Pérez", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-bbox", 0, ["Juan", "Pérez", "vive", "en", "Madrid"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    const occurrence = output.occurrences[0];
    const words = input.words;
    const wordJuan = words[0];
    const wordPerez = words[1];
    expect(wordJuan).toBeDefined();
    expect(wordPerez).toBeDefined();
    if (wordJuan === undefined || wordPerez === undefined) throw new Error("unreachable");

    const expectedX = Math.min(wordJuan.bbox.x, wordPerez.bbox.x);
    const expectedY = Math.min(wordJuan.bbox.y, wordPerez.bbox.y);
    const expectedRight = Math.max(
      wordJuan.bbox.x + wordJuan.bbox.width,
      wordPerez.bbox.x + wordPerez.bbox.width,
    );

    expect(occurrence?.bbox.x).toBe(expectedX);
    expect(occurrence?.bbox.y).toBe(expectedY);
    expect(occurrence?.bbox.width).toBe(expectedRight - expectedX);
    expect(occurrence?.wordSpan).toEqual({ startIndex: 0, endIndexExclusive: 2 });
  });

  it("normalizedValue is lowercase and strips redundant punctuation", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-ORG", "ACME,", 0.9, 0)])),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-normalize", 0, ["ACME,", "S.A."]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("ACME,");
    expect(output.occurrences[0]?.normalizedValue).toBe("acme");
  });

  it("strips wordpiece continuation markers ('##') when reconstructing offsets", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Gonz", 0.9, 0), nerToken("I-PER", "##alez", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-wordpiece", 0, ["Gonzalez", "trabaja", "aqui"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Gonzalez");
    expect(output.occurrences[0]?.entityType).toBe(EntityType.Person);
  });

  it("ignores unsupported labels (e.g. MISC) without crashing", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-MISC", "Mundial", 0.9, 0), nerToken("B-PER", "Juan", 0.9, 1)]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-unsupported-label", 0, ["Mundial", "Juan"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Juan");
  });

  it("discards tokens whose decoded word cannot be located in the chunk text", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([
          nerToken("B-PER", "Inexistente", 0.9, 0),
          nerToken("B-ORG", "Acme", 0.9, 1),
        ]),
      ),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-unmappable-token", 0, ["Acme"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(1);
    expect(output.occurrences[0]?.value).toBe("Acme");
  });

  it("tolerates a malformed classifier response by treating it as empty", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      // @ts-expect-error — se simula deliberadamente una respuesta con forma
      // inesperada (string en vez de array) para ejercitar el guard de
      // runtime isTokenClassificationOutput.
      mockTokenClassificationPipeline(() => Promise.resolve("not-an-array")),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-malformed-response", 0, ["Hola"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toEqual([]);
  });

  it("splits a page into multiple batches when batchSize < word count", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 2,
        enabled: true,
      },
    });
    const batchedCtx = createEngineContext({ config });

    const classify = vi.fn((text: string) => {
      if (text === "Juan Pérez") {
        return Promise.resolve([
          nerToken("B-PER", "Juan", 0.9, 0),
          nerToken("I-PER", "Pérez", 0.9, 1),
        ]);
      }
      if (text === "trabaja en") {
        return Promise.resolve([]);
      }
      if (text === "Acme") {
        return Promise.resolve([nerToken("B-ORG", "Acme", 0.9, 0)]);
      }
      return Promise.resolve([]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(batchedCtx);
    const input = makeNerPageInput("doc-multi-batch", 0, [
      "Juan",
      "Pérez",
      "trabaja",
      "en",
      "Acme",
    ]);
    const output = await engine.processPage(input, batchedCtx);

    // 5 palabras, batchSize 2 -> 3 lotes ("Juan Pérez" | "trabaja en" | "Acme").
    expect(classify).toHaveBeenCalledTimes(3);
    expect(output.occurrences).toHaveLength(2);
    expect(output.occurrences.map((o) => o.value).sort()).toEqual(["Acme", "Juan Pérez"]);

    // La entidad del tercer lote ("Acme") debe mapear al Word correcto (índice
    // 4 de la página completa), no al offset relativo del lote — verifica que
    // runInferenceInBatches suma chunk.startIndex correctamente.
    const acmeOccurrence = output.occurrences.find((o) => o.value === "Acme");
    expect(acmeOccurrence?.wordSpan).toEqual({ startIndex: 4, endIndexExclusive: 5 });
  });

  it("retries once on NerTimeoutError and then throws NerPageFailedError", async () => {
    vi.useFakeTimers();
    try {
      const classify = vi.fn(() => new Promise<never>(() => {})); // nunca resuelve -> siempre timeout
      asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

      const config = createMockConfig({
        ner: {
          modelId: "test-model",
          quantization: "q8",
          confidenceThreshold: 0.7,
          batchSize: 256,
          enabled: true,
        },
      });
      const timeoutCtx = createEngineContext({ config });
      await engine.init(timeoutCtx);

      const input = makeNerPageInput("doc-timeout", 0, ["Hola", "mundo"]);
      const resultPromise = engine.processPage(input, timeoutCtx);
      const caught = resultPromise.catch((err: unknown) => err);

      // timeout default 20000ms, maxRetries default 1 -> 2 intentos totales.
      await vi.advanceTimersByTimeAsync(20001);
      await vi.advanceTimersByTimeAsync(20001);

      const err = await caught;
      expect(err).toBeInstanceOf(NerPageFailedError);
      expect(classify).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("processPages continues with remaining pages after one page fails", async () => {
    let callIndex = 0;
    const classify = vi.fn(() => {
      callIndex++;
      if (callIndex === 1) {
        return Promise.reject(new Error("fallo de inferencia"));
      }
      return Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0)]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const warnSpy = vi.spyOn(ctx.logger, "warn");
    const inputs = [
      makeNerPageInput("doc-partial-failure", 0, ["Hola"]),
      makeNerPageInput("doc-partial-failure", 1, ["Ana"]),
    ];

    const outputs = await engine.processPages(inputs, ctx);

    // Página 0 falló (descartada); página 1 se procesó con éxito.
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.pageIndex).toBe(1);
    expect(outputs[0]?.occurrences).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();

    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_FINISHED,
    );
    expect((finishedCall?.[2] as NerFinished).occurrenceCount).toBe(1);
  });

  it("processPages rethrows NerModelMissingError instead of continuing", async () => {
    asPipelineMock(pipeline).mockRejectedValue(new Error("modelo no disponible"));

    await engine.init(ctx);
    const inputs = [
      makeNerPageInput("doc-model-missing-batch", 0, ["Hola"]),
      makeNerPageInput("doc-model-missing-batch", 1, ["Chau"]),
    ];

    await expect(engine.processPages(inputs, ctx)).rejects.toThrow(/no se pudo cargar/i);
    // El modelo solo se intenta cargar una vez (para la primera página); la
    // segunda página nunca se procesa porque el error aborta todo el batch.
    expect(pipeline).toHaveBeenCalledTimes(2); // intento inicial + 1 re-descarga
  });

  it("processPages handles an empty inputs array", async () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    await engine.init(ctx);
    const outputs = await engine.processPages([], ctx);

    expect(outputs).toEqual([]);
    expect(pipeline).not.toHaveBeenCalled();

    const startedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_STARTED,
    );
    expect(startedCall).toBeDefined();
    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.NER_FINISHED,
    );
    expect((finishedCall?.[2] as NerFinished).occurrenceCount).toBe(0);
  });

  describe("NER_STARTED modelLoading flag (ADR-024 §1)", () => {
    it("NER_STARTED includes modelLoading=true on first run", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([makeNerPageInput("doc-model-first", 0, ["Hola"])], ctx);

      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ner,
        EngineEvents.NER_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
    });

    it("NER_STARTED omits modelLoading once the model is already loaded", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() => Promise.resolve([])),
      );
      await engine.init(ctx);
      await engine.processPages([makeNerPageInput("doc-model-warm", 0, ["Hola"])], ctx);

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([makeNerPageInput("doc-model-warm", 1, ["Chau"])], ctx);

      expect(busEmitSpy).not.toHaveBeenCalledWith(
        EventChannel.Ner,
        EngineEvents.NER_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
    });
  });

  it("getModelId() before init() falls back to the documented default model", () => {
    const freshEngine = new NerEngine();
    expect(freshEngine.getModelId()).toBe("Xenova/bert-base-multilingual-cased-ner-hrl");
  });

  it("non-q8 quantization is requested as unquantized (library limitation, documented)", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "f32",
        confidenceThreshold: 0.7,
        batchSize: 256,
        enabled: true,
      },
    });
    const f32Ctx = createEngineContext({ config });
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    await engine.init(f32Ctx);
    const input = makeNerPageInput("doc-f32", 0, ["Hola"]);
    await engine.processPage(input, f32Ctx);

    expect(pipeline).toHaveBeenCalledWith(
      "token-classification",
      "test-model",
      expect.objectContaining({ dtype: "fp32" }),
    );
  });

  it("cancellation during a later batch still throws CancelledError", async () => {
    const config = createMockConfig({
      ner: {
        modelId: "test-model",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: true,
      },
    });
    const abortController = new AbortController();
    const abortedCtx = createEngineContext({ abortSignal: abortController.signal, config });

    let calls = 0;
    const classify = vi.fn(() => {
      calls++;
      if (calls === 2) {
        abortController.abort();
      }
      return Promise.resolve([]);
    });
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    await engine.init(abortedCtx);
    const input = makeNerPageInput("doc-cancel-later-batch", 0, ["Uno", "Dos", "Tres"]);

    await expect(engine.processPage(input, abortedCtx)).rejects.toThrow(CancelledError);
    // El tercer lote nunca se llega a clasificar: el checkpoint corta el loop
    // apenas se detecta el abort, antes de invocar el tercer batch.
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("ENTITY_FOUND payload carries the full occurrence with expected shape", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-LOC", "Rosario", 0.77, 0)]),
      ),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-payload-shape", 0, ["Rosario"]);
    await engine.processPage(input, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([channel, event]) => channel === EventChannel.Ner && event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCall).toBeDefined();
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.documentId).toBe("doc-payload-shape");
    expect(payload.occurrence.entityType).toBe(EntityType.Address);
    expect(payload.occurrence.confidence).toBeCloseTo(0.77, 5);
    expect(typeof payload.occurrence.id).toBe("string");
    expect(payload.occurrence.id.length).toBeGreaterThan(0);
  });
});
