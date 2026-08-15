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

import {
  asPipelineMock,
  createEngineContext,
  createTrackingNerPool,
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

  // ADR-074 §1: los tres invariantes que garantizan que fragmentar no puede
  // introducir una fuga. `bbox is the exact envelope of fragments, which
  // never overlap` en NER_Engine.md §14.
  describe("fragments (ADR-074 §1)", () => {
    it("bbox is the exact envelope of fragments, which never overlap", async () => {
      asPipelineMock(pipeline).mockResolvedValue(
        mockTokenClassificationPipeline(() =>
          Promise.resolve([
            nerToken("B-PER", "Albarracin,", 0.9, 0),
            nerToken("I-PER", "Rocio", 0.9, 1),
          ]),
        ),
      );
      await engine.init(ctx);
      const base = makeNerPageInput("doc-fragments-invariant", 0, ["Albarracin,", "Rocio"]);
      const input = {
        ...base,
        words: base.words.map((w, i) => (i === 1 ? { ...w, bbox: { ...w.bbox, y: 130 } } : w)),
      };
      const output = await engine.processPage(input, ctx);

      const fragments = output.occurrences[0]?.fragments ?? [];
      const bbox = output.occurrences[0]?.bbox;
      expect(fragments).toHaveLength(2);
      expect(bbox).toBeDefined();

      // bbox es la envolvente exacta de fragments.
      const minX = Math.min(...fragments.map((f) => f.x));
      const minY = Math.min(...fragments.map((f) => f.y));
      const maxX = Math.max(...fragments.map((f) => f.x + f.width));
      const maxY = Math.max(...fragments.map((f) => f.y + f.height));
      expect(bbox).toEqual({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

      // Los fragmentos no se solapan verticalmente.
      for (let i = 0; i < fragments.length; i++) {
        for (let j = i + 1; j < fragments.length; j++) {
          const a = fragments[i]!;
          const b = fragments[j]!;
          const overlaps = a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlaps).toBe(false);
        }
      }

      // union(fragments) ⊆ bbox: ningún fragmento se sale de la envolvente.
      for (const fragment of fragments) {
        expect(fragment.x).toBeGreaterThanOrEqual(bbox!.x);
        expect(fragment.y).toBeGreaterThanOrEqual(bbox!.y);
        expect(fragment.x + fragment.width).toBeLessThanOrEqual(bbox!.x + bbox!.width);
        expect(fragment.y + fragment.height).toBeLessThanOrEqual(bbox!.y + bbox!.height);
      }
    });
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

  // ─── ADR-046 §2/§4/§5 — puerto interno NerJobPool ───

  it("every dispatch uses maxRetriesOverride: 0", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0)])),
    );

    const pool = createTrackingNerPool();
    const pooledEngine = new NerEngine(pool);
    await pooledEngine.init(ctx);
    await pooledEngine.processPage(makeNerPageInput("doc-max-retries-override", 0, ["Juan"]), ctx);

    expect(pool.calls.length).toBeGreaterThan(0);
    for (const call of pool.calls) {
      expect(call.maxRetriesOverride).toBe(0);
    }

    await pooledEngine.dispose();
  });

  it("same six events, payloads and order with and without injected pool", async () => {
    const classify = (): Promise<ReadonlyArray<ReturnType<typeof nerToken>>> =>
      Promise.resolve([nerToken("B-PER", "Ana", 0.9, 0)]);

    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));
    await engine.init(ctx);
    const busEmitSpyA = vi.spyOn(ctx.bus, "emit");
    await engine.processPages([makeNerPageInput("doc-fallback-parity", 0, ["Ana"])], ctx);
    const eventsA = busEmitSpyA.mock.calls.map((call) => [call[1], call[2]]);

    // El kernel es un singleton a nivel de módulo (ADR-046 §1): sin disponer
    // acá, el segundo engine encontraría el pipeline ya cargado por el
    // primero y nunca reportaría su propio "model-ready" (NER_MODEL_READY no
    // se emitiría para eventsB) — no por una diferencia real de
    // comportamiento entre pool real y fallback, sino por compartir el mismo
    // kernel "tibio" entre dos instancias en el mismo test.
    await engine.dispose();

    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));
    const pool = createTrackingNerPool();
    const pooledEngine = new NerEngine(pool);
    const ctxB = createEngineContext();
    await pooledEngine.init(ctxB);
    const busEmitSpyB = vi.spyOn(ctxB.bus, "emit");
    await pooledEngine.processPages([makeNerPageInput("doc-fallback-parity", 0, ["Ana"])], ctxB);
    const eventsB = busEmitSpyB.mock.calls.map((call) => [call[1], call[2]]);

    // Compara evento a evento (sin el `id` no determinista de la Occurrence
    // ni `durationMs`, que depende de `Date.now()` y no es comparable entre
    // dos ejecuciones reales de principio a fin).
    expect(eventsB.map((e) => e[0])).toEqual(eventsA.map((e) => e[0]));
    const stripNonDeterministic = (value: unknown): unknown => {
      if (typeof value !== "object" || value === null) return value;
      const { durationMs: _durationMs, ...rest } = value as { durationMs?: number };
      if ("occurrence" in rest) {
        const { occurrence, ...withoutOccurrence } = rest as { occurrence: { id: string } };
        const { id: _id, ...occurrenceRest } = occurrence;
        return { ...withoutOccurrence, occurrence: occurrenceRest };
      }
      return rest;
    };
    expect(eventsB.map((e) => stripNonDeterministic(e[1]))).toEqual(
      eventsA.map((e) => stripNonDeterministic(e[1])),
    );

    await pooledEngine.dispose();
  });
});
