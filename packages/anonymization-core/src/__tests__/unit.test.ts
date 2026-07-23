import { PdfTimeoutError } from "@anonly/pdf-engine";
import {
  CancelledError,
  EngineError,
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
  createDocument,
  createEngineConfig,
  createFakeWorker,
  createImportInput,
  createMockEngines,
  createMockLogger,
  createPage,
  createPdfEngineOutput,
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

  // ─── Transporte de workers, plomería del Orchestrator (Hito 10, ADR-036 §2) ───

  it("con runtime.workers.pdf configurado, pdf-parse se despacha por postMessage (PR12, ADR-036 §2/§3)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const pdfWorker = createFakeWorker();
    const pdfFactory = vi.fn(() => pdfWorker);

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
      runtime: { workers: { pdf: pdfFactory } },
    });

    const importPromise = orchestrator.importDocument(createImportInput());

    await vi.waitFor(() => expect(pdfWorker.postMessage).toHaveBeenCalled());
    const runMessage = pdfWorker.postMessage.mock.calls[0]?.[0] as {
      readonly type: string;
      readonly jobId: string;
      readonly jobType: string;
      readonly payload: { readonly documentId: string };
    };
    expect(runMessage.type).toBe("RUN");
    expect(runMessage.jobType).toBe("pdf-parse");
    expect(runMessage.payload.documentId).toBe("doc-1");

    // Literal fresco (sin pasar por el tipo PdfEngineOutput/Document, ambos
    // `interface`): simula lo que un PdfWorker real devolvería por
    // postMessage — el transporte real no distingue de dónde salió el dato.
    pdfWorker.emitMessage({
      type: "COMPLETED",
      jobId: runMessage.jobId,
      result: {
        document: {
          id: "doc-1",
          name: "test.pdf",
          pageCount: 1,
          pages: [],
          metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
          sourceKind: "text",
          importedAt: 0,
        },
        pageCount: 1,
        textlessPages: [],
        sourceKind: "text",
      },
    });

    await importPromise;

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    expect(pdfFactory).toHaveBeenCalledTimes(1);
    // El pool despachó por postMessage: el fallback run() in-process
    // (engines.pdf.process) no se invoca (WorkerPool.executeJob, PR11).
    expect(engines.pdf.process).not.toHaveBeenCalled();
  });

  it("runtime.workers.export se retiene (debug log) sin invocar la factory (sin consumidor funcional en este PR)", () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const logger = createMockLogger();
    const exportFactory = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- construir alcanza para el log de arranque
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger,
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
      runtime: { workers: { export: exportFactory } },
    });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("transporte de workers"),
      expect.objectContaining({ hasExportWorkerFactory: true }),
    );
    expect(exportFactory).not.toHaveBeenCalled();
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

  // ─── Transporte por postMessage (Hito 10, ADR-036 §2/§3) ───

  describe("WorkerPool — transporte postMessage", () => {
    let bus: ReturnType<typeof createRealBus>;

    beforeEach(() => {
      bus = createRealBus();
    });

    it("con workerFactory + payload, despacha por postMessage en vez de invocar run()", async () => {
      const worker = createFakeWorker();
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
        workerFactory: () => worker,
      });

      const run = vi.fn().mockResolvedValue("no debería llamarse");
      const dispatchPromise = pool.dispatch({
        run,
        payload: { documentId: "doc-1" },
        signal: new AbortController().signal,
      });

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const runMessage = worker.postMessage.mock.calls[0]?.[0] as {
        readonly type: string;
        readonly jobId: string;
        readonly jobType: string;
        readonly payload: unknown;
      };
      expect(runMessage.type).toBe("RUN");
      expect(runMessage.jobType).toBe("pdf-parse");
      expect(runMessage.payload).toEqual({ documentId: "doc-1" });

      worker.emitMessage({ type: "COMPLETED", jobId: runMessage.jobId, result: { ok: true } });

      await expect(dispatchPromise).resolves.toEqual({ ok: true });
      expect(run).not.toHaveBeenCalled();
    });

    it("READY y PROGRESS no requieren acción del pool: el job sigue pendiente hasta COMPLETED", async () => {
      const worker = createFakeWorker();
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
        workerFactory: () => worker,
      });

      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      worker.emitMessage({ type: "READY", workerId: "w1", capabilities: { maxPageBatchSize: 8 } });
      worker.emitMessage({ type: "PROGRESS", jobId, progress: 0.5 });
      worker.emitMessage({ type: "COMPLETED", jobId, result: "done" });

      await expect(dispatchPromise).resolves.toBe("done");
    });

    it("con workerFactory pero sin payload, sigue siendo in-process (fallback, sin romper el Hito 9)", async () => {
      const worker = createFakeWorker();
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
        workerFactory: () => worker,
      });

      const result = await pool.dispatch({
        run: () => Promise.resolve("in-process"),
        signal: new AbortController().signal,
      });

      expect(result).toBe("in-process");
      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it("sin workerFactory, un payload no dispara transporte remoto (comportamiento de hoy)", async () => {
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

      const run = vi.fn().mockResolvedValue("in-process");
      const result = await pool.dispatch({
        run,
        payload: { pageIndex: 0 },
        signal: new AbortController().signal,
      });

      expect(result).toBe("in-process");
      expect(run).toHaveBeenCalled();
    });

    it("un mensaje FAILED remoto rechaza con el EngineError deserializado", async () => {
      const worker = createFakeWorker();
      const pool = new WorkerPool({
        poolKey: "ner",
        jobType: "ner-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: () => worker,
      });

      const dispatchPromise = pool
        .dispatch({ run: vi.fn(), payload: {}, signal: new AbortController().signal })
        .catch((err: unknown) => err);

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      worker.emitMessage({
        type: "FAILED",
        jobId,
        error: {
          code: EngineErrorCode.NER_PAGE_FAILED,
          engineId: EngineId.Ner,
          message: "boom",
          retryable: false,
          details: {},
        },
      });

      const result = await dispatchPromise;
      expect(result).toBeInstanceOf(EngineError);
      expect((result as InstanceType<typeof EngineError>).code).toBe(
        EngineErrorCode.NER_PAGE_FAILED,
      );
    });

    it("abortar un job remoto en curso envía CANCEL por postMessage; CANCELLED rechaza con CancelledError", async () => {
      const worker = createFakeWorker();
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
        workerFactory: () => worker,
      });

      const controller = new AbortController();
      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: controller.signal,
      });

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      controller.abort();

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
      const cancelMessage = worker.postMessage.mock.calls[1]?.[0] as { readonly type: string };
      expect(cancelMessage.type).toBe("CANCEL");

      worker.emitMessage({ type: "CANCELLED", jobId, signalId: jobId });
      await expect(dispatchPromise).rejects.toThrow(CancelledError);
    });

    it("la variante EVENT se reenvía al bus real (transporte mecánico, ADR-036 §3)", async () => {
      const worker = createFakeWorker();
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
        workerFactory: () => worker,
      });

      const previewSpy = vi.fn();
      bus.on(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, previewSpy);

      // Dispara la creación perezosa del worker (registra los listeners)
      // sin depender de que el job resuelva: el EVENT es independiente del
      // ciclo de vida de cualquier job puntual.
      void pool.dispatch({ run: vi.fn(), payload: {}, signal: new AbortController().signal });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());

      worker.emitMessage(
        {
          type: "EVENT",
          channel: EventChannel.Render,
          event: EngineEvents.PREVIEW_UPDATED,
          payload: {
            documentId: "doc-1",
            pageIndex: 0,
            kind: "original",
            canvasBlobUrl: "blob:remote",
          },
        },
        true, // simula la entrega real de un Worker de DOM (MessageEvent.data)
      );

      expect(previewSpy).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: "doc-1", canvasBlobUrl: "blob:remote" }),
      );
    });

    it("un worker que crashea (evento error) rechaza con InvalidInputError, NO reintenta, y se recrea perezosamente en el próximo dispatch", async () => {
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 1,
        maxQueue: 10,
        // maxRetries > 0 a propósito: el test prueba que un crash de
        // transporte NO dispara reintento aunque el pool sí reintentaría
        // otros errores retryable (ver handleWorkerTransportError).
        maxRetries: 2,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: factory,
      });

      const firstDispatch = pool
        .dispatch({ run: vi.fn(), payload: {}, signal: new AbortController().signal })
        .catch((err: unknown) => err);
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalled());

      workerA.emitError();
      const firstResult = await firstDispatch;

      // InvalidInputError (Code_Standards.md §7), no un Error genérico: no
      // hay un EngineErrorCode dedicado a "crash de transporte" (I-4) —
      // mismo criterio que toSerializedError. retryable: false de fábrica
      // (InvalidInputError, shared/src/errors.ts).
      expect(firstResult).toBeInstanceOf(EngineError);
      expect((firstResult as InstanceType<typeof EngineError>).code).toBe(
        EngineErrorCode.INVALID_INPUT,
      );
      expect((firstResult as InstanceType<typeof EngineError>).retryable).toBe(false);

      // Sin reintento: un solo postMessage("RUN") a workerA pese a
      // maxRetries=2 — diferimiento deliberado (ver handleWorkerTransportError):
      // sin worker real corriendo todavía (solo fakes), no hay contra qué
      // validar un reintento genuino (re-priming de INIT/load-document,
      // PR12+).
      expect(workerA.postMessage).toHaveBeenCalledTimes(1);

      // Slot liberado + worker descartado: el siguiente dispatch remoto pide
      // una instancia nueva a la factory (workerB), no reutiliza workerA.
      const secondDispatch = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalled());
      expect(factory).toHaveBeenCalledTimes(2);

      const secondJobId = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      workerB.emitMessage({ type: "COMPLETED", jobId: secondJobId, result: "ok" });
      await expect(secondDispatch).resolves.toBe("ok");
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

    it("workerFactories (ADR-036 §2) se pasa por pool: solo el pool con factory despacha remoto", async () => {
      const bus = createRealBus();
      const pdfWorker = createFakeWorker();
      const manager = new WorkerPoolManager({
        bus,
        logger: createMockLogger(),
        getPoolSize: () => 1,
        getMaxQueue: () => 10,
        getMaxRetries: () => 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        idleDisposeMs: 60_000,
        workerFactories: { pdf: () => pdfWorker },
      });

      const pdfPool = manager.getPool("pdf");
      const pdfDispatch = pdfPool.dispatch({
        run: vi.fn(),
        payload: { documentId: "doc-1" },
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(pdfWorker.postMessage).toHaveBeenCalled());
      const jobId = (pdfWorker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
      pdfWorker.emitMessage({ type: "COMPLETED", jobId, result: "remote" });
      await expect(pdfDispatch).resolves.toBe("remote");

      // ocr no tiene factory configurada: mismo comportamiento in-process de siempre.
      const ocrPool = manager.getPool("ocr");
      const ocrRun = vi.fn().mockResolvedValue("in-process");
      const ocrResult = await ocrPool.dispatch({
        run: ocrRun,
        payload: { documentId: "doc-1" },
        signal: new AbortController().signal,
      });
      expect(ocrResult).toBe("in-process");
      expect(ocrRun).toHaveBeenCalled();

      manager.disposeAll();
    });
  });
});

