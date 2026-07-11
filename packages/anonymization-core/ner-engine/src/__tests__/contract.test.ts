import {
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  EventChannel,
  type EngineContext,
  type EntityFound,
  type NerFinished,
  type NerStarted,
  type Unsubscribe,
} from "@anonly/shared";
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
  makeNerPageInput,
  mockTokenClassificationPipeline,
  nerToken,
} from "./fixtures/test-helpers.js";

describe("NerEngine — contract tests", () => {
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

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Ner);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("init() does not load the model (lazy loading)", async () => {
    await engine.init(ctx);
    expect(pipeline).not.toHaveBeenCalled();
    expect(engine.isModelReady()).toBe(false);
  });

  it("processPage() before init() throws EngineNotInitializedError", async () => {
    const input = makeNerPageInput("doc-1", 0, ["Hola"]);
    await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("processPages() before init() throws EngineNotInitializedError", async () => {
    const input = makeNerPageInput("doc-1", 0, ["Hola"]);
    await expect(engine.processPages([input], ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("processPage() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    const input = makeNerPageInput("doc-1", 0, ["Hola"]);
    await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineDisposedError);
  });

  it("emits NER_STARTED before pages", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-started", 0, ["Hola", "mundo"]);
    await engine.processPages([input], ctx);

    const firstCall = busEmitSpy.mock.calls[0];
    expect(firstCall?.[1]).toBe(EngineEvents.NER_STARTED);
    const payload = firstCall?.[2] as NerStarted;
    expect(payload.documentId).toBe("doc-started");
    expect(payload.pageCount).toBe(1);
    expect(payload.modelId).toBe(ctx.config.ner.modelId);
  });

  it("emits NER_MODEL_READY before first ENTITY_FOUND", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "Juan")])),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-order", 0, ["Juan"]);
    await engine.processPages([input], ctx);

    const events = busEmitSpy.mock.calls.map(([, event]) => event);
    const readyIndex = events.indexOf(EngineEvents.NER_MODEL_READY);
    const firstEntityIndex = events.indexOf(EngineEvents.ENTITY_FOUND);
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(firstEntityIndex).toBeGreaterThan(readyIndex);
  });

  it("emits ENTITY_FOUND per occurrence", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0), nerToken("B-ORG", "Acme", 0.9, 2)]),
      ),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-entities", 0, ["Juan", "trabaja", "Acme"]);
    const output = await engine.processPage(input, ctx);

    expect(output.occurrences).toHaveLength(2);
    const entityFoundCalls = busEmitSpy.mock.calls.filter(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCalls).toHaveLength(2);
    expect(entityFoundCalls[0]?.[0]).toBe(EventChannel.Ner);
  });

  it("emits NER_FINISHED after all pages", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-finished", 0, ["Hola"]);
    await engine.processPages([input], ctx);

    const lastCall = busEmitSpy.mock.calls[busEmitSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(EngineEvents.NER_FINISHED);
    const payload = lastCall?.[2] as NerFinished;
    expect(payload.documentId).toBe("doc-finished");
  });

  it('occurrence.source === "ner"', async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "Juan")])),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-source", 0, ["Juan"]);
    await engine.processPage(input, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCall).toBeDefined();
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.occurrence.source).toBe(DetectionSource.NER);
  });

  it("occurrence.entityType ∈ {Person, Organization, Address, Date}", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() =>
        Promise.resolve([
          nerToken("B-PER", "Juan", 0.9, 0),
          nerToken("B-ORG", "Acme", 0.9, 1),
          nerToken("B-LOC", "Madrid", 0.9, 2),
          nerToken("B-DATE", "2024", 0.9, 3),
        ]),
      ),
    );
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = makeNerPageInput("doc-types", 0, ["Juan", "Acme", "Madrid", "2024"]);
    await engine.processPage(input, ctx);

    const entityTypes = busEmitSpy.mock.calls
      .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
      .map((call) => (call[2] as EntityFound).occurrence.entityType);
    const allowed = new Set([
      EntityType.Person,
      EntityType.Organization,
      EntityType.Address,
      EntityType.Date,
    ]);
    expect(entityTypes).toHaveLength(4);
    for (const type of entityTypes) {
      expect(allowed.has(type)).toBe(true);
    }
  });

  it("isModelReady() reflects model load state", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    await engine.init(ctx);
    expect(engine.isModelReady()).toBe(false);

    const input = makeNerPageInput("doc-ready", 0, ["Hola"]);
    await engine.processPage(input, ctx);
    expect(engine.isModelReady()).toBe(true);
  });

  it("getModelId() returns the configured model id", async () => {
    await engine.init(ctx);
    expect(engine.getModelId()).toBe(ctx.config.ner.modelId);
  });

  it("dispose() clears state", async () => {
    await engine.init(ctx);
    await engine.dispose();
    expect(engine["initialized"]).toBe(false);
    expect(engine["disposed"]).toBe(true);
  });

  it("dispose() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.dispose();
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it("dispose() releases the loaded classifier session", async () => {
    const disposeSpy = vi.fn(() => Promise.resolve());
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([]), disposeSpy),
    );
    await engine.init(ctx);
    const input = makeNerPageInput("doc-dispose", 0, ["Hola"]);
    await engine.processPage(input, ctx);
    expect(engine.isModelReady()).toBe(true);

    await engine.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(engine.isModelReady()).toBe(false);
  });

  it("engine never subscribes to the bus", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );
    const onSpy = vi.fn((): Unsubscribe => vi.fn());
    const onceSpy = vi.fn((): Unsubscribe => vi.fn());
    const busCtx = createEngineContext({
      bus: {
        on: onSpy,
        once: onceSpy,
        off: vi.fn(),
        emit: vi.fn(),
        emitAsync: vi.fn(() => Promise.resolve()),
      },
    });

    await engine.init(busCtx);
    const input = makeNerPageInput("doc-no-subscribe", 0, ["Hola"]);
    await engine.processPage(input, busCtx);

    expect(onSpy).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
  });
});
