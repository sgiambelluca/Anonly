import { PdfInvalidError, PdfPasswordRequiredError } from "@anonly/pdf-engine";
import {
  CancelledError,
  DetectionSource,
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
import { WorkerPool } from "../worker-pool.js";

import {
  createDeferred,
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

  // ─── Caso 6 (ADR-034 §2), progreso granular: PIPELINE_PROGRESS con NER off ───

  it("NER disabled emits PIPELINE_PROGRESS current = total = pageCount after REGEX_FINISHED", async () => {
    const { bus, orchestrator } = makeOrchestrator({ nerEnabled: false });
    const progressSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, progressSpy);

    await orchestrator.importDocument(createImportInput());

    // Documento por defecto de los fixtures: pageCount 1 (createDocument()).
    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        stage: PipelineStage.Detecting,
        current: 1,
        total: 1,
      }),
    );
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

  // ─── Casos 23-25 (v1.2.1 bug #6 del Escenario 1 E2E + v1.4.1 bug del visor
  // en blanco para documentos con texto nativo — sin ADR, restauran
  // invariantes ya especificadas en §2/§12; ver nota de cabecera del spec) ───

  it("engines receive a copy: retained buffer stays intact if engine detaches its input (caso 23)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (input: { documentId: string; buffer: ArrayBuffer }) => {
        // Simula lo que hace pdfjs-dist de verdad: transfiere el buffer que
        // recibió a su worker interno, dejándolo detached del lado del motor.
        structuredClone(input.buffer, { transfer: [input.buffer] });
        expect(input.buffer.byteLength).toBe(0);
        return createPdfEngineOutput();
      },
    );

    const importInput = createImportInput();
    await orchestrator.importDocument(importInput);

    // El buffer del caller (mismo que retiene el Orchestrator) nunca se tocó:
    // el motor recibió una copia (`slice(0)`), no el original.
    expect(importInput.buffer.byteLength).toBeGreaterThan(0);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
    await vi.waitFor(() => expect(engines.render.loadDocument).toHaveBeenCalled());

    // El buffer retenido sigue íntegro para la siguiente entrega (Render, en
    // el export): otra copia distinta, también con bytes usables.
    const [, renderBuffer] = (engines.render.loadDocument as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, ArrayBuffer];
    expect(renderBuffer.byteLength).toBeGreaterThan(0);
  });

  it("no-OCR document loads Render right after extraction, before Ready (caso 25)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator(); // doc con texto, sin páginas requiresOCR
    const readySpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);

    await orchestrator.importDocument(createImportInput());

    // v1.4.1: `render.loadDocument` ya se invocó para cuando importDocument()
    // resuelve (y por lo tanto para cuando ya se emitió PIPELINE_READY),
    // *sin* haber emitido ningún EXPORT_REQUESTED — ya no queda diferido al
    // export (fix del visor en blanco, nota de cabecera del spec).
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(engines.render.loadDocument).toHaveBeenCalledTimes(1);
    const [docId, buffer] = (engines.render.loadDocument as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, ArrayBuffer];
    expect(docId).toBe("doc-1");
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(engines.export.export).not.toHaveBeenCalled();
  });

  it("export after import reuses the already-loaded Render document (no reload) (caso 23)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator(); // doc con texto, sin páginas requiresOCR
    await orchestrator.importDocument(createImportInput());

    // v1.4.1 (caso 25): sin OCR, `render.loadDocument` ya se invocó al cerrar
    // la etapa de extracción, antes de Ready — ya no queda diferido al
    // export (antes de v1.4.1 esta aserción era `not.toHaveBeenCalled()`,
    // fijando el bug del visor en blanco como comportamiento esperado).
    expect(engines.render.loadDocument).toHaveBeenCalledTimes(1);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
    await vi.waitFor(() => expect(engines.export.export).toHaveBeenCalled());

    // El guard `renderLoadedDocuments` (§2: "una sola vez por documento")
    // evita una segunda carga: el export reusa el documento ya cargado.
    expect(engines.render.loadDocument).toHaveBeenCalledTimes(1);
    const [docId, buffer] = (engines.render.loadDocument as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, ArrayBuffer];
    expect(docId).toBe("doc-1");
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("loadDocument failure during export emits PIPELINE_FAILED, no hang (caso 24)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    // v1.4.1 (caso 25): `render.loadDocument` ya se invocó y tuvo éxito
    // durante la propia importación (antes de Ready) — `renderLoadedDocuments`
    // ya tiene la entrada, así que `ensureRenderDocumentLoaded` en runExport
    // ya no vuelve a invocar `loadDocument` (guard de "una sola vez por
    // documento", §2; ver también el test anterior). El fallo de
    // "preparación del export" del caso 24 se fuerza acá con el siguiente
    // paso de esa preparación (`getSnapshot`) en lugar de `loadDocument`,
    // preservando exactamente lo que el caso 24 verifica: cualquier fallo
    // dentro del try de runExport enruta a failPipeline -> PIPELINE_FAILED,
    // sin colgar el pipeline y sin invocar export.export().
    (engines.grouping.getSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new InvalidInputError("fallo simulado en preparación de export.", {
        documentId: "doc-1",
      });
    });

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
    expect(engines.export.export).not.toHaveBeenCalled();
  });

  it("EXPORT_REQUESTED handler never produces unhandled rejection (caso 24, seatbelt .catch)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    // v1.4.1 (caso 25): igual que en el test anterior, `loadDocument` ya no
    // puede fallar en este punto (ya se cargó con éxito durante el import) —
    // se fuerza el primer fallo (el que hace entrar a runExport en su catch)
    // con getSnapshot en lugar de loadDocument.
    (engines.grouping.getSnapshot as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new InvalidInputError("fallo simulado en preparación de export.", {
        documentId: "doc-1",
      });
    });

    // Fuerza un SEGUNDO fallo, esta vez DENTRO del propio catch de runExport:
    // failPipeline emite PIPELINE_FAILED como su último paso — si ese emit
    // lanza, la excepción escapa del catch que la originó (no se puede
    // atrapar la excepción del propio catch), sube por
    // runExportChain/enqueueExport, y solo el `.catch` terminal de
    // handleExportRequested puede evitar que se vuelva un unhandled
    // rejection. Es el único seam público (sin castear privados del
    // Orchestrator, Code_Standards.md §10) para ejercitar el seatbelt de
    // verdad: `bus` es la misma instancia real que recibió el Orchestrator
    // en su constructor, así que espiar su método público `emit` no
    // necesita ningún cast sobre un tipo propio.
    const originalEmit = bus.emit.bind(bus);
    vi.spyOn(bus, "emit").mockImplementation(((
      channel: EventChannel,
      event: EngineEvents,
      payload: unknown,
    ) => {
      if (channel === EventChannel.Pipeline && event === EngineEvents.PIPELINE_FAILED) {
        throw new Error("fallo inesperado al emitir PIPELINE_FAILED");
      }
      return originalEmit(channel, event, payload as never);
    }) as typeof bus.emit);

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    // Deja correr toda la cadena async (loadDocument rechaza -> failPipeline
    // -> bus.emit(PIPELINE_FAILED) lanza -> escapa hasta el .catch de
    // handleExportRequested) antes de verificar.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
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
    // ADR-041 §2: PdfEngine ya no retiene documentos; closeDocument() no
    // invoca releaseDocument (eliminado junto con el método).
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

  // ─── reanalyze (ADR-038 §1, casos 18-22 de Orchestrator.md §13) ───

  describe("reanalyze", () => {
    // ─── Caso 18: ner.enabled false -> true ───

    it("case 18: ner false→true reopens session, dispatches NER only, Regex is not re-run", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator({ nerEnabled: false });
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      (engines.regex.process as ReturnType<typeof vi.fn>).mockClear();
      vi.spyOn(engines.ner, "processPages").mockImplementation(async (inputs) => {
        bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
          documentId: "doc-1",
          occurrenceCount: 0,
          durationMs: 1,
        });
        await engines.grouping.finishSession("doc-1");
        return inputs.map((i) => ({
          documentId: i.documentId,
          pageIndex: i.pageIndex,
          occurrences: [],
          durationMs: 1,
        }));
      });

      const readySpy = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);

      await orchestrator.reanalyze("doc-1", { ner: { enabled: true } });

      expect(engines.grouping.reopenSession).toHaveBeenCalledWith("doc-1", {
        expectRegex: false,
        expectNer: true,
      });
      expect(engines.regex.process).not.toHaveBeenCalled();
      expect(engines.ner.processPages).toHaveBeenCalled();
      expect(readySpy).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-1" }));
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    // ─── Caso 19: ner.enabled true -> false ───

    it("case 19: ner true→false drops NER occurrences and finishes synchronously (no dispatch)", async () => {
      const { engines, orchestrator } = makeOrchestrator(); // ner enabled por defecto
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      (engines.ner.processPages as ReturnType<typeof vi.fn>).mockClear();
      (engines.regex.process as ReturnType<typeof vi.fn>).mockClear();

      await orchestrator.reanalyze("doc-1", { ner: { enabled: false } });

      expect(engines.grouping.reopenSession).toHaveBeenCalledWith("doc-1", {
        expectRegex: false,
        expectNer: false,
      });
      expect(engines.grouping.dropOccurrences).toHaveBeenCalledWith("doc-1", {
        source: DetectionSource.NER,
      });
      expect(engines.ner.processPages).not.toHaveBeenCalled();
      expect(engines.regex.process).not.toHaveBeenCalled();
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    // ─── Caso 20: ocr.languages sobre páginas requiresOCR ───

    it("case 20: ocr.languages re-OCRs requiresOCR pages, then Regex full-doc + NER on re-OCR pages only", async () => {
      const bus = createRealBus();
      const engines = createMockEngines();
      const pdfOutput = createPdfEngineOutput({
        document: createDocument({
          pageCount: 2,
          pages: [
            createPage({ index: 0, requiresOCR: true }),
            createPage({ index: 1, requiresOCR: false }),
          ],
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

      (engines.render.rasterizePage as ReturnType<typeof vi.fn>).mockClear();
      (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockClear();
      (engines.regex.process as ReturnType<typeof vi.fn>).mockClear();
      (engines.ner.processPages as ReturnType<typeof vi.fn>).mockClear();

      await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

      expect(engines.grouping.reopenSession).toHaveBeenCalledWith("doc-1", {
        expectRegex: true,
        expectNer: true,
      });
      expect(engines.grouping.dropOccurrences).toHaveBeenCalledWith("doc-1", {
        pageIndices: [0],
      });
      expect(engines.render.rasterizePage).toHaveBeenCalledWith(
        "doc-1",
        0,
        expect.any(Number),
        expect.anything(),
      );
      expect(engines.ocr.processPages).toHaveBeenCalled();
      expect(engines.regex.process).toHaveBeenCalled();
      expect(engines.ner.processPages).toHaveBeenCalledWith(
        [expect.objectContaining({ documentId: "doc-1", pageIndex: 0 })],
        expect.anything(),
      );
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    it("case 20: ocr.languages with no requiresOCR pages is a no-op (config updates, no re-detection)", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator(); // doc default: sin páginas requiresOCR
      await orchestrator.importDocument(createImportInput());

      const stageChangedSpy = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, stageChangedSpy);
      (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockClear();

      await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

      expect(engines.ocr.processPages).not.toHaveBeenCalled();
      expect(stageChangedSpy).not.toHaveBeenCalled();
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    // ─── Caso 21: precondiciones y validación de patch ───

    it("case 21: reanalyze while stage is not Ready/Failed rejects with InvalidInputError", async () => {
      const { engines, orchestrator } = makeOrchestrator();
      const deferred = createDeferred<never>();
      (engines.pdf.process as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise);

      const importPromise = orchestrator.importDocument(createImportInput());
      await Promise.resolve();

      await expect(orchestrator.reanalyze("doc-1", { ner: { enabled: false } })).rejects.toThrow(
        InvalidInputError,
      );

      deferred.reject(new Error("cleanup"));
      await importPromise.catch(() => undefined);
    });

    it("case 21: empty patch rejects with InvalidInputError", async () => {
      const { orchestrator } = makeOrchestrator();
      await orchestrator.importDocument(createImportInput());

      await expect(orchestrator.reanalyze("doc-1", {})).rejects.toThrow(InvalidInputError);
    });

    it("case 21: patch with an unsupported field rejects with InvalidInputError", async () => {
      const { orchestrator } = makeOrchestrator();
      await orchestrator.importDocument(createImportInput());

      // Objeto construido vía variable (no literal directo en la llamada):
      // TS no aplica excess-property-check sobre variables, así que esto
      // compila sin necesidad de ningún cast — el campo extra es real en
      // runtime y es exactamente lo que valida la precondición del spec.
      const invalidPatch = { ner: { enabled: true }, unsupported: true };
      await expect(orchestrator.reanalyze("doc-1", invalidPatch)).rejects.toThrow(
        InvalidInputError,
      );
    });

    it("case 21: patch identical to the effective config is a no-op without events", async () => {
      const { bus, orchestrator } = makeOrchestrator(); // default: ner enabled, ocr ["spa","eng"]
      await orchestrator.importDocument(createImportInput());

      const anySpy = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, anySpy);
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, anySpy);

      await orchestrator.reanalyze("doc-1", { ner: { enabled: true } });

      expect(anySpy).not.toHaveBeenCalled();
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    // ─── Caso 21 (ADR-040): Done es el equivalente operativo de Ready ───

    it("reanalyze accepted from Done stage", async () => {
      const { bus, orchestrator } = makeOrchestrator();
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      const options = {
        imageFormat: "jpeg" as const,
        jpegQuality: 0.85,
        dpi: 150,
        includeOriginalMetadata: false as const,
        filename: "out.pdf",
      };
      bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
      await vi.waitFor(() => expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Done));

      await expect(
        orchestrator.reanalyze("doc-1", { ner: { enabled: false } }),
      ).resolves.toBeUndefined();
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });

    it("reanalyze still rejected during Exporting", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator();
      await orchestrator.importDocument(createImportInput());

      const deferred = createDeferred<never>();
      (engines.export.export as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise);

      const options = {
        imageFormat: "jpeg" as const,
        jpegQuality: 0.85,
        dpi: 150,
        includeOriginalMetadata: false as const,
        filename: "out.pdf",
      };
      bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
      await vi.waitFor(() =>
        expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Exporting),
      );

      await expect(orchestrator.reanalyze("doc-1", { ner: { enabled: false } })).rejects.toThrow(
        InvalidInputError,
      );

      deferred.reject(new Error("cleanup"));
      await vi.waitFor(() =>
        expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed),
      );
    });

    // ─── Caso 22: cancelación durante un reanalyze ───

    it("case 22: CANCEL_REQUESTED during reanalyze preserves merged occurrences and returns to Ready (not Cancelled)", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator({ nerEnabled: false });
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      const deferred = createDeferred<never>();
      (engines.ner.processPages as ReturnType<typeof vi.fn>).mockImplementation(
        (_inputs, ctx: { abortSignal: AbortSignal }) => {
          ctx.abortSignal.addEventListener("abort", () => {
            deferred.reject(new CancelledError("doc-1"));
          });
          return deferred.promise;
        },
      );

      const readySpy = vi.fn();
      const cancelledSpy = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, cancelledSpy);

      const reanalyzePromise = orchestrator.reanalyze("doc-1", { ner: { enabled: true } });
      await Promise.resolve();
      await Promise.resolve();

      await orchestrator.cancel("doc-1");
      await expect(reanalyzePromise).resolves.toBeUndefined();

      expect(cancelledSpy).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-1" }));
      expect(readySpy).not.toHaveBeenCalled(); // PIPELINE_READY derivado, suprimido
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready); // no Cancelled
      expect(engines.grouping.finishSession).toHaveBeenCalled();
    });

    it("case 22: reanalyze can run again after a cancelled reanalyze (AbortController reset)", async () => {
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
        config: createEngineConfig({
          ner: {
            modelId: "x",
            quantization: "q8",
            confidenceThreshold: 0.7,
            batchSize: 1,
            enabled: false,
          },
        }),
        engines,
      });

      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      const deferred = createDeferred<never>();
      vi.spyOn(engines.ner, "processPages")
        .mockImplementationOnce((_inputs, ctx) => {
          ctx.abortSignal.addEventListener("abort", () => {
            deferred.reject(new CancelledError("doc-1"));
          });
          return deferred.promise;
        })
        .mockImplementation(async (inputs) => {
          bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
            documentId: "doc-1",
            occurrenceCount: 0,
            durationMs: 1,
          });
          await engines.grouping.finishSession("doc-1");
          return inputs.map((i) => ({
            documentId: i.documentId,
            pageIndex: i.pageIndex,
            occurrences: [],
            durationMs: 1,
          }));
        });

      // Primer reanalyze (ner off->on): se cancela en vuelo.
      const reanalyzePromise = orchestrator.reanalyze("doc-1", { ner: { enabled: true } });
      await Promise.resolve();
      await Promise.resolve();
      await orchestrator.cancel("doc-1");
      await reanalyzePromise;
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      // Segundo reanalyze (ocr.languages): despacha un job real a un pool
      // con `signal: ctx.abortSignal`. Si el AbortController del documento
      // no se hubiera reseteado tras la cancelación, este dispatch
      // rechazaría de inmediato con CancelledError y el stage quedaría
      // trabado en OCRing en vez de volver a Ready.
      await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    });
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

