import { PdfTimeoutError } from "@anonly/pdf-engine";
import {
  CancelledError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EventChannel,
  InvalidInputError,
  PipelineStage,
} from "@anonly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LruCache } from "../cache.js";
import { buildDefaultEngineConfig } from "../config.js";
import { OrchestratorDisposedError } from "../errors.js";
import { PipelineOrchestrator } from "../orchestrator.js";
import { WorkerPool, WorkerPoolManager } from "../worker-pool.js";

import {
  createEngineConfig,
  createImportInput,
  createMockEngines,
  createMockLogger,
  createRealBus,
  wireHappyPathSpies,
} from "./fixtures/test-helpers.js";

describe("Orchestrator — unit tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── ADR-034 §5: blob URLs ───

  it("PREVIEW_UPDATED replaces and revokes previous blob URL for same key", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- construir alcanza para wireSubscriptions()
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 0,
      kind: "original",
      canvasBlobUrl: "blob:first",
    });
    expect(revokeSpy).not.toHaveBeenCalled();

    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 0,
      kind: "original",
      canvasBlobUrl: "blob:second",
    });

    expect(revokeSpy).toHaveBeenCalledWith("blob:first");
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:second");

    revokeSpy.mockRestore();
  });

  it("blobUrls revoked on close", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 0,
      kind: "original",
      canvasBlobUrl: "blob:preview-1",
    });
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: "doc-1",
      blobUrl: "blob:export-1",
      sizeBytes: 1,
      durationMs: 1,
    });

    await orchestrator.closeDocument("doc-1");

    expect(revokeSpy).toHaveBeenCalledWith("blob:preview-1");
    expect(revokeSpy).toHaveBeenCalledWith("blob:export-1");

    revokeSpy.mockRestore();
  });

  // ─── §10: getState inmutable ───

  it("getState returns immutable snapshot", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    const readySnapshot = orchestrator.getState("doc-1");
    expect(readySnapshot.stage).toBe(PipelineStage.Ready);

    await orchestrator.cancel("doc-1");
    const cancelledSnapshot = orchestrator.getState("doc-1");

    // El snapshot tomado antes de cancel() no cambia retroactivamente.
    expect(readySnapshot.stage).toBe(PipelineStage.Ready);
    expect(cancelledSnapshot.stage).toBe(PipelineStage.Cancelled);
    expect(readySnapshot).not.toBe(cancelledSnapshot);

    expect(() => orchestrator.getState("no-such-doc")).toThrow(InvalidInputError);
  });

  // ─── 07_Performance_Strategy.md §5.1 ───

  it("low-memory device serializes OCR and NER", () => {
    const lowMemoryConfig = buildDefaultEngineConfig({ deviceMemory: 2, hardwareConcurrency: 2 });
    expect(lowMemoryConfig.workerPool.ocrPoolSize).toBe(1);
    expect(lowMemoryConfig.workerPool.nerPoolSize).toBe(1);
    expect(lowMemoryConfig.workerPool.pdfPoolSize).toBe(2);
    expect(lowMemoryConfig.workerPool.renderPoolSize).toBe(2);

    const normalConfig = buildDefaultEngineConfig({ deviceMemory: 8, hardwareConcurrency: 8 });
    expect(normalConfig.workerPool.ocrPoolSize).toBe(2);
    expect(normalConfig.workerPool.nerPoolSize).toBe(2);
  });

  // ─── WorkerPool (05_Worker_Architecture.md) ───

  describe("WorkerPool", () => {
    let bus: ReturnType<typeof createRealBus>;

    beforeEach(() => {
      bus = createRealBus();
    });

    it("saturated pool pauses ingest until 50%", async () => {
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 1,
        maxQueue: 2,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
      });

      const saturatedSpy = vi.fn();
      bus.on(EventChannel.Workers, EngineEvents.WORKER_POOL_SATURATED, saturatedSpy);

      const deferreds: Array<() => void> = [];
      const makeJob = (): Promise<void> =>
        pool.dispatch({
          run: () =>
            new Promise<void>((resolve) => {
              deferreds.push(resolve);
            }),
          signal: new AbortController().signal,
        });

      // size=1 -> el primero arranca inmediatamente; maxQueue=2 -> el 4to satura.
      const jobs = [makeJob(), makeJob(), makeJob(), makeJob()];
      void jobs;

      await vi.waitFor(() => expect(saturatedSpy).toHaveBeenCalled());
      expect(pool.isSaturated).toBe(true);

      let capacityResolved = false;
      const waitPromise = pool.waitForCapacity().then(() => {
        capacityResolved = true;
      });

      expect(capacityResolved).toBe(false);

      // Libera jobs hasta bajar del 50% (maxQueue/2 = 1). Cada resolución
      // atraviesa varios saltos de microtask (runWithRetry → execute →
      // pump()); se espera la cola en cada paso en vez de contar microtasks.
      deferreds.shift()?.(); // arranca el 2do de la cola
      await vi.waitFor(() => expect(pool.queueLength).toBe(2));
      deferreds.shift()?.();
      await vi.waitFor(() => expect(pool.queueLength).toBe(1));

      await waitPromise;
      expect(capacityResolved).toBe(true);

      deferreds.shift()?.();
      deferreds.shift()?.();
    });

    it("retry with exponential backoff honors maxRetries", async () => {
      vi.useFakeTimers();
      try {
        const pool = new WorkerPool({
          poolKey: "pdf",
          jobType: "pdf-parse",
          size: 1,
          maxQueue: 10,
          maxRetries: 2,
          baseRetryDelayMs: 100,
          maxRetryDelayMs: 1000,
          bus,
          logger: createMockLogger(),
        });

        let attempts = 0;
        const run = vi.fn(async () => {
          attempts += 1;
          const err = Object.assign(new Error("boom"), { retryable: true });
          throw err;
        });

        const dispatchPromise = pool
          .dispatch({
            run,
            signal: new AbortController().signal,
            isRetryable: () => true,
          })
          .catch((err: unknown) => err);

        await vi.advanceTimersByTimeAsync(0);
        expect(attempts).toBe(1);

        await vi.advanceTimersByTimeAsync(100); // backoff intento 1: base * 2^0
        expect(attempts).toBe(2);

        await vi.advanceTimersByTimeAsync(200); // backoff intento 2: base * 2^1
        expect(attempts).toBe(3);

        const result = await dispatchPromise;
        expect(result).toBeInstanceOf(Error);
        expect(attempts).toBe(3); // 1 intento inicial + 2 reintentos = maxRetries
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits WORKER_JOB_TIMEOUT for a timeout-coded error", async () => {
      const pool = new WorkerPool({
        poolKey: "pdf",
        jobType: "pdf-parse",
        size: 1,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
      });
      const timeoutSpy = vi.fn();
      bus.on(EventChannel.Workers, EngineEvents.WORKER_JOB_TIMEOUT, timeoutSpy);

      await expect(
        pool.dispatch({
          run: () => Promise.reject(new PdfTimeoutError("doc-1", 0, 30000)),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(PdfTimeoutError);

      expect(timeoutSpy).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: expect.any(String) }),
      );
    });

    it("dispatch on a disposed pool rejects with CancelledError", async () => {
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
      });
      pool.dispose();

      await expect(
        pool.dispatch({ run: () => Promise.resolve(1), signal: new AbortController().signal }),
      ).rejects.toThrow(CancelledError);
    });

    it("aborting a queued (not yet running) job removes it and rejects with CancelledError", async () => {
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
      });

      // Ocupa el único slot con un job que nunca resuelve.
      const blocker = pool.dispatch({
        run: () => new Promise(() => undefined),
        signal: new AbortController().signal,
      });
      void blocker;

      const controller = new AbortController();
      const queuedPromise = pool.dispatch({
        run: () => Promise.resolve(1),
        signal: controller.signal,
      });
      expect(pool.queueLength).toBe(1);

      controller.abort();

      await expect(queuedPromise).rejects.toThrow(CancelledError);
      expect(pool.queueLength).toBe(0);
    });
  });

  describe("WorkerPoolManager", () => {
    it("disposes an idle pool after idleDisposeMs", async () => {
      vi.useFakeTimers();
      try {
        const bus = createRealBus();
        const manager = new WorkerPoolManager({
          bus,
          logger: createMockLogger(),
          getPoolSize: () => 1,
          getMaxQueue: () => 10,
          getMaxRetries: () => 0,
          baseRetryDelayMs: 1,
          maxRetryDelayMs: 1,
          idleDisposeMs: 1000,
        });

        const pool1 = manager.getPool("render");
        const disposeSpy = vi.spyOn(pool1, "dispose");

        await vi.advanceTimersByTimeAsync(1000);
        expect(disposeSpy).toHaveBeenCalled();

        // Creación perezosa: una nueva llamada crea una instancia nueva.
        const pool2 = manager.getPool("render");
        expect(pool2).not.toBe(pool1);

        manager.disposeAll();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("LruCache", () => {
  it("get/set/delete/clear basic contract", () => {
    const cache = new LruCache({ maxItems: 2, maxBytes: 1000 });

    expect(cache.get("missing")).toBeUndefined();

    cache.set("a", 1, 10);
    cache.set("b", 2, 10);
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(20);
    expect(cache.get("a")).toBe(1);

    cache.delete("missing"); // no-op, no lanza
    cache.delete("a");
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(10);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it("evicts the oldest entry when maxItems is exceeded", () => {
    const cache = new LruCache({ maxItems: 2, maxBytes: 1_000_000 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a" (LRU)

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("evicts entries when maxBytes is exceeded", () => {
    const cache = new LruCache({ maxItems: 100, maxBytes: 15 });

    cache.set("a", "x", 10);
    cache.set("b", "y", 10); // total 20 > 15 -> evicts "a"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("y");
  });

  it("get() touches an entry, protecting it from eviction (LRU order)", () => {
    const cache = new LruCache({ maxItems: 2, maxBytes: 1_000_000 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" pasa a ser el más reciente
    cache.set("c", 3); // evicts "b" (ahora el LRU real)

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });
});

describe("Orchestrator — disposed guard", () => {
  it("methods reject with OrchestratorDisposedError after dispose()", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.dispose();

    await expect(orchestrator.importDocument(createImportInput())).rejects.toThrow(
      OrchestratorDisposedError,
    );
    await expect(orchestrator.retryWithPassword("doc-1", "x")).rejects.toThrow(
      OrchestratorDisposedError,
    );
  });
});

describe("Orchestrator — export failure propagation", () => {
  it("EXPORT_FAILED (already-serialized error) propagates to PIPELINE_FAILED", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });
    await orchestrator.importDocument(createImportInput());

    const failure = {
      code: EngineErrorCode.EXPORT_FAILED,
      engineId: EngineId.Export,
      message: "export explotó",
      retryable: false,
      details: {},
    };
    (engines.export.export as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { documentId: string }) => {
        bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
          documentId: input.documentId,
          error: failure,
        });
        throw new Error("export failed");
      },
    );

    const failedSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, failedSpy);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => expect(failedSpy).toHaveBeenCalled());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed);
    expect(failedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        error: expect.objectContaining({ code: "EXPORT_FAILED" }),
      }),
    );
  });
});
