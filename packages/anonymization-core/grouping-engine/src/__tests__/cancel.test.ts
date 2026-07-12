/**
 * Cancelación cooperativa (Grouping_Engine.md §12: "entre procesamientos de
 * ENTITY_FOUND, SLA < 50 ms"). Grouping corre en el main thread, sin Worker:
 * el checkpoint es el chequeo de `ctx.abortSignal.aborted` al inicio de
 * `handleEntityFound` (grouping.engine.ts) antes de procesar cada ocurrencia.
 */
import { CancelledError, EngineEvents, EventChannel, type EngineContext } from "@anonly/shared";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";

import { createEngineContext, makeOccurrence } from "./fixtures/test-helpers.js";

describe("GroupingEngine — cancellation", () => {
  let engine: GroupingEngine;

  beforeEach(() => {
    engine = new GroupingEngine();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("cancel between ENTITY_FOUND within 50ms", async () => {
    const abortController = new AbortController();
    const ctx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(ctx);
    engine.startSession("doc-1");

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);

    const startedAt = Date.now();
    abortController.abort();

    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "22222222", normalizedValue: "22222222" }),
    });
    const elapsedMs = Date.now() - startedAt;

    // El ENTITY_FOUND posterior al abort se descarta en el checkpoint
    // cooperativo (handleEntityFound): no se crea un segundo grupo.
    expect(engine.getSnapshot("doc-1").groups).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(50);
  });

  it("apply* methods throw CancelledError when abortSignal is already aborted", async () => {
    const abortController = new AbortController();
    const ctx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(ctx);
    engine.startSession("doc-1");
    ctx.bus.emit(EventChannel.Regex, EngineEvents.ENTITY_FOUND, {
      documentId: "doc-1",
      occurrence: makeOccurrence({ value: "11111111", normalizedValue: "11111111" }),
    });
    const [group] = engine.getSnapshot("doc-1").groups;

    abortController.abort();

    await expect(
      engine.applyGroupUpdate({
        documentId: "doc-1",
        groupId: group!.id,
        patch: { enabled: false },
      }),
    ).rejects.toThrow(CancelledError);
  });
});
