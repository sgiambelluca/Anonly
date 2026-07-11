import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EntityType,
  InvalidInputError,
  type EngineContext,
  type EntityFound,
  type NerModelLoading,
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
import { NerModelMissingError } from "../ner.errors.js";

import {
  asPipelineMock,
  createEngineContext,
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
} from "./fixtures/test-helpers.js";

describe("NerEngine — edge case tests", () => {
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

  // Caso 1 (§13): texto vacío.
  describe("Caso 1: texto vacío", () => {
    it("empty text returns empty occurrences", async () => {
      await engine.init(ctx);
      const input = makeNerPageInput("doc-empty-text", 0, [], { text: "" });
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toEqual([]);
      expect(pipeline).not.toHaveBeenCalled();
    });
  });

  // Caso 2 (§13): texto sin entidades.
  describe("Caso 2: texto sin entidades", () => {
    it("text without entities returns empty", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("O", "El"),
            nerToken("O", "cielo"),
            nerToken("O", "es"),
            nerToken("O", "azul"),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-no-entities", 0, ["El", "cielo", "es", "azul"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toEqual([]);
    });
  });

  // Caso 3 (§13): nombre compuesto ("Juan Pérez García").
  describe("Caso 3: nombre compuesto", () => {
    it("multi-word name produces single occurrence", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Juan", 0.95, 0),
            nerToken("I-PER", "Pérez", 0.93, 1),
            nerToken("I-PER", "García", 0.9, 2),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-compound-name", 0, ["Juan", "Pérez", "García"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toHaveLength(1);
      expect(output.occurrences[0]?.entityType).toBe(EntityType.Person);
      expect(output.occurrences[0]?.value).toBe("Juan Pérez García");
    });
  });

  // Caso 5 (§13): confidence baja (< 0.7).
  describe("Caso 5: confidence baja", () => {
    it("low confidence still emitted with real value", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([nerToken("B-ORG", "Acme", 0.42, 0)]),
        ),
      );
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const input = makeNerPageInput("doc-low-confidence", 0, ["Acme"]);
      const output = await engine.processPage(input, ctx);

      expect(output.occurrences).toHaveLength(1);
      const occurrence = output.occurrences[0];
      expect(occurrence?.confidence).toBeCloseTo(0.42, 5);
      expect(occurrence?.value).toBe("Acme");

      // La ocurrencia se emite igual (Grouping es quien marca low_confidence).
      const entityFoundCall = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCall).toBeDefined();
      expect((entityFoundCall?.[2] as EntityFound).occurrence.confidence).toBeLessThan(0.7);
    });
  });

  // Caso 7 (§13): modelo no descargado (primera vez), progreso reportado.
  describe("Caso 7: modelo no descargado (primera vez)", () => {
    it("model loading progress reported", async () => {
      asPipelineMock(pipeline).mockImplementation((_task, _model, options) => {
        options?.progress_callback?.({ status: "initiate" });
        options?.progress_callback?.({ status: "download" });
        options?.progress_callback?.({ status: "progress", progress: 25, loaded: 25, total: 100 });
        options?.progress_callback?.({
          status: "progress",
          progress: 100,
          loaded: 100,
          total: 100,
        });
        options?.progress_callback?.({ status: "done" });
        return Promise.resolve(mockTokenClassificationPipeline(() => Promise.resolve([])));
      });

      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const input = makeNerPageInput("doc-loading", 0, ["Hola"]);
      await engine.processPage(input, ctx);

      const loadingCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.NER_MODEL_LOADING,
      );
      expect(loadingCalls).toHaveLength(2);
      const progresses = loadingCalls.map((call) => (call[2] as NerModelLoading).progress);
      expect(progresses).toEqual([0.25, 1]);

      const readyCall = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.NER_MODEL_READY,
      );
      expect(readyCall).toBeDefined();
    });
  });

  // Caso 8 (§13): modelo corrupto en cache.
  describe("Caso 8: modelo corrupto en cache", () => {
    it("corrupt model triggers re-download", async () => {
      const mocked = asPipelineMock(pipeline);
      mocked.mockRejectedValueOnce(new Error("modelo corrupto (checksum inválido)"));
      mocked.mockResolvedValueOnce(mockTokenClassificationPipeline(() => Promise.resolve([])));

      await engine.init(ctx);
      const input = makeNerPageInput("doc-corrupt-model", 0, ["Hola"]);
      const output = await engine.processPage(input, ctx);

      expect(pipeline).toHaveBeenCalledTimes(2);
      expect(output.occurrences).toEqual([]);
      expect(engine.isModelReady()).toBe(true);
    });

    it("persistent load failure escalates to NerModelMissingError", async () => {
      asPipelineMock(pipeline).mockRejectedValue(new Error("modelo corrupto (checksum inválido)"));

      await engine.init(ctx);
      const input = makeNerPageInput("doc-model-missing", 0, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(NerModelMissingError);
      expect(pipeline).toHaveBeenCalledTimes(2);
    });
  });

  // Caso 11 (§13): NER desactivado en settings.
  describe("Caso 11: NER desactivado en settings", () => {
    it("disabled NER returns empty occurrences without loading model", async () => {
      const disabledCtx = createEngineContext({
        config: { ...ctx.config, ner: { ...ctx.config.ner, enabled: false } },
      });
      await engine.init(disabledCtx);
      const input = makeNerPageInput("doc-disabled", 0, ["Juan", "Pérez"]);
      const output = await engine.processPage(input, disabledCtx);

      expect(output.occurrences).toEqual([]);
      expect(pipeline).not.toHaveBeenCalled();
      expect(engine.isModelReady()).toBe(false);
    });
  });

  // Caso 15 (§13, ADR-023 §2): fecha escrita en palabras.
  describe("Caso 15: fecha escrita en palabras", () => {
    it("written-out date mapped to Date", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-DATE", "3", 0.88, 0),
            nerToken("I-DATE", "de", 0.87, 1),
            nerToken("I-DATE", "mayo", 0.9, 2),
            nerToken("I-DATE", "de", 0.86, 3),
            nerToken("I-DATE", "2024", 0.91, 4),
          ]),
        ),
      );
      await engine.init(ctx);
      const input = makeNerPageInput("doc-written-date", 0, [
        "Firmado",
        "el",
        "3",
        "de",
        "mayo",
        "de",
        "2024",
        "en",
        "Buenos",
        "Aires.",
      ]);
      const output = await engine.processPage(input, ctx);

      const dateOccurrence = output.occurrences.find((o) => o.entityType === EntityType.Date);
      expect(dateOccurrence).toBeDefined();
      expect(dateOccurrence?.value).toBe("3 de mayo de 2024");
    });
  });

  // Caso 13 (§13): processPage tras dispose.
  describe("Caso 13: processPage tras dispose", () => {
    it("throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const input = makeNerPageInput("doc-after-dispose", 0, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineDisposedError);
    });

    it("processPages also throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const inputs = [makeNerPageInput("doc-after-dispose-2", 0, ["Hola"])];
      await expect(engine.processPages(inputs, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: input null/undefined).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input in processPage", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPage(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError for null inputs in processPages", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPages(null, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: pageIndex >= 0).
  describe("pageIndex inválido", () => {
    it("throws InvalidInputError for negative pageIndex", async () => {
      await engine.init(ctx);
      const input = makeNerPageInput("doc-neg-idx", -1, ["Hola"]);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (cancelación cooperativa por checkpoint; el SLA
  // estricto < 200ms funcional se cubre en cancel.test.ts).
  describe("Cancelación cooperativa (checkpoint)", () => {
    it("throws CancelledError when abort is signalled before processing starts", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(abortedCtx);
      const input = makeNerPageInput("doc-cancelled", 0, ["Hola"]);
      await expect(engine.processPage(input, abortedCtx)).rejects.toThrow(CancelledError);
      expect(pipeline).not.toHaveBeenCalled();
    });

    it("stops processing remaining pages once aborted mid-batch", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });

      // El propio classify() de la página 0 dispara el abort como efecto
      // colateral, simulando una cancelación del usuario a mitad de proceso.
      const classify = vi.fn(() => {
        abortController.abort();
        return Promise.resolve([]);
      });
      asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

      await engine.init(abortedCtx);
      const inputs = [
        makeNerPageInput("doc-cancel-mid", 0, ["Hola"]),
        makeNerPageInput("doc-cancel-mid", 1, ["Chau"]),
      ];

      await expect(engine.processPages(inputs, abortedCtx)).rejects.toThrow(CancelledError);
      expect(classify).toHaveBeenCalledTimes(1);
    });
  });
});
