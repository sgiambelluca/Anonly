import { PdfInvalidError, PdfPasswordRequiredError } from "@anonly/pdf-engine";
import {
  CancelledError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EventChannel,
  InvalidInputError,
  PipelineStage,
} from "@anonly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LruCache } from "../cache.js";
import { PipelineOrchestrator } from "../orchestrator.js";

import {
  createDeferred,
  createEngineConfig,
  createImportInput,
  createMockEngines,
  createMockLogger,
  createRealBus,
  wireHappyPathSpies,
} from "./fixtures/test-helpers.js";

describe("Orchestrator — edge cases", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeOrchestrator(overrides?: { readonly nerEnabled?: boolean }): {
    readonly bus: ReturnType<typeof createRealBus>;
    readonly engines: ReturnType<typeof createMockEngines>;
    readonly orchestrator: PipelineOrchestrator;
  } {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(
      engines,
      bus,
      overrides?.nerEnabled !== undefined ? { nerEnabled: overrides.nerEnabled } : undefined,
    );
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(
        overrides?.nerEnabled === false
          ? {
              ner: {
                modelId: "x",
                quantization: "q8",
                confidenceThreshold: 0.7,
                batchSize: 1,
                enabled: false,
              },
            }
          : undefined,
      ),
      engines,
    });
    return { bus, engines, orchestrator };
  }

  // ─── Caso 3: password retry ───

  it("password retry re-runs extraction", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PdfPasswordRequiredError("doc-1"),
    );

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Extracting);

    await orchestrator.retryWithPassword("doc-1", "test1234");

    expect(engines.pdf.process).toHaveBeenCalledTimes(2);
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  // ─── Caso 4: PDF_INVALID ───

  it("PDF_INVALID emits PIPELINE_FAILED and frees resources", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PdfInvalidError("doc-1", "header inválido"),
    );
    const failedSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, failedSpy);

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed);
    expect(failedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        error: expect.objectContaining({ code: "PDF_INVALID" }),
      }),
    );

    // Recursos liberados: se puede importar un documento *distinto* de inmediato (MVP, un activo).
    await expect(
      orchestrator.importDocument(createImportInput({ documentId: "doc-2" })),
    ).resolves.toBeUndefined();
  });

  // ─── Caso 5: OCR de una página falla, el pipeline continúa ───

  it("failed OCR page skipped with warning, pipeline continues", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    const pdfOutput = {
      document: {
        id: "doc-1",
        name: "test.pdf",
        pageCount: 1,
        pages: [
          {
            index: 0,
            width: 595,
            height: 842,
            words: [],
            text: "",
            requiresOCR: true,
            ocrCompleted: false,
          },
        ],
        metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
        sourceKind: "scanned" as const,
        importedAt: Date.now(),
      },
      pageCount: 1,
      textlessPages: [0],
      sourceKind: "scanned" as const,
    };
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pdfOutput);
    // ocr.processPages resuelve con 0 outputs (la página falló internamente y
    // OcrEngine ya la descartó con warning, sin lanzar — comportamiento real).
    (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  // ─── Caso 6 (ADR-034 §2): NER desactivado ───

  it("NER disabled skips stage 5 and finishes grouping after REGEX_FINISHED", async () => {
    const { engines, orchestrator } = makeOrchestrator({ nerEnabled: false });

    await orchestrator.importDocument(createImportInput());

    expect(engines.ner.processPages).not.toHaveBeenCalled();
    expect(engines.grouping.finishSession).toHaveBeenCalledWith("doc-1");
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  // ─── Caso 10: doble export se encola ───

  it("double export queues second request", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    const deferred = createDeferred<void>();
    let callCount = 0;
    (engines.export.export as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { documentId: string }) => {
        callCount += 1;
        if (callCount === 1) {
          await deferred.promise;
        }
        bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
          documentId: input.documentId,
          blobUrl: `blob:export-${callCount}`,
          sizeBytes: 1,
          durationMs: 1,
        });
        return {
          documentId: input.documentId,
          buffer: new Uint8Array([1]).buffer,
          sizeBytes: 1,
          durationMs: 1,
        };
      },
    );

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => expect(engines.export.export).toHaveBeenCalledTimes(1));
    expect(engines.export.export).toHaveBeenCalledTimes(1); // el segundo espera en cola

    deferred.resolve();
    await vi.waitFor(() => expect(engines.export.export).toHaveBeenCalledTimes(2));
  });

  // ─── Caso 11: DOCUMENT_CLOSED durante el pipeline ───

  it("DOCUMENT_CLOSED during pipeline cancels and frees", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    const deferred = createDeferred<never>();
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockImplementation(
      (input: { documentId: string }, ctx: { abortSignal: AbortSignal }) => {
        ctx.abortSignal.addEventListener("abort", () => {
          deferred.reject(new CancelledError(input.documentId));
        });
        return deferred.promise;
      },
    );

    const importPromise = orchestrator.importDocument(createImportInput());
    await Promise.resolve();
    await Promise.resolve();

    await orchestrator.closeDocument("doc-1");
    await expect(importPromise).resolves.toBeUndefined();

    expect(() => orchestrator.getState("doc-1")).toThrow(InvalidInputError);
    expect(engines.pdf.releaseDocument).toHaveBeenCalledWith("doc-1");
    expect(engines.render.unloadDocument).toHaveBeenCalledWith("doc-1");
  });

  // ─── Caso 12: segundo importDocument mientras hay uno activo ───

  it("second importDocument while active rejects", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    const deferred = createDeferred<never>();
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise);

    const firstImport = orchestrator.importDocument(createImportInput({ documentId: "doc-1" }));
    await Promise.resolve();

    await expect(
      orchestrator.importDocument(createImportInput({ documentId: "doc-2" })),
    ).rejects.toThrow(InvalidInputError);

    deferred.reject(new Error("cleanup"));
    await firstImport.catch(() => undefined);
  });

  // ─── §9: restricciones de entrada ───

  it("rejects empty buffer without emitting events", async () => {
    const { bus, orchestrator } = makeOrchestrator();
    const anySpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, anySpy);

    await expect(
      orchestrator.importDocument(createImportInput({ buffer: new ArrayBuffer(0) })),
    ).rejects.toThrow(InvalidInputError);
    expect(anySpy).not.toHaveBeenCalled();
  });

  it("rejects re-importing the same documentId while still open", async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    await expect(orchestrator.importDocument(createImportInput())).rejects.toThrow(
      InvalidInputError,
    );
  });

  // ─── Handlers "pasivos" registrados solo para cumplir la matriz (§11) ───

  it("passive matrix-only subscriptions do not throw when their events fire", async () => {
    const { bus, orchestrator } = makeOrchestrator();
    void orchestrator;

    expect(() => {
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "doc-x",
        pageIndex: 0,
        wordCount: 1,
        requiresOCR: false,
      });
      bus.emit(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
        documentId: "doc-x",
        pageCount: 1,
        textlessPages: [],
        sourceKind: "text",
      });
      bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId: "doc-x" });
      bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, { documentId: "doc-x", reason: "x" });
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_STARTED, {
        documentId: "doc-x",
        pagesToProcess: [],
      });
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_FINISHED, { documentId: "doc-x", durationMs: 1 });
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, {
        documentId: "doc-x",
        pageIndex: 0,
        error: {
          code: EngineErrorCode.OCR_PAGE_FAILED,
          engineId: EngineId.Ocr,
          message: "x",
          retryable: true,
          details: {},
        },
      });
      bus.emit(EventChannel.Ner, EngineEvents.NER_PAGE_FINISHED, {
        documentId: "doc-x",
        pageIndex: 0,
        occurrenceCount: 0,
      });
      bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
        documentId: "doc-x",
        occurrenceCount: 0,
        durationMs: 1,
      });
      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_PAGE_FAILED, {
        documentId: "doc-x",
        pageIndex: 0,
        error: {
          code: EngineErrorCode.RENDER_PAGE_FAILED,
          engineId: EngineId.Render,
          message: "x",
          retryable: true,
          details: {},
        },
      });
      bus.emit(EventChannel.Render, EngineEvents.RENDER_FINISHED, {
        documentId: "doc-x",
        pageIndices: [],
        durationMs: 1,
      });
      bus.emit(EventChannel.Render, EngineEvents.RENDER_FAILED, {
        documentId: "doc-x",
        error: {
          code: EngineErrorCode.RENDER_FAILED,
          engineId: EngineId.Render,
          message: "x",
          retryable: false,
          details: {},
        },
      });
      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_TIMEOUT, {
        jobId: "j1",
        timeoutMs: 1,
      });
      bus.emit(EventChannel.Workers, EngineEvents.WORKER_POOL_SATURATED, {
        type: "pdf-parse",
        queueLength: 1,
      });
    }).not.toThrow();
  });
});