describe("PIPELINE_PROGRESS (Orchestrator.md §8, ADR-034 §4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface CapturedProgress {
    readonly documentId: string;
    readonly stage: PipelineStage;
    readonly current: number;
    readonly total: number;
  }

  // ─── Extracting: único punto de emisión, vía DOCUMENT_PARSED ───

  it("Extracting: emits current = total = pageCount on DOCUMENT_PARSED", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    vi.spyOn(engines.pdf, "process").mockImplementation(async (input: { documentId: string }) => {
      bus.emit(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
        documentId: input.documentId,
        pageCount: 3,
        textlessPages: [],
        sourceKind: "text",
      });
      return createPdfEngineOutput({
        document: createDocument({
          pageCount: 3,
          pages: [createPage({ index: 0 }), createPage({ index: 1 }), createPage({ index: 2 })],
        }),
      });
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const progressSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, progressSpy);

    await orchestrator.importDocument(createImportInput());

    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        stage: PipelineStage.Extracting,
        current: 3,
        total: 3,
      }),
    );
  });

  // ─── OCR: total = textlessPages.length, current por OCR_PAGE_FINISHED ───

  it("OCR: current increments per OCR_PAGE_FINISHED up to total = textlessPages.length", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pageCount: 2,
        pages: [
          createPage({ index: 0, requiresOCR: true }),
          createPage({ index: 1, requiresOCR: true }),
        ],
      }),
      textlessPages: [0, 1],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    vi.spyOn(engines.ocr, "processPages").mockImplementation(async (inputs) => {
      const outputs = [];
      for (const input of inputs) {
        bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
          documentId: input.documentId,
          pageIndex: input.pageIndex,
          wordCount: 0,
          confidence: 0.9,
        });
        outputs.push({
          documentId: input.documentId,
          pageIndex: input.pageIndex,
          words: [],
          confidence: 0.9,
          durationMs: 1,
        });
      }
      return outputs;
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const progressEvents: CapturedProgress[] = [];
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, (p) => progressEvents.push(p));

    await orchestrator.importDocument(createImportInput());

    const ocrEvents = progressEvents.filter((e) => e.stage === PipelineStage.OCRing);
    expect(ocrEvents.map((e) => e.current)).toEqual([1, 2]);
    expect(ocrEvents.every((e) => e.total === 2)).toBe(true);
    expect(ocrEvents.every((e) => e.current <= e.total)).toBe(true);
    expect(ocrEvents.every((e) => e.documentId === "doc-1")).toBe(true);
  });

  // ─── Detección con NER activo: total = pageCount, current por NER_PAGE_FINISHED ───

  it("Detecting (NER enabled): current increments per NER_PAGE_FINISHED up to total = pageCount", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pageCount: 2,
        pages: [createPage({ index: 0 }), createPage({ index: 1 })],
      }),
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    vi.spyOn(engines.ner, "processPages").mockImplementation(async (inputs) => {
      for (const input of inputs) {
        bus.emit(EventChannel.Ner, EngineEvents.NER_PAGE_FINISHED, {
          documentId: input.documentId,
          pageIndex: input.pageIndex,
          occurrenceCount: 0,
        });
      }
      bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
        documentId: pdfOutput.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
      await engines.grouping.finishSession(pdfOutput.document.id);
      return inputs.map((input) => ({
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        occurrences: [],
        durationMs: 1,
      }));
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const progressEvents: CapturedProgress[] = [];
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, (p) => progressEvents.push(p));

    await orchestrator.importDocument(createImportInput());

    const detectingEvents = progressEvents.filter((e) => e.stage === PipelineStage.Detecting);
    expect(detectingEvents.map((e) => e.current)).toEqual([1, 2]);
    expect(detectingEvents.every((e) => e.total === 2)).toBe(true);
    expect(detectingEvents.every((e) => e.current <= e.total)).toBe(true);
  });

  // ─── current nunca supera total, incluso si se recibieran más eventos que páginas ───

  it("current never exceeds total even with more finish events than pages tracked", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pageCount: 1,
        pages: [createPage({ index: 0, requiresOCR: true })],
      }),
      textlessPages: [0],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    vi.spyOn(engines.ocr, "processPages").mockImplementation(async (inputs) => {
      // Emite OCR_PAGE_FINISHED dos veces para la misma (única) página
      // tracked, simulando una entrega duplicada del bus.
      for (let i = 0; i < 2; i += 1) {
        bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
          documentId: inputs[0]?.documentId ?? "",
          pageIndex: 0,
          wordCount: 0,
          confidence: 0.9,
        });
      }
      return inputs.map((input) => ({
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        words: [],
        confidence: 0.9,
        durationMs: 1,
      }));
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const progressEvents: CapturedProgress[] = [];
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, (p) => progressEvents.push(p));

    await orchestrator.importDocument(createImportInput());

    const ocrEvents = progressEvents.filter((e) => e.stage === PipelineStage.OCRing);
    expect(ocrEvents.map((e) => e.current)).toEqual([1, 1]);
    expect(ocrEvents.every((e) => e.current <= e.total)).toBe(true);
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
