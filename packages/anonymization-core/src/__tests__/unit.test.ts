import { PdfPasswordRequiredError, PdfTimeoutError } from "@anonly/pdf-engine";
import { RenderEngine } from "@anonly/render-engine";
import {
  CancelledError,
  DetectionSource,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EntityType,
  EventChannel,
  InvalidInputError,
  PipelineStage,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LruCache } from "../cache.js";
import { buildDefaultEngineConfig } from "../config.js";
import { OrchestratorDisposedError } from "../errors.js";
import { selectLineWords } from "../line-words.js";
import { PipelineOrchestrator } from "../orchestrator.js";
import { WorkerPool, WorkerPoolManager } from "../worker-pool.js";

import {
  createDocument,
  createEngineConfig,
  createEntityGroup,
  createFakeWorker,
  createImportInput,
  createMockEngines,
  createMockLogger,
  createPage,
  createPdfEngineOutput,
  createRealBus,
  createReplacement,
  createWord,
  makeOrchestratorWithRealDetection,
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

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    // ADR-052 §2 (v1.5.4): el guard de llegada tardía revoca-y-descarta un
    // PREVIEW_UPDATED cuyo documentId no está abierto en `state` — el
    // documento tiene que estar importado para que este test siga probando
    // el replace-and-revoke de ADR-034 §5 (no el guard nuevo, cubierto por
    // los tests de ADR-052 más abajo).
    await orchestrator.importDocument(createImportInput());
    revokeSpy.mockClear();

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

  it("EXPORT_FINISHED emits PIPELINE_STAGE_CHANGED with Done, not just internal state", async () => {
    // Regresión: `handleExportFinished` hacía `state.update({ stage: Done })`
    // sin emitir. El estado interno quedaba bien y la UI nunca se enteraba, así
    // que para ella el stage seguía en `Exporting` tras un export exitoso — con
    // "Exportar" oculto (gate `{Ready, Done}`) y el blobUrl inalcanzable.
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

    const stages: PipelineStage[] = [];
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, (payload) => {
      stages.push(payload.stage);
    });

    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: "doc-1",
      blobUrl: "blob:export-1",
      sizeBytes: 1,
      durationMs: 1,
    });

    expect(stages).toContain(PipelineStage.Done);
  });

  // ─── ADR-050 §2 / §4 (`08_Security_Model.md` §6.2): borrado del password ───

  it("closeDocument leaves no password behind", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PdfPasswordRequiredError("doc-1"),
    );

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    await orchestrator.retryWithPassword("doc-1", "test1234");

    // El password quedó retenido host-side mientras el documento está
    // abierto (ADR-050 §2/§4; `08_Security_Model.md` §6.1.6) — precondición
    // del test: sin esto, la aserción de abajo pasaría vacía.
    expect(orchestrator["retainedInputs"].get("doc-1")?.password).toBe("test1234");

    await orchestrator.closeDocument("doc-1");

    // Tras closeDocument, ni la entrada ni el password sobreviven en el
    // estado del Orchestrator (`retainedInputs.delete`, ya existente).
    expect(orchestrator["retainedInputs"].has("doc-1")).toBe(false);
  });

  // ─── ADR-065 §8: las regiones retenidas se descartan en closeDocument ───

  it("retained ocrRegions state is cleared on closeDocument (ADR-065 §8)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const region = { pageIndex: 0, bbox: { x: 100, y: 50, width: 200, height: 300 } };
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pages: [createPage({ index: 0, requiresOCR: false })],
      }),
      textlessPages: [],
      ocrRegions: [region],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    // Precondición del test: sin esto, la aserción de abajo pasaría vacía.
    expect(orchestrator["ocrRegionsByDocument"].get("doc-1")).toEqual([region]);

    await orchestrator.closeDocument("doc-1");

    expect(orchestrator["ocrRegionsByDocument"].has("doc-1")).toBe(false);
  });

  // ─── Mediación grupos→Render del preview (ADR-044, §13 caso 27) ───

  it("burst of ENTITY_GROUP_UPDATED coalesces into one render per page", async () => {
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
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    const group = createEntityGroup({
      id: "group-burst",
      members: [
        {
          occurrenceId: "occ-1",
          value: "valor",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });

    // Ráfaga de varios ENTITY_GROUP_UPDATED en el mismo tick (p. ej. una
    // regla de tipo, caso 12 de Grouping_Engine.md) — debe coalescer en un
    // solo render por página afectada.
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group,
      changes: ["replacementMode"],
    });
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group,
      changes: ["replacementMode"],
    });
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group,
      changes: ["replacementMode"],
    });

    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledTimes(1);
    });

    expect(engines.render.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
      }),
      expect.anything(),
    );
  });

  it("ENTITY_GROUP_REMOVED re-renders pages the group occupied", async () => {
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

    const group = createEntityGroup({
      id: "group-removed",
      members: [
        {
          occurrenceId: "occ-1",
          value: "valor",
          pageIndex: 2,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
        {
          occurrenceId: "occ-2",
          value: "valor",
          pageIndex: 5,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });
    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({ pageIndex: 2 }),
        expect.anything(),
      );
    });
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    // ENTITY_GROUP_REMOVED no trae `members` (Contracts.md §8): las páginas
    // afectadas salen del mapa retenido por el Orchestrator, no del payload.
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, {
      documentId: "doc-1",
      groupId: "group-removed",
    });

    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledTimes(2);
    });

    const calledPages = (engines.render.renderPage as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => (call[0] as { pageIndex: number }).pageIndex)
      .sort((a, b) => a - b);
    expect(calledPages).toEqual([2, 5]);
  });

  it("flushDirtyPages attaches lineWords to the mediated render (ADR-058 §5)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const neighborWord = createWord({
      text: "vecino",
      bbox: { x: 30, y: 0, width: 30, height: 12 },
    });
    const document = createDocument({
      pages: [createPage({ index: 0, words: [neighborWord] })],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput: createPdfEngineOutput({ document }) });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    // getSnapshot por defecto (wireHappyPathSpies) devuelve grupos vacíos, así
    // que el seed de GROUPING_FINISHED no renderizó nada para esta página
    // (caso 26): el único render que este test necesita es el del flush.
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    const group = createEntityGroup({
      id: "group-flush-linewords",
      // bbox angosto + "[DNI 01]" (8 caracteres): desborda (ADR-057 §5) y
      // dispara la selección de lineWords.
      members: [
        {
          occurrenceId: "occ-1",
          value: "valor",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 20, height: 12 },
          source: DetectionSource.Regex,
        },
      ],
    });
    // flushDirtyPages relee el snapshot vigente al procesar la ráfaga (no el
    // que estaba activo cuando llegó el evento) -- hace falta que getSnapshot
    // ya devuelva este grupo para que buildPageReplacements produzca el
    // reemplazo que desborda.
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));

    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group,
      changes: ["replacementMode"],
    });

    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledTimes(1);
    });

    expect(engines.render.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        pageIndex: 0,
        mode: "preview",
        lineWords: [neighborWord],
      }),
      expect.anything(),
    );
  });

  it("group page map cleared on DOCUMENT_CLOSED", async () => {
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

    const group = createEntityGroup({
      id: "group-cleanup",
      members: [
        {
          occurrenceId: "occ-1",
          value: "valor",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });
    await vi.waitFor(() => {
      expect(orchestrator["groupPagesByDocument"].has("doc-1")).toBe(true);
    });

    await orchestrator.closeDocument("doc-1");

    expect(orchestrator["groupPagesByDocument"].has("doc-1")).toBe(false);
    expect(orchestrator["dirtyPagesByDocument"].has("doc-1")).toBe(false);
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
    //
    // ADR-055 §5/§10: este ES el test de sobre de PDF. El pool ignora `run()`
    // (se asevera abajo: `engines.pdf.process` nunca se invoca) y resuelve
    // exactamente lo que postea el entry-point, así que el valor que llega a
    // `decodePdfEngineOutput` en `orchestrator.ts` cruzó el transporte de
    // verdad. Si alguien envolviera el resultado del PdfWorker en un sobre,
    // este literal dejaría de matchear el decoder y el import fallaría acá.
    // Los rechazos (basura, sobre, campos faltantes) están en edge.test.ts.
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
        // ADR-065 §4: campo requerido de PdfEngineOutput desde este ADR — un
        // PdfWorker real siempre lo incluye (vacío es el caso normal, sin
        // imágenes con texto oculto). El literal simula el postMessage real,
        // así que tiene que reflejar el contrato completo.
        ocrRegions: [],
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

    it("READY y un PROGRESS sin onProgress registrado no requieren acción del pool: el job sigue pendiente hasta COMPLETED", async () => {
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

    // ─── PROGRESS -> onProgress (ADR-046 §4, PR15) ───

    it("un PROGRESS con onProgress registrado se lo entrega, correlacionado por jobId", async () => {
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

      const onProgress = vi.fn();
      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
        onProgress,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      worker.emitMessage({
        type: "PROGRESS",
        jobId,
        progress: 0.5,
        partial: { phase: "model-loading", modelId: "test-model" },
      });

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith(0.5, {
        phase: "model-loading",
        modelId: "test-model",
      });

      worker.emitMessage({ type: "COMPLETED", jobId, result: "done" });
      await expect(dispatchPromise).resolves.toBe("done");
    });

    it("un PROGRESS de un job ya resuelto se descarta sin lanzar", async () => {
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

      const onProgress = vi.fn();
      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
        onProgress,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      worker.emitMessage({ type: "COMPLETED", jobId, result: "done" });
      await expect(dispatchPromise).resolves.toBe("done");

      onProgress.mockClear();
      expect(() => worker.emitMessage({ type: "PROGRESS", jobId, progress: 0.9 })).not.toThrow();
      expect(onProgress).not.toHaveBeenCalled();
    });

    it("un PROGRESS con un jobId ajeno no llega al onProgress del job pendiente", async () => {
      // El caso realmente discriminante de la correlación: con `nerPoolSize: 2`
      // hay dos jobs en vuelo a la vez, y una correlación rota traduciría el
      // progreso de carga de modelo de un worker como progreso del otro. Los
      // otros dos tests de este bloque no lo cubren: uno usa el jobId correcto
      // y el otro un job ya resuelto (ausente del mapa, así que cualquier
      // implementación lo descarta).
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

      const onProgress = vi.fn();
      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
        onProgress,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

      expect(() =>
        worker.emitMessage({ type: "PROGRESS", jobId: `${jobId}-ajeno`, progress: 0.5 }),
      ).not.toThrow();
      expect(onProgress).not.toHaveBeenCalled();

      // Y el job pendiente sigue vivo: el PROGRESS ajeno no lo tocó.
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

    it("un worker que crashea (evento error) rechaza con WORKER_CRASHED retryable y el job se reintenta contra el worker de reemplazo", async () => {
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 2,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: factory,
      });

      const dispatched = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalled());

      workerA.emitError();

      // ADR-077: el slot se libera y el reintento construye un worker nuevo.
      // Hasta ese ADR el rechazo era `InvalidInputError` (retryable: false) y
      // el job se perdía acá, en silencio, contra lo que `05` §9 especifica.
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalled());
      expect(factory).toHaveBeenCalledTimes(2);

      const retryJobId = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      workerB.emitMessage({ type: "COMPLETED", jobId: retryJobId, result: "ok" });
      await expect(dispatched).resolves.toBe("ok");
    });

    it("un crash de worker con maxRetriesOverride 0 no reintenta, pero el error llega clasificado como WORKER_CRASHED", async () => {
      // El caso de ocr/ner/export (ADR-045/046/047): el pool no reintenta, el
      // loop del motor sí — y para poder decidirlo necesita el `code`, que es
      // lo que este test fija. Con `INVALID_INPUT` esos loops abandonaban.
      const worker = createFakeWorker();
      const pool = new WorkerPool({
        poolKey: "ner",
        jobType: "ner-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 2,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: () => worker,
      });

      const dispatched = pool
        .dispatch({
          run: vi.fn(),
          payload: {},
          signal: new AbortController().signal,
          maxRetriesOverride: 0,
        })
        .catch((err: unknown) => err);
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());

      worker.emitError();
      const result = await dispatched;

      expect(result).toBeInstanceOf(EngineError);
      expect((result as InstanceType<typeof EngineError>).code).toBe(
        EngineErrorCode.WORKER_CRASHED,
      );
      expect((result as InstanceType<typeof EngineError>).retryable).toBe(true);
      expect(worker.postMessage).toHaveBeenCalledTimes(1);
    });

    it("un crash de worker no afecta a los jobs pendientes de otro slot", async () => {
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 2,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: factory,
      });

      const first = pool
        .dispatch({ run: vi.fn(), payload: {}, signal: new AbortController().signal })
        .catch((err: unknown) => err);
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalled());
      const second = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalled());

      workerA.emitError();
      expect((await first) as InstanceType<typeof EngineError>).toBeInstanceOf(EngineError);

      const secondJobId = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      workerB.emitMessage({ type: "COMPLETED", jobId: secondJobId, result: "ok" });
      await expect(second).resolves.toBe("ok");
    });

    // ─── Transferencia real (ADR-079) ───

    it("dispatch con transferList la pasa a postMessage; sin ella, postMessage va sin transfer", async () => {
      const worker = createFakeWorker();
      const pool = new WorkerPool({
        poolKey: "ocr",
        jobType: "ocr-page",
        size: 1,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: () => worker,
      });

      const buffer = new ArrayBuffer(8);
      const withTransfer = pool.dispatch({
        run: vi.fn(),
        payload: { buffer },
        signal: new AbortController().signal,
        transferList: [buffer],
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
      expect(worker.postMessage.mock.calls[0]?.[1]).toEqual([buffer]);

      const firstJobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      worker.emitMessage({ type: "COMPLETED", jobId: firstJobId, result: "ok" });
      await expect(withTransfer).resolves.toBe("ok");

      const withoutTransfer = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
      // Sin transfer list el `postMessage` va con UN solo argumento: pasar
      // `undefined` explícito cambiaría el overload elegido en un worker real.
      expect(worker.postMessage.mock.calls[1]).toHaveLength(1);

      const secondJobId = (worker.postMessage.mock.calls[1]?.[0] as { readonly jobId: string })
        .jobId;
      worker.emitMessage({ type: "COMPLETED", jobId: secondJobId, result: "ok" });
      await expect(withoutTransfer).resolves.toBe("ok");
    });

    // ─── Idle-dispose (ADR-080) ───

    it("libera los workers tras idleDisposeMs sin trabajo, y sigue usable después", async () => {
      vi.useFakeTimers();
      try {
        const workerA = createFakeWorker();
        const workerB = createFakeWorker();
        const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
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
          workerFactory: factory,
          idleDisposeMs: 60_000,
        });

        const dispatched = pool.dispatch({
          run: vi.fn(),
          payload: {},
          signal: new AbortController().signal,
        });
        await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalled());

        // Con el job en vuelo, el temporizador no puede vencer.
        vi.advanceTimersByTime(120_000);
        expect(workerA.terminate).not.toHaveBeenCalled();

        const jobId = (workerA.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
        workerA.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
        await expect(dispatched).resolves.toBe("ok");

        vi.advanceTimersByTime(60_000);
        expect(workerA.terminate).toHaveBeenCalledTimes(1);

        // `releaseIdleWorkers` NO es `dispose()`: el pool sigue vivo y el
        // próximo dispatch reconstruye el worker (ADR-080 §3).
        const afterIdle = pool.dispatch({
          run: vi.fn(),
          payload: {},
          signal: new AbortController().signal,
        });
        await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalled());
        const nextJobId = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
          .jobId;
        workerB.emitMessage({ type: "COMPLETED", jobId: nextJobId, result: "ok" });
        await expect(afterIdle).resolves.toBe("ok");
      } finally {
        vi.useRealTimers();
      }
    });

    it("sin idleDisposeMs no arma ningún temporizador", async () => {
      vi.useFakeTimers();
      try {
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

        const dispatched = pool.dispatch({
          run: vi.fn(),
          payload: {},
          signal: new AbortController().signal,
        });
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
        const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
        worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
        await expect(dispatched).resolves.toBe("ok");

        vi.advanceTimersByTime(600_000);
        expect(worker.terminate).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    // ─── broadcast() + onWorkerCreated (ADR-043 §4/§5, PR13) ───

    it("broadcast() envía el mismo payload a cada worker vivo y agrega los COMPLETED", async () => {
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 2,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: factory,
      });

      // Fuerza que existan DOS workers vivos: dos dispatch concurrentes sin
      // resolver ocupan los slots 0 y 1 (assignRemoteSlot los reparte por
      // orden de llegada, síncrono dentro de cada dispatchRemote).
      const p1 = pool.dispatch({
        run: vi.fn(),
        payload: { a: 1 },
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      const p2 = pool.dispatch({
        run: vi.fn(),
        payload: { b: 2 },
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalledTimes(1));

      const jobIdA = (workerA.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
      const jobIdB = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
      workerA.emitMessage({ type: "COMPLETED", jobId: jobIdA, result: "a-done" });
      workerB.emitMessage({ type: "COMPLETED", jobId: jobIdB, result: "b-done" });
      await Promise.all([p1, p2]);

      workerA.postMessage.mockClear();
      workerB.postMessage.mockClear();

      const broadcastPromise = pool.broadcast({ documentId: "doc-1" }, vi.fn());

      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      expect(workerB.postMessage).toHaveBeenCalledTimes(1);
      const msgA = workerA.postMessage.mock.calls[0]?.[0] as {
        readonly type: string;
        readonly jobId: string;
        readonly payload: unknown;
      };
      const msgB = workerB.postMessage.mock.calls[0]?.[0] as {
        readonly type: string;
        readonly jobId: string;
        readonly payload: unknown;
      };
      expect(msgA.type).toBe("RUN");
      expect(msgA.payload).toEqual({ documentId: "doc-1" });
      expect(msgB.payload).toEqual({ documentId: "doc-1" });
      expect(msgA.jobId).not.toBe(msgB.jobId); // cada worker recibe su propio jobId de correlación

      workerA.emitMessage({ type: "COMPLETED", jobId: msgA.jobId, result: "ra" });
      workerB.emitMessage({ type: "COMPLETED", jobId: msgB.jobId, result: "rb" });

      const results = await broadcastPromise;
      expect(results).toHaveLength(2);
      expect(results).toEqual(expect.arrayContaining(["ra", "rb"]));
    });

    it("broadcast() sin workers vivos asegura al menos uno (bootstrap) antes de despachar", async () => {
      const worker = createFakeWorker();
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 2,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: () => worker,
      });

      const broadcastPromise = pool.broadcast({ documentId: "doc-boot" }, vi.fn());
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
      const msg = worker.postMessage.mock.calls[0]?.[0] as {
        readonly jobId: string;
        readonly payload: unknown;
      };
      expect(msg.payload).toEqual({ documentId: "doc-boot" });

      worker.emitMessage({ type: "COMPLETED", jobId: msg.jobId, result: "ok" });
      await expect(broadcastPromise).resolves.toEqual(["ok"]);
    });

    it("onWorkerCreated se espera (await) antes de que un worker nuevo reciba su primer RUN (ADR-043 §5)", async () => {
      const worker = createFakeWorker();
      const order: string[] = [];
      let resolveHook: (() => void) | undefined;
      const onWorkerCreated = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveHook = (): void => {
              order.push("hook-done");
              resolve();
            };
          }),
      );
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
        onWorkerCreated,
      });

      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });

      // Deja correr microtasks: el worker ya se creó (la factory ya corrió)
      // pero el RUN no debería postearse todavía porque onWorkerCreated no resolvió.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(onWorkerCreated).toHaveBeenCalledTimes(1);
      expect(worker.postMessage).not.toHaveBeenCalled();

      resolveHook?.();
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
      order.push("run-posted");
      expect(order).toEqual(["hook-done", "run-posted"]);

      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
      worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
      await expect(dispatchPromise).resolves.toBe("ok");
    });

    // ─── Regresión: broadcast en vuelo vs. dispatch concurrente ───
    // Los controles de `broadcast()` van "directo a cada worker, sin cola"
    // (`05_Worker_Architecture.md` §7.4): no pasan por el gate `active < size`
    // de `pump()`, así que no pueden contar como slots ocupados ni llegarle a
    // un worker mezclados con un job encolado.

    it("un dispatch concurrente con un broadcast en vuelo no agota los slots (los envíos de broadcast no ocupan slot)", async () => {
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

      // Broadcast en vuelo: ocupa el único worker del pool sin resolver.
      const broadcastPromise = pool.broadcast({ documentId: "doc-1" }, vi.fn());
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
      const broadcastJobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;

      // Antes del fix, este dispatch moría acá con "no hay slot de worker
      // remoto libre" (InvalidInputError, retryable: false → la página se
      // quedaba sin PREVIEW_UPDATED para siempre).
      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: { kind: "original" },
        signal: new AbortController().signal,
      });

      worker.emitMessage({ type: "COMPLETED", jobId: broadcastJobId, result: "loaded" });
      await expect(broadcastPromise).resolves.toEqual(["loaded"]);

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
      const dispatchJobId = (worker.postMessage.mock.calls[1]?.[0] as { readonly jobId: string })
        .jobId;
      worker.emitMessage({ type: "COMPLETED", jobId: dispatchJobId, result: "rendered" });
      await expect(dispatchPromise).resolves.toBe("rendered");
    });

    it("un dispatch no postea su RUN mientras hay un broadcast de control en vuelo", async () => {
      const worker = createFakeWorker();
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 2,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: () => worker,
      });

      const broadcastPromise = pool.broadcast({ documentId: "doc-1" }, vi.fn());
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
      const broadcastJobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;

      const dispatchPromise = pool.dispatch({
        run: vi.fn(),
        payload: { kind: "original" },
        signal: new AbortController().signal,
      });

      // El `load-document` sigue sin responder: el `render-page` no puede
      // haber llegado al worker todavía (trabajaría contra un
      // PDFDocumentProxy a medio recrear).
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(worker.postMessage).toHaveBeenCalledTimes(1);

      worker.emitMessage({ type: "COMPLETED", jobId: broadcastJobId, result: "loaded" });
      await expect(broadcastPromise).resolves.toEqual(["loaded"]);

      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
      const dispatchJobId = (worker.postMessage.mock.calls[1]?.[0] as { readonly jobId: string })
        .jobId;
      worker.emitMessage({ type: "COMPLETED", jobId: dispatchJobId, result: "rendered" });
      await expect(dispatchPromise).resolves.toBe("rendered");
    });
  });

  // ─── RenderEngine + RenderPool real (ADR-043, PR13): wiring façade↔motor,
  // no solo la pool en aislamiento — cubre los dos puntos de "Validación" del
  // ADR que el resto de la suite (render-engine, tests de WorkerPool de
  // arriba) no ejercita directamente contra `RenderEngine`. ───

  describe("RenderEngine + RenderPool real (ADR-043)", () => {
    function makeRenderCtx(bus: ReturnType<typeof createRealBus>): EngineContext {
      return {
        bus,
        logger: createMockLogger(),
        cache: new LruCache(),
        abortSignal: new AbortController().signal,
        config: createEngineConfig(),
      };
    }

    it("unloadDocument (DOCUMENT_CLOSED) hace broadcast de unload-document a cada RenderWorker vivo", async () => {
      const bus = createRealBus();
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      const pool = new WorkerPool({
        poolKey: "render",
        jobType: "render-page",
        size: 2,
        maxQueue: 10,
        maxRetries: 0,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 1,
        bus,
        logger: createMockLogger(),
        workerFactory: factory,
      });

      const engine = new RenderEngine(pool);
      const ctx = makeRenderCtx(bus);
      await engine.init(ctx);

      // loadDocument bootstrapea slot 0 (workerA) — responde con pageCount.
      const loadPromise = engine.loadDocument("doc-a", new Uint8Array([1, 2, 3, 4]).buffer);
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      const loadJobId = (workerA.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      workerA.emitMessage({ type: "COMPLETED", jobId: loadJobId, result: { pageCount: 3 } });
      await loadPromise;

      // Dos rasterizePage concurrentes ocupan slot 0 (workerA) y slot 1
      // (workerB, recién creado) — así quedan DOS workers vivos para
      // verificar que unloadDocument le llega a cada uno, no solo al primero.
      workerA.postMessage.mockClear();
      const r1 = engine.rasterizePage("doc-a", 0, 1, ctx);
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      const r2 = engine.rasterizePage("doc-a", 1, 1, ctx);
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalledTimes(1));

      const fakeImageData = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      };
      const rasterJobIdA = (workerA.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      const rasterJobIdB = (workerB.postMessage.mock.calls[0]?.[0] as { readonly jobId: string })
        .jobId;
      workerA.emitMessage({ type: "COMPLETED", jobId: rasterJobIdA, result: fakeImageData });
      workerB.emitMessage({ type: "COMPLETED", jobId: rasterJobIdB, result: fakeImageData });
      await Promise.all([r1, r2]);

      // Ahora sí: unloadDocument (lo que closeDocument()/DOCUMENT_CLOSED
      // invoca en el Orchestrator, orchestrator.ts) debe llegarle a AMBOS
      // workers vivos, con el payload de control (sin buffer/kind/pageIndex).
      workerA.postMessage.mockClear();
      workerB.postMessage.mockClear();
      const unloadPromise = engine.unloadDocument("doc-a");

      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      expect(workerB.postMessage).toHaveBeenCalledTimes(1);
      const unloadMsgA = workerA.postMessage.mock.calls[0]?.[0] as {
        readonly type: string;
        readonly jobId: string;
        readonly payload: unknown;
      };
      const unloadMsgB = workerB.postMessage.mock.calls[0]?.[0] as {
        readonly jobId: string;
        readonly payload: unknown;
      };
      expect(unloadMsgA.type).toBe("RUN");
      expect(unloadMsgA.payload).toEqual({ documentId: "doc-a" });
      expect(unloadMsgB.payload).toEqual({ documentId: "doc-a" });

      workerA.emitMessage({ type: "COMPLETED", jobId: unloadMsgA.jobId, result: undefined });
      workerB.emitMessage({ type: "COMPLETED", jobId: unloadMsgB.jobId, result: undefined });
      await unloadPromise;
    });

    it("un RenderWorker nuevo/reemplazado se re-primea con load-document ANTES de aceptar su primer render-page (ADR-043 §5)", async () => {
      const bus = createRealBus();
      const workerA = createFakeWorker();
      const workerB = createFakeWorker();
      const factory = vi.fn().mockReturnValueOnce(workerA).mockReturnValueOnce(workerB);
      // Casillero mutable (mismo patrón que create-core.ts): `onWorkerCreated`
      // necesita `engine`, que a su vez necesita `pool` ya construida —
      // referencia circular de inicializadores, resuelta con un box en vez
      // de una variable directa (evita el ts(7022)/(7023) de tipo implícito).
      const engineRef: { current?: RenderEngine } = {};
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
        workerFactory: factory,
        // El wiring real (create-core.ts) cablea esto a
        // `renderEngine.reprimeWorkers()`; se reproduce igual acá para
        // ejercitar la ruta completa façade↔motor, no un mock del hook.
        onWorkerCreated: () => engineRef.current?.reprimeWorkers() ?? Promise.resolve(),
      });
      const engine = new RenderEngine(pool);
      engineRef.current = engine;
      const ctx = makeRenderCtx(bus);
      await engine.init(ctx);

      // Carga doc-a en workerA (slot 0).
      const loadPromise = engine.loadDocument("doc-a", new Uint8Array([1, 2, 3, 4]).buffer);
      await vi.waitFor(() => expect(workerA.postMessage).toHaveBeenCalledTimes(1));
      const initialLoadJobId = (
        workerA.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }
      ).jobId;
      workerA.emitMessage({ type: "COMPLETED", jobId: initialLoadJobId, result: { pageCount: 2 } });
      await loadPromise;

      // Crash de workerA: el pool descarta la instancia (handleWorkerTransportError).
      workerA.emitError();

      // Reemplazo: el próximo render sobre doc-a crea workerB en el slot 0
      // liberado. ANTES de que workerB reciba el RUN de rasterize-page,
      // debería recibir un RUN de load-document (re-priming, ADR-043 §5).
      const rasterizePromise = engine.rasterizePage("doc-a", 0, 1, ctx);
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalledTimes(1));

      const firstMsgToB = workerB.postMessage.mock.calls[0]?.[0] as {
        readonly type: string;
        readonly jobId: string;
        readonly payload: unknown;
      };
      expect(firstMsgToB.type).toBe("RUN");
      expect(firstMsgToB.payload).toEqual(
        expect.objectContaining({ documentId: "doc-a", buffer: expect.any(ArrayBuffer) }),
      );

      // Todavía no se posteó el rasterize-page: onWorkerCreated (reprimeWorkers)
      // sigue esperando el COMPLETED del re-priming.
      expect(workerB.postMessage).toHaveBeenCalledTimes(1);

      workerB.emitMessage({
        type: "COMPLETED",
        jobId: firstMsgToB.jobId,
        result: { pageCount: 2 },
      });

      // Recién ahora se postea el rasterize-page que disparó la creación de workerB.
      await vi.waitFor(() => expect(workerB.postMessage).toHaveBeenCalledTimes(2));
      const secondMsgToB = workerB.postMessage.mock.calls[1]?.[0] as {
        readonly jobId: string;
        readonly payload: unknown;
      };
      expect(secondMsgToB.payload).toEqual(
        expect.objectContaining({ documentId: "doc-a", pageIndex: 0 }),
      );

      const fakeImageData = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        colorSpace: "srgb",
      };
      workerB.emitMessage({ type: "COMPLETED", jobId: secondMsgToB.jobId, result: fakeImageData });
      await expect(rasterizePromise).resolves.toEqual(fakeImageData);
    });
  });

  describe("WorkerPoolManager", () => {
    it("delega el idle-dispose en el pool en vez de tener su propio temporizador", async () => {
      vi.useFakeTimers();
      try {
        const bus = createRealBus();
        const worker = createFakeWorker();
        const manager = new WorkerPoolManager({
          bus,
          logger: createMockLogger(),
          getPoolSize: () => 1,
          getMaxQueue: () => 10,
          getMaxRetries: () => 0,
          baseRetryDelayMs: 1,
          maxRetryDelayMs: 1,
          idleDisposeMs: 1000,
          workerFactories: { pdf: () => worker },
        });

        const pool = manager.getPool("pdf");
        // Misma instancia siempre: el manager ya no destruye ni reemplaza el
        // pool (ADR-080 §3).
        expect(manager.getPool("pdf")).toBe(pool);

        const dispatched = pool.dispatch({
          run: vi.fn(),
          payload: {},
          signal: new AbortController().signal,
        });
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());

        // El temporizador del manager rearmaba en cada `getPool` — "tiempo
        // desde el último acceso", la definición que ADR-080 Contexto §4
        // declara equivocada — y liberaba SIN chequear si había trabajo. Con
        // un job en vuelo, eso mataba el worker a mitad del job y la promesa
        // quedaba colgada para siempre (`releaseIdleWorkers` no rechaza los
        // pendientes, a diferencia de `dispose`).
        await vi.advanceTimersByTimeAsync(5000);
        expect(worker.terminate).not.toHaveBeenCalled();

        const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
        worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
        await expect(dispatched).resolves.toBe("ok");

        // Ya ocioso: ahora sí libera, por el temporizador del propio pool.
        await vi.advanceTimersByTimeAsync(1000);
        expect(worker.terminate).toHaveBeenCalledTimes(1);

        manager.disposeAll();
      } finally {
        vi.useRealTimers();
      }
    });

    it("releaseIdleWorkers es no-op si el pool NO está ocioso", async () => {
      const bus = createRealBus();
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

      const dispatched = pool.dispatch({
        run: vi.fn(),
        payload: {},
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());

      // Llamada directa con un job en vuelo: no debe matar el worker. Si lo
      // matara, la promesa quedaría colgada (terminate() no dispara `error`,
      // así que nadie rechaza los pendientes).
      pool.releaseIdleWorkers();
      expect(worker.terminate).not.toHaveBeenCalled();

      const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;
      worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
      await expect(dispatched).resolves.toBe("ok");

      pool.releaseIdleWorkers();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
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

  // ─── Literales manuales retenidos (ADR-061 §5) ───

  it("manual literals are re-applied after a reanalyze that drops their pages", async () => {
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
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });

    (engines.regex.findLiteral as ReturnType<typeof vi.fn>).mockClear();
    (engines.grouping.dropOccurrences as ReturnType<typeof vi.fn>).mockClear();

    await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

    // La página 0 (requiresOCR) se descarta entera -- incluidas las
    // ocurrencias manuales, ADR-065 §8 -- pero el literal retenido se
    // re-busca sobre el documento actualizado: sin esto el dato agregado a
    // mano desaparecería del árbol en silencio (el modo de falla que
    // ADR-061 §5 existe para cerrar).
    expect(engines.grouping.dropOccurrences).toHaveBeenCalledWith("doc-1", { pageIndices: [0] });
    expect(engines.regex.findLiteral).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Jose Perez", entityType: EntityType.Person }),
      expect.anything(),
    );
  });

  // ADR-061 §6 errata, punto 6: la durabilidad de §5 no depende de que la
  // búsqueda encuentre algo HOY. El literal se retiene aunque devuelva 0, y
  // un reanalyze posterior (p. ej. cambio de idioma de OCR) lo re-busca
  // igual -- es el caso que justifica retener antes de buscar.
  it("manual literal is retained even when findLiteral found zero occurrences, and a later reanalyze searches for it again", async () => {
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
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    // wireHappyPathSpies deja findLiteral resolviendo occurrenceCount: 0 por
    // defecto -- el valor todavía no está en el documento (p. ej. el OCR con
    // el idioma actual no lo leyó).
    const result = await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });
    expect(result).toEqual({ occurrenceCount: 0 });

    (engines.regex.findLiteral as ReturnType<typeof vi.fn>).mockClear();
    // Simula que el idioma de OCR nuevo sí lee el nombre.
    (engines.regex.findLiteral as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      documentId: "doc-1",
      occurrenceCount: 1,
      durationMs: 1,
    });

    await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

    // El literal retenido con 0 ocurrencias se re-busca igual tras el
    // reanalyze -- sin esto, un valor que apareció recién en la página
    // re-OCR-eada quedaría sin cobertura para siempre.
    expect(engines.regex.findLiteral).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Jose Perez", entityType: EntityType.Person }),
      expect.anything(),
    );
  });

  it("manual literal list is discarded on closeDocument", async () => {
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
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });

    await orchestrator.closeDocument("doc-1");

    // Reabre el mismo documentId desde cero: si la lista no se hubiera
    // descartado, un reanalyze de OCR volvería a re-buscar el literal viejo
    // sobre un documento que nunca lo tuvo.
    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    (engines.regex.findLiteral as ReturnType<typeof vi.fn>).mockClear();

    await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

    expect(engines.regex.findLiteral).not.toHaveBeenCalled();
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

  // ─── ADR-065 §2: total = textlessPages.length + ocrRegions.length ───

  it("OCR: total counts textlessPages.length + ocrRegions.length (ADR-065 §2)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const region = { pageIndex: 1, bbox: { x: 100, y: 50, width: 200, height: 300 } };
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pageCount: 2,
        pages: [
          createPage({ index: 0, requiresOCR: true }),
          createPage({ index: 1, requiresOCR: false }),
        ],
      }),
      textlessPages: [0],
      ocrRegions: [region],
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
    // Una página textless (0) + una región (1) => total 2, sin importar que
    // pertenezcan a conjuntos distintos y disjuntos (ADR-065 §4).
    expect(ocrEvents.map((e) => e.current)).toEqual([1, 2]);
    expect(ocrEvents.every((e) => e.total === 2)).toBe(true);
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
      includeMarkerLegend: false,
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

