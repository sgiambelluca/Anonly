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

  describe("findLiteral (ADR-061 §1)", () => {
    it('findLiteral emits ENTITY_FOUND with source "manual" and correct bbox', async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-find-literal", ["Contacto:", "Ana", "Gómez"]);
      const output = await engine.findLiteral(
        { document, value: "Ana Gómez", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(1);
      const entityFoundCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCalls).toHaveLength(1);
      expect(entityFoundCalls[0]?.[0]).toBe(EventChannel.Regex);

      const occurrence = (entityFoundCalls[0]?.[2] as EntityFound).occurrence;
      expect(occurrence.source).toBe(DetectionSource.Manual);
      expect(occurrence.confidence).toBe(1.0);
      expect(occurrence.entityType).toBe(EntityType.Person);
      expect(occurrence.value).toBe("Ana Gómez");
      // Bbox unión de "Ana" (x=74) y "Gómez" (x=102, width=30) — ver
      // makePage en test-helpers.ts para la aritmética de posiciones.
      expect(occurrence.bbox).toEqual({ x: 74, y: 100, width: 58, height: 12 });
      expect(occurrence.wordSpan).toEqual({ startIndex: 1, endIndexExclusive: 3 });
    });

    it("findLiteral emits no REGEX_FINISHED and does not touch the pattern registry", async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-find-literal-no-finish", ["María", "López"]);
      const activePatternsBefore = engine["activePatterns"];

      await engine.findLiteral(
        { document, value: "María López", entityType: EntityType.Person },
        ctx,
      );

      const finishedCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.REGEX_FINISHED,
      );
      expect(finishedCalls).toHaveLength(0);
      // Misma referencia: recompileActivePatterns() (que reasigna un array
      // nuevo) nunca se llamó. addPattern/removePattern son la única vía de
      // mutar el registro (§1: findLiteral no la usa).
      expect(engine["activePatterns"]).toBe(activePatternsBefore);
      expect(engine["customPatterns"]).toEqual([]);
    });

    it("findLiteral before init() throws EngineNotInitializedError", async () => {
      const document = makeSinglePageDocument("doc-find-literal-no-init", ["Ana"]);
      await expect(
        engine.findLiteral({ document, value: "Ana", entityType: EntityType.Person }, ctx),
      ).rejects.toThrow(EngineNotInitializedError);
    });

    it("findLiteral after dispose() throws EngineDisposedError", async () => {
      await engine.init(ctx);
      await engine.dispose();
      const document = makeSinglePageDocument("doc-find-literal-disposed", ["Ana"]);
      await expect(
        engine.findLiteral({ document, value: "Ana", entityType: EntityType.Person }, ctx),
      ).rejects.toThrow(EngineDisposedError);
    });
  });

  describe("searchText (ADR-061 §8 errata)", () => {
    it("searchText emits no events at all", async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-search-text-no-events", [
        "Contacto:",
        "Ana",
        "Gómez",
      ]);

      const matches = engine.searchText({ document, query: "Ana Gómez" });

      // Con coincidencias de verdad: si esto emitiera ENTITY_FOUND, tipear
      // en la lupa crearía y fusionaría grupos en la sesión en vivo.
      expect(matches).toHaveLength(1);
      expect(busEmitSpy).not.toHaveBeenCalled();
    });

    it("searchText does not touch the pattern registry or any engine state", async () => {
      await engine.init(ctx);
      const document = makeSinglePageDocument("doc-search-text-no-state", ["María", "López"]);
      const activePatternsBefore = engine["activePatterns"];

      const first = engine.searchText({ document, query: "María López" });
      const second = engine.searchText({ document, query: "María López" });

      expect(second).toEqual(first);
      // Misma referencia: recompileActivePatterns() (que reasigna un array
      // nuevo) nunca se llamó — searchText no toca el registro de patrones.
      expect(engine["activePatterns"]).toBe(activePatternsBefore);
      expect(engine["customPatterns"]).toEqual([]);
    });
  });
});