describe("WorkerPool — transporte postMessage, casos límite (Hito 10, ADR-036 §2/§3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRemotePool(worker: ReturnType<typeof createFakeWorker>): WorkerPool {
    return new WorkerPool({
      poolKey: "render",
      jobType: "render-page",
      size: 1,
      maxQueue: 10,
      maxRetries: 0,
      baseRetryDelayMs: 1,
      maxRetryDelayMs: 1,
      bus: createRealBus(),
      logger: createMockLogger(),
      workerFactory: () => worker,
    });
  }

  it("un mensaje con `type` desconocido se ignora sin romper el job en curso", async () => {
    const worker = createFakeWorker();
    const pool = makeRemotePool(worker);

    const dispatchPromise = pool.dispatch({
      run: vi.fn(),
      payload: {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

    // Mensaje sin `type` reconocido y mensaje sin forma de objeto: ambos se descartan.
    worker.emitRawMessage({ foo: "bar" });
    worker.emitRawMessage("not-an-object");

    worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
    await expect(dispatchPromise).resolves.toBe("ok");
  });

  it("un mensaje tardío para un jobId ya resuelto no tiene efecto", async () => {
    const worker = createFakeWorker();
    const pool = makeRemotePool(worker);

    const dispatchPromise = pool.dispatch({
      run: vi.fn(),
      payload: {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

    worker.emitMessage({ type: "COMPLETED", jobId, result: "first" });
    await expect(dispatchPromise).resolves.toBe("first");

    // Mensaje tardío (p. ej. una entrega duplicada): no debe lanzar ni afectar nada.
    expect(() => worker.emitMessage({ type: "COMPLETED", jobId, result: "stale" })).not.toThrow();
  });

  it("LOG con meta no-objeto se envuelve antes de pasar a ctx.logger; meta objeto se reenvía tal cual", async () => {
    const worker = createFakeWorker();
    const logger = createMockLogger();
    const pool = new WorkerPool({
      poolKey: "render",
      jobType: "render-page",
      size: 1,
      maxQueue: 10,
      maxRetries: 0,
      baseRetryDelayMs: 1,
      maxRetryDelayMs: 1,
      bus: createRealBus(),
      logger,
      workerFactory: () => worker,
    });

    const dispatchPromise = pool.dispatch({
      run: vi.fn(),
      payload: {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const jobId = (worker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string }).jobId;

    worker.emitMessage({ type: "LOG", level: "warn", message: "primitivo", meta: 42 });
    expect(logger.warn).toHaveBeenCalledWith("primitivo", { value: 42 });

    worker.emitMessage({ type: "LOG", level: "info", message: "objeto", meta: { pageIndex: 1 } });
    expect(logger.info).toHaveBeenCalledWith("objeto", { pageIndex: 1 });

    worker.emitMessage({ type: "LOG", level: "debug", message: "sin meta" });
    expect(logger.debug).toHaveBeenCalledWith("sin meta", undefined);

    worker.emitMessage({ type: "COMPLETED", jobId, result: "ok" });
    await expect(dispatchPromise).resolves.toBe("ok");
  });

  it("dispose() rechaza jobs remotos pendientes con CancelledError y manda DISPOSE + terminate al worker", async () => {
    const worker = createFakeWorker();
    const pool = makeRemotePool(worker);

    const dispatchPromise = pool.dispatch({
      run: vi.fn(),
      payload: {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());

    pool.dispose();

    await expect(dispatchPromise).rejects.toThrow(CancelledError);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "DISPOSE" });
    expect(worker.terminate).toHaveBeenCalled();
  });
});
