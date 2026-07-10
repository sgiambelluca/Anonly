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
  type RegexFinished,
  type Unsubscribe,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { RegexEngine } from "../regex.engine.js";

import { createEngineContext, makeSinglePageDocument } from "./fixtures/test-helpers.js";

describe("RegexEngine — contract tests", () => {
  let engine: RegexEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new RegexEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Regex);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("process() before init() throws EngineNotInitializedError", async () => {
    const document = makeSinglePageDocument("doc-1", ["Hola", "mundo."]);
    await expect(engine.process({ document }, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("process() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    const document = makeSinglePageDocument("doc-1", ["Hola"]);
    await expect(engine.process({ document }, ctx)).rejects.toThrow(EngineDisposedError);
  });

  it("emits ENTITY_FOUND per match", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-entities", [
      "DNI",
      "34.567.891",
      "email",
      "ana@example.com",
    ]);
    const output = await engine.process({ document }, ctx);

    expect(output.occurrenceCount).toBe(2);
    const entityFoundCalls = busEmitSpy.mock.calls.filter(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCalls).toHaveLength(2);
    expect(entityFoundCalls[0]?.[0]).toBe(EventChannel.Regex);
  });

  it("emits REGEX_FINISHED after all pages", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-finished", ["DNI", "34.567.891"]);
    const output = await engine.process({ document }, ctx);

    expect(busEmitSpy).toHaveBeenCalledWith(
      EventChannel.Regex,
      EngineEvents.REGEX_FINISHED,
      expect.objectContaining({
        documentId: "doc-finished",
        occurrenceCount: output.occurrenceCount,
      }),
    );
    // REGEX_FINISHED es la última emisión (todos los ENTITY_FOUND salen antes).
    const lastCall = busEmitSpy.mock.calls[busEmitSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(EngineEvents.REGEX_FINISHED);
  });

  it('occurrence.source === "regex"', async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-source", ["DNI", "34.567.891"]);
    await engine.process({ document }, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCall).toBeDefined();
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.occurrence.source).toBe(DetectionSource.Regex);
  });

  it("occurrence.confidence === 1.0", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-confidence", ["DNI", "34.567.891"]);
    await engine.process({ document }, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.occurrence.confidence).toBe(1.0);
  });

  it("RegexFinished payload matches RegexEngineOutput", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-payload-shape", ["DNI", "34.567.891"]);
    const output = await engine.process({ document }, ctx);

    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.REGEX_FINISHED,
    );
    const payload = finishedCall?.[2] as RegexFinished;
    expect(payload.documentId).toBe(output.documentId);
    expect(payload.occurrenceCount).toBe(output.occurrenceCount);
    expect(payload.durationMs).toBe(output.durationMs);
  });

  it("addPattern adds a custom pattern that process() picks up", async () => {
    await engine.init(ctx);
    engine.addPattern({
      id: "custom-code",
      entityType: EntityType.Custom,
      pattern: /\bCODE-\d{4}\b/g,
      normalizer: (v: string) => v.toUpperCase(),
      maskFormat: "CODE-XXXX",
    });

    const document = makeSinglePageDocument("doc-custom", ["Referencia", "CODE-1234"]);
    const output = await engine.process({ document }, ctx);
    expect(output.occurrenceCount).toBe(1);
  });

  it("removePattern stops applying a previously added custom pattern", async () => {
    await engine.init(ctx);
    engine.addPattern({
      id: "custom-code",
      entityType: EntityType.Custom,
      pattern: /\bCODE-\d{4}\b/g,
      normalizer: (v: string) => v.toUpperCase(),
      maskFormat: "CODE-XXXX",
    });
    engine.removePattern("custom-code");

    const document = makeSinglePageDocument("doc-custom-removed", ["CODE-1234"]);
    const output = await engine.process({ document }, ctx);
    expect(output.occurrenceCount).toBe(0);
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

  it("engine never subscribes to the bus", async () => {
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
    const document = makeSinglePageDocument("doc-no-subscribe", ["Hola"]);
    await engine.process({ document }, busCtx);

    expect(onSpy).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
  });
});