describe("makeRenderPageProvider.renderFull — lineWords (ADR-058 §5 / Orchestrator.md v1.7.1)", () => {
  it("renderFull omits lineWords when every token of the page fits", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const document = createDocument({ pages: [createPage({ index: 0, words: [] })] });
    wireHappyPathSpies(engines, bus, { pdfOutput: createPdfEngineOutput({ document }) });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: false,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => {
      expect(engines.export.export).toHaveBeenCalled();
    });
    const exportCall = (engines.export.export as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      renderPageProvider: {
        renderFull(
          pageIndex: number,
          replacements: ReadonlyArray<unknown>,
          abortSignal: AbortSignal,
        ): Promise<unknown>;
      };
    };
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    // bbox generoso: "[DNI 01]" (8 caracteres) entra sin problema
    // (estimateTokenWidth no desborda, ADR-057 §5) -- mismo caso "fits" que
    // el test de `selectLineWords` de abajo.
    const fittingReplacement = createReplacement({
      bbox: { x: 0, y: 0, width: 200, height: 12 },
      replacementValue: "[DNI 01]",
    });

    await exportCall.renderPageProvider.renderFull(
      0,
      [fittingReplacement],
      new AbortController().signal,
    );

    expect(engines.render.renderPage).toHaveBeenCalledTimes(1);
    const fullInput = (engines.render.renderPage as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      readonly mode: string;
      readonly lineWords: ReadonlyArray<unknown> | undefined;
    };
    expect(fullInput.mode).toBe("full");
    expect(fullInput.lineWords).toBeUndefined();
  });
});

// ─── selectLineWords: selección host-side de las palabras de línea (ADR-058 §5) ───
//
// PR 4 del Hito 10.5 (`docs/roadmap/MVP.md` §4): función pura y aislada.
// Cableada a `renderMediatedPreview`/`makeRenderPageProvider.renderFull` en
// `orchestrator.ts` desde el PR 4b (Hito 10.5) -- ver los tests de arriba y
// los de `contract.test.ts` para la cobertura de ese cableado; los de acá
// prueban la función en aislamiento.
describe("selectLineWords — selección host-side de las palabras de línea (ADR-058 §5)", () => {
  it("line-word selection is pure: same input, same output, no retained state", () => {
    const replacement = createReplacement({
      bbox: { x: 0, y: 100, width: 20, height: 12 },
      replacementValue: "[PRS-01]",
    });
    const pageWords = [
      createWord({ text: "Ana", bbox: { x: 0, y: 100, width: 20, height: 12 } }),
      createWord({ text: "vive", bbox: { x: 30, y: 100, width: 25, height: 12 } }),
      createWord({ text: "aquí", bbox: { x: 60, y: 100, width: 25, height: 12 } }),
    ];
    const replacements = [replacement];

    const first = selectLineWords(pageWords, replacements);
    const second = selectLineWords(pageWords, replacements);
    expect(second).toEqual(first);
    expect(first).toEqual([pageWords[1], pageWords[2]]);

    // Una llamada intermedia con datos completamente distintos no puede
    // contaminar una llamada posterior con los datos originales: sin estado
    // retenido entre invocaciones (mismo criterio que los tests de
    // `fuseOcrPage`, ADR-041).
    const otherPageWords = [
      createWord({ text: "otro", bbox: { x: 0, y: 900, width: 100, height: 12 } }),
    ];
    const otherReplacements = [
      createReplacement({ bbox: { x: 0, y: 900, width: 5, height: 12 }, replacementValue: "X" }),
    ];
    selectLineWords(otherPageWords, otherReplacements);

    const third = selectLineWords(pageWords, replacements);
    expect(third).toEqual(first);
  });

  it("groups by vertical band and returns only words to the right of the replacement", () => {
    const replacement = createReplacement({
      bbox: { x: 50, y: 100, width: 20, height: 12 },
      replacementValue: "[PRS-01]",
    });
    const leftWord = createWord({
      text: "izquierda",
      bbox: { x: 0, y: 100, width: 40, height: 12 },
    });
    const rightWord1 = createWord({
      text: "derecha1",
      bbox: { x: 70, y: 100, width: 30, height: 12 },
    });
    const rightWord2 = createWord({
      text: "derecha2",
      bbox: { x: 105, y: 100, width: 30, height: 12 },
    });
    // Otra línea (banda vertical distinta), aunque esté a la derecha en X.
    const otherLineWord = createWord({
      text: "otralinea",
      bbox: { x: 70, y: 300, width: 30, height: 12 },
    });

    const result = selectLineWords(
      [leftWord, rightWord1, otherLineWord, rightWord2],
      [replacement],
    );

    expect(result).toEqual([rightWord1, rightWord2]);
  });

  it("page where every token fits omits lineWords from the payload", () => {
    const replacement = createReplacement({
      // bbox generoso: el token de 8 caracteres entra sin problema.
      bbox: { x: 0, y: 0, width: 200, height: 12 },
      replacementValue: "[DNI 01]",
    });
    const neighbor = createWord({ bbox: { x: 210, y: 0, width: 20, height: 12 } });

    const result = selectLineWords([neighbor], [replacement]);

    expect(result).toBeUndefined();
  });

  it("redact replacements never trigger lineWords attachment (ADR-058, Contexto §1: redact es inmune)", () => {
    const replacement = createReplacement({
      mode: ReplacementMode.Redact,
      // bbox minúsculo + valor larguísimo: cualquier modo con texto
      // desbordaría, pero redact nunca dibuja texto (kernel.ts, fill opaco).
      bbox: { x: 0, y: 0, width: 5, height: 12 },
      replacementValue: "[UNA-CADENA-MUY-LARGA-QUE-JAMAS-ENTRARIA-EN-5PX]",
    });
    const neighbor = createWord({ bbox: { x: 10, y: 0, width: 20, height: 12 } });

    expect(selectLineWords([neighbor], [replacement])).toBeUndefined();
  });

  // ─── ADR-074 §8 (Hito 10.9, PR 10): por fragmento, no por la envolvente ───

  it("selectLineWords with single-rect replacements returns exactly what it returned before", () => {
    const bbox = { x: 50, y: 100, width: 20, height: 12 };
    const neighbor = createWord({ bbox: { x: 70, y: 100, width: 30, height: 12 } });
    const withoutFragments = createReplacement({ bbox, replacementValue: "[PRS-01]" });
    const withRedundantFragment = createReplacement({
      bbox,
      replacementValue: "[PRS-01]",
      fragments: [bbox],
    });

    expect(selectLineWords([neighbor], [withRedundantFragment])).toEqual(
      selectLineWords([neighbor], [withoutFragments]),
    );
  });

  it("selectLineWords picks the neighbours of the fragment's line, not the envelope's", () => {
    // Entidad partida en dos líneas: fragmento angosto al final del primer
    // renglón, fragmento más ancho al principio del segundo (mismo patrón
    // que el caso real de ADR-074, Contexto §1). La envolvente que las
    // contiene a las dos (514 pt) es tan ancha que el token de 22
    // caracteres jamás la desborda — es exactamente el bug que ADR-074 §8
    // describe: "el ancho de 557 pt hace que nada parezca desbordar".
    const fragmentLine1 = { x: 500, y: 100, width: 24, height: 12 };
    const fragmentLine2 = { x: 10, y: 114, width: 90, height: 12 };
    const envelope = { x: 10, y: 100, width: 514, height: 26 };
    const replacement = createReplacement({
      bbox: envelope,
      replacementValue: "[PERSONA MUY LARGA 01]", // 22 caracteres
      fragments: [fragmentLine1, fragmentLine2],
    });

    const neighborLine1 = createWord({
      text: "vecina1",
      bbox: { x: 530, y: 100, width: 20, height: 12 }, // a la derecha de fragmentLine1
    });
    const neighborLine2 = createWord({
      text: "vecina2",
      bbox: { x: 105, y: 114, width: 20, height: 12 }, // a la derecha de fragmentLine2
    });
    // En el hueco vertical ENTRE las dos líneas (no comparte banda con
    // ningún fragmento) pero SÍ con la envolvente, que cubre las dos bandas
    // de punta a punta. Solo aparecería en el resultado si el criterio
    // siguiera comparando contra `replacement.bbox` en vez de contra cada
    // fragmento — la diferencia observable entre los dos caminos.
    const gapDistractor = createWord({
      text: "hueco",
      bbox: { x: 600, y: 113, width: 20, height: 0.5 },
    });

    const result = selectLineWords([gapDistractor, neighborLine1, neighborLine2], [replacement]);

    expect(result).toEqual([neighborLine1, neighborLine2]);
  });

  // ─── findText (ADR-061 §8 errata, §10 bloque "PR 3d") ───

  it("findText returns the same matches as regex.searchText over the retained document, including OCR pages", async () => {
    const document = createDocument({
      pageCount: 2,
      pages: [
        createPage({
          index: 0,
          text: "Jose Perez",
          words: [
            createWord({ text: "Jose", bbox: { x: 0, y: 0, width: 30, height: 12 } }),
            createWord({ text: "Perez", bbox: { x: 35, y: 0, width: 35, height: 12 } }),
          ],
        }),
        createPage({
          index: 1,
          text: "Ana Gomez",
          words: [
            createWord({
              text: "Ana",
              bbox: { x: 0, y: 0, width: 25, height: 12 },
              pageIndex: 1,
              source: "ocr",
            }),
            createWord({
              text: "Gomez",
              bbox: { x: 30, y: 0, width: 40, height: 12 },
              pageIndex: 1,
              source: "ocr",
            }),
          ],
        }),
      ],
    });
    const { orchestrator, engines } = await makeOrchestratorWithRealDetection(
      createPdfEngineOutput({ document }),
    );

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    for (const query of ["Jose Perez", "Ana Gomez"]) {
      expect(orchestrator.findText("doc-1", query)).toEqual(
        engines.regex.searchText({ document, query }),
      );
    }
  });

  it("findText on an unknown documentId throws InvalidInputError, same as getPageWords/getPageSize", async () => {
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
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    expect(() => orchestrator.findText("doc-unknown", "cualquier cosa")).toThrow(InvalidInputError);
  });
});
