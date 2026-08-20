import { PdfInvalidError, PdfPasswordRequiredError } from "@anonly/pdf-engine";
import {
  CancelledError,
  DetectionSource,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EventChannel,
  InvalidInputError,
  PipelineStage,
  type Document,
} from "@anonly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exportBlobKey, previewBlobKey } from "../blob-tracker.js";
import { LruCache } from "../cache.js";
import { selectLineWords } from "../line-words.js";
import { PipelineOrchestrator } from "../orchestrator.js";
import { WorkerPool } from "../worker-pool.js";

import {
  createDeferred,
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
  createRenderPageOutput,
  createReplacement,
  createWord,
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

  // ─── Caso 3 (ADR-049 §6): el error debe inyectarse deserializado — un test
  // que arroja la clase concreta (como el de arriba) pasa igual con el bug
  // vivo, porque el `instanceof` acierta contra la subclase real. Estos dos
  // atraviesan el mismo camino que el transporte real por Worker: el motor
  // sirve `err.serialize()` y el pool reconstruye con `EngineError.deserialize()`
  // un `DeserializedEngineError` genérico, sin la subclase concreta.

  it("deserialized PDF_PASSWORD_REQUIRED keeps stage at Extracting", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    const wireError = EngineError.deserialize(new PdfPasswordRequiredError("doc-1").serialize());
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(wireError);
    const failedSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, failedSpy);

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Extracting);
    expect(failedSpy).not.toHaveBeenCalled();
  });

  it("deserialized PDF_PASSWORD_REQUIRED is not retried by the pool", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    const wireError = EngineError.deserialize(new PdfPasswordRequiredError("doc-1").serialize());
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(wireError);

    await orchestrator.importDocument(createImportInput());

    // Una sola invocación del despacho (el `run` del pool): sin backoff, sin
    // reintento — `wireError.retryable === false` sobrevive al boundary
    // (ADR-049 §4) y el predicado por defecto del pool lo respeta.
    expect(engines.pdf.process).toHaveBeenCalledTimes(1);
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Extracting);
  });

  // ─── Caso 3 (ADR-050 §4): el password sobrevive a la re-extracción y llega
  // hasta RenderEngine.loadDocument. Dos tests que ejercitan los dos call
  // sites de `ensureRenderDocumentLoaded` (§2 del spec): el de abajo pasa por
  // `runOcrStage` (documento con páginas `textless`); el siguiente pasa por
  // la rama directa de `runPipelineFrom` (documento con texto nativo, sin
  // OCR). Los dos leen `retainedInputs` — si `retryWithPassword` no lo
  // reescribiera (defecto 1 del Contexto de ADR-050), `loadDocument`
  // recibiría `undefined` como tercer argumento pese a que la contraseña
  // correcta ya se ingresó.

  it("retryWithPassword persists the password in retainedInputs", async () => {
    const { engines, orchestrator } = makeOrchestrator();
    (engines.pdf.process as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new PdfPasswordRequiredError("doc-1"))
      .mockResolvedValueOnce(
        createPdfEngineOutput({
          document: createDocument({
            sourceKind: "scanned",
            pages: [createPage({ index: 0, requiresOCR: true })],
          }),
          textlessPages: [0],
          sourceKind: "scanned",
        }),
      );

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Extracting);

    await orchestrator.retryWithPassword("doc-1", "test1234");

    // `ensureRenderDocumentLoaded` corre acá desde `runOcrStage` (ADR-034
    // §1), que lee `retainedInputs` — no el `retryInput` local de
    // `retryWithPassword`.
    expect(engines.render.loadDocument).toHaveBeenCalledWith(
      "doc-1",
      expect.any(ArrayBuffer),
      "test1234",
    );
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  it("render loadDocument receives the password after a successful retry", async () => {
    const { engines, orchestrator } = makeOrchestrator(); // doc con texto, sin páginas requiresOCR
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PdfPasswordRequiredError("doc-1"),
    );

    await orchestrator.importDocument(createImportInput());
    // Antes del retry, el pipeline nunca llegó a ensureRenderDocumentLoaded.
    expect(engines.render.loadDocument).not.toHaveBeenCalled();

    await orchestrator.retryWithPassword("doc-1", "test1234");

    // Documento sin páginas requiresOCR: ensureRenderDocumentLoaded se
    // invoca directo desde runPipelineFrom, antes de Detecting (v1.4.1,
    // caso 25) — único call site real a `loadDocument` para este documento.
    expect(engines.render.loadDocument).toHaveBeenCalledTimes(1);
    const [docId, buffer, password] = (engines.render.loadDocument as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, ArrayBuffer, string | undefined];
    expect(docId).toBe("doc-1");
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(password).toBe("test1234");
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

  // ─── ADR-055 §3/§10: lo que resuelve el PdfPool se decodifica, no se castea ───
  //
  // Estos dos tests son el punto entero de D3.2. El pool ignora `run()` y
  // resuelve algo que NO es un `PdfEngineOutput`, tal como haría un PdfWorker
  // desalineado con su consumidor. Con el `dispatch<PdfEngineOutput>` anterior
  // eso compilaba y el pipeline avanzaba con `document`/`textlessPages`
  // undefined — el fallo mudo que ADR-055 existe para cerrar. Ahora
  // `decodePdfEngineOutput` lanza dentro del try de `runExtraction`, y
  // `handleExtractionFailure` lo manda a `failPipeline` (no es
  // PDF_PASSWORD_REQUIRED ni cancelación).

  /**
   * Corre un import completo contra un PdfWorker fake que resuelve `result`
   * (lo que sea) y devuelve el payload del `PIPELINE_FAILED`, si hubo.
   */
  async function importWithPdfWorkerResult(result: unknown): Promise<{
    readonly failedSpy: ReturnType<typeof vi.fn>;
    readonly orchestrator: PipelineOrchestrator;
    readonly engines: ReturnType<typeof createMockEngines>;
  }> {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const pdfWorker = createFakeWorker();

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
      runtime: { workers: { pdf: () => pdfWorker } },
    });

    const failedSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, failedSpy);

    const importPromise = orchestrator.importDocument(createImportInput());
    await vi.waitFor(() => expect(pdfWorker.postMessage).toHaveBeenCalled());
    const runMessage = pdfWorker.postMessage.mock.calls[0]?.[0] as { readonly jobId: string };

    pdfWorker.emitMessage({ type: "COMPLETED", jobId: runMessage.jobId, result });
    await importPromise;

    return { failedSpy, orchestrator, engines };
  }

  it("garbage from the pdf pool fails the pipeline loudly", async () => {
    for (const garbage of [{}, null, "unexpected", []] as ReadonlyArray<unknown>) {
      const { failedSpy, orchestrator, engines } = await importWithPdfWorkerResult(garbage);

      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed);
      expect(failedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "doc-1",
          error: expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }),
        }),
      );
      // El pool despachó remoto de verdad: el fallback in-process nunca corrió,
      // así que el valor decodificado es genuinamente el que cruzó el transporte.
      expect(engines.pdf.process).not.toHaveBeenCalled();
      // Y nunca llegó a etapas posteriores con un documento roto.
      expect(engines.render.loadDocument).not.toHaveBeenCalled();
    }
  });

  it("an enveloped pdf result fails the pipeline instead of advancing silently", async () => {
    // Un `PdfEngineOutput` perfecto, envuelto: la regresión exacta de ADR-055
    // (Contexto §1, donde el NerWorker posteaba `{ spans }`) trasladada a PDF.
    const { failedSpy, orchestrator } = await importWithPdfWorkerResult({
      output: {
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

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed);
    expect(failedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: EngineErrorCode.INVALID_INPUT }),
      }),
    );
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
      // ADR-065 §4: campo requerido de PdfEngineOutput; vacío es el caso
      // normal (la página en cuestión va por textlessPages, no por región).
      ocrRegions: [],
      sourceKind: "scanned" as const,
    };
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pdfOutput);
    // ocr.processPages resuelve con 0 outputs (la página falló internamente y
    // OcrEngine ya la descartó con warning, sin lanzar — comportamiento real).
    (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  // ─── ADR-065 §9: fallo de OCR sobre una región (no una página entera) ───

  it("OCR_PAGE_FAILED over a region leaves the page's native text intact and requiresOCR === false (ADR-065 §9)", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    const nativeWord = createWord({
      text: "confidencial",
      bbox: { x: 10, y: 10, width: 60, height: 12 },
    });
    const region = { pageIndex: 0, bbox: { x: 100, y: 50, width: 200, height: 300 } };
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pages: [
          createPage({ index: 0, requiresOCR: false, words: [nativeWord], text: nativeWord.text }),
        ],
      }),
      // La página tiene texto nativo (no está en textlessPages) y trae una
      // región candidata — camino de ADR-065, no el de página entera.
      textlessPages: [],
      ocrRegions: [region],
    });
    (engines.pdf.process as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pdfOutput);

    // La región falla tras reintentos: OcrEngine emite OCR_PAGE_FAILED, SIN
    // ningún OCR_PAGE_FINISHED para esa página — ninguna fusión corre (ni
    // fuseOcrPage ni fuseOcrRegion). A diferencia del caso 5 de página
    // entera, acá la página YA tenía requiresOCR===false y texto nativo
    // desde la extracción; un fallo de región no debe tocar ninguno de los
    // dos.
    (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (
        inputs: ReadonlyArray<{ readonly documentId: string; readonly pageIndex: number }>,
      ) => {
        for (const input of inputs) {
          bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, {
            documentId: input.documentId,
            pageIndex: input.pageIndex,
            error: {
              code: EngineErrorCode.OCR_PAGE_FAILED,
              engineId: EngineId.Ocr,
              message: "ocr region failed",
              retryable: true,
              details: {},
            },
          });
        }
        return [];
      },
    );

    let regexInputDocument: Document | undefined;
    vi.spyOn(engines.regex, "process").mockImplementation((input) => {
      regexInputDocument = input.document;
      bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: input.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
      return Promise.resolve({ documentId: input.document.id, occurrenceCount: 0, durationMs: 1 });
    });

    await orchestrator.importDocument(createImportInput());

    // El pipeline continúa con warning, no PIPELINE_FAILED (mismo criterio
    // que el caso 5 de página entera).
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    const page = regexInputDocument?.pages[0];
    expect(page?.words).toEqual([nativeWord]);
    expect(page?.requiresOCR).toBe(false);
    // Ninguna fusión corrió: ocrCompleted nunca pasó a true para esta página.
    expect(page?.ocrCompleted).toBe(false);
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
      includeMarkerLegend: false,
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
      includeMarkerLegend: false,
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
      includeMarkerLegend: false,
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

  it("export preparation failure emits PIPELINE_FAILED, no hang (caso 24)", async () => {
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
      includeMarkerLegend: false,
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
      includeMarkerLegend: false,
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

  // ─── Caso 11 (ADR-052 §2, v1.5.4): ningún blob URL tardío sobrevive al cierre ───

  it("late PREVIEW_UPDATED after closeDocument revokes its blob url", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();

    // Grupo con un reemplazo habilitado en la página 0: el seed de
    // GROUPING_FINISHED (ADR-044) dispara un renderPage mediado para esa
    // página al terminar el import.
    const group = createEntityGroup({
      id: "group-late-preview",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));

    // El render mediado del seed queda pendiente "a través" del cierre: la
    // promesa que devuelve renderPage nunca resuelve por sí sola durante el
    // test (renderMediatedPreview es fire-and-forget, no bloquea Ready) --
    // exactamente el render en vuelo del Contexto §1/§2 de ADR-052 que
    // `closeDocument` no espera ni cancela de forma confiable (Contexto §2:
    // ningún render de esta vía es cancelable con `abortRegistry`).
    const deferred = createDeferred<ReturnType<typeof createRenderPageOutput>>();
    vi.spyOn(engines.render, "renderPage").mockReturnValue(deferred.promise);

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    expect(engines.render.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
      }),
      expect.anything(),
    );

    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await orchestrator.closeDocument("doc-1");

    // El render en vuelo "resuelve" después del cierre: lo que el motor real
    // haría al completar ese render es emitir PREVIEW_UPDATED con el blob que
    // ya creó (ADR-034 §5) -- el Orchestrator ya dejó de esperar esa promesa
    // (closeDocument no espera renders en vuelo, ADR-052 §5), así que lo
    // único observable de esa terminación tardía es el evento del bus.
    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 0,
      kind: "anonymized",
      canvasBlobUrl: "blob:late-preview",
    });

    expect(revokeSpy).toHaveBeenCalledWith("blob:late-preview");
    expect(
      orchestrator["blobTracker"].get(previewBlobKey("doc-1", 0, "anonymized")),
    ).toBeUndefined();

    revokeSpy.mockRestore();
    // Limpieza: asienta el mock de renderPage que dejamos pendiente (no deja
    // una promesa sin resolver colgando entre tests; renderMediatedPreview ya
    // tiene su propio `.catch` best-effort, ADR-044 §3).
    deferred.reject(new Error("cleanup"));
    await deferred.promise.catch(() => undefined);
  });

  it("late EXPORT_FINISHED after closeDocument revokes its blob url", async () => {
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    // El export queda en vuelo (deferred nunca resuelto durante el test) --
    // closeDocument no lo espera (ADR-052 §5).
    const deferred = createDeferred<never>();
    (engines.export.export as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: false,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
    await vi.waitFor(() =>
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Exporting),
    );

    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await orchestrator.closeDocument("doc-1");

    // EXPORT_FINISHED tardío del export en vuelo, llegado después del cierre.
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: "doc-1",
      blobUrl: "blob:late-export",
      sizeBytes: 1,
      durationMs: 1,
    });

    expect(revokeSpy).toHaveBeenCalledWith("blob:late-export");
    expect(orchestrator["blobTracker"].get(exportBlobKey("doc-1"))).toBeUndefined();

    revokeSpy.mockRestore();
    // Limpieza: asienta el mock de export() que dejamos pendiente.
    deferred.reject(new Error("cleanup"));
    await deferred.promise.catch(() => undefined);
  });

  it("PREVIEW_UPDATED during unloadDocument await is registered and swept", async () => {
    // El guard nuevo (ADR-052 §2) no debe adelantarse: un PREVIEW_UPDATED que
    // llega MIENTRAS closeDocument todavía está en el `await
    // render.unloadDocument(...)` ve `state.has(documentId) === true` (el
    // `state.delete` corre varias líneas después, sin ningún `await` de por
    // medio hasta ahí) -- tiene que registrarse normal en blobTracker y ser
    // barrido por el `revokeByPrefix` posterior, no revocado inline por el
    // guard.
    const logger = createMockLogger();
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);

    vi.spyOn(engines.render, "unloadDocument").mockImplementation(async () => {
      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 0,
        kind: "original",
        canvasBlobUrl: "blob:mid-unload",
      });
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger,
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await orchestrator.closeDocument("doc-1");

    // Observable idéntico al del guard (URL revocado, no retenido en
    // blobTracker) -- lo que distingue el camino es que NUNCA pasó por el
    // guard de llegada tardía: si hubiera pasado por ahí, habría logueado el
    // warn de "tardío para un documento ya cerrado".
    expect(revokeSpy).toHaveBeenCalledWith("blob:mid-unload");
    expect(orchestrator["blobTracker"].get(previewBlobKey("doc-1", 0, "original"))).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("tardío"),
      expect.anything(),
    );

    revokeSpy.mockRestore();
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

    // ─── ADR-065 §8: unión requiresOCR ∪ ocrRegions retenidas ───

    it(
      "case 20 (ADR-065 §8): ocr.languages over a document with no requiresOCR pages " +
        "but retained ocrRegions re-scans the region instead of no-op-ing silently",
      async () => {
        const bus = createRealBus();
        const engines = createMockEngines();
        const region = { pageIndex: 0, bbox: { x: 100, y: 50, width: 200, height: 300 } };
        const pdfOutput = createPdfEngineOutput({
          document: createDocument({
            // Ninguna página requiresOCR: si el reanalyze mirara solo ese
            // filtro (pre-ADR-065), esto sería un no-op silencioso — la
            // regresión más peligrosa que el ADR cierra.
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
        expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

        (engines.render.rasterizePage as ReturnType<typeof vi.fn>).mockClear();
        (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockClear();
        (engines.regex.process as ReturnType<typeof vi.fn>).mockClear();
        (engines.grouping.dropOccurrences as ReturnType<typeof vi.fn>).mockClear();

        await orchestrator.reanalyze("doc-1", { ocr: { languages: ["eng"] } });

        // La región SE re-escanea: rasterizePage recibe el bbox de la
        // región (recorte, no página completa) y ocr.processPages corre.
        expect(engines.render.rasterizePage).toHaveBeenCalledWith(
          "doc-1",
          0,
          expect.any(Number),
          expect.anything(),
          region.bbox,
        );
        expect(engines.ocr.processPages).toHaveBeenCalled();
        expect(engines.grouping.dropOccurrences).toHaveBeenCalledWith("doc-1", {
          pageIndices: [0],
        });
        expect(engines.regex.process).toHaveBeenCalled();
        expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
      },
    );

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
        includeMarkerLegend: false,
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
        includeMarkerLegend: false,
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

    it("reanalyze with both ner and ocr in one patch is rejected without side effects", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator();
      await orchestrator.importDocument(createImportInput());
      await vi.waitFor(() =>
        expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready),
      );

      const emitSpy = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, emitSpy);
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, emitSpy);
      const reopenSpy = engines.grouping.reopenSession as ReturnType<typeof vi.fn>;
      reopenSpy.mockClear();

      // ADR-081: la regla 4 de ADR-038 §5 prometía "la unión de las reglas
      // anteriores" y nunca se implementó — con ambos campos se entraba solo
      // por `runReanalyzeOcrFlow`, que toca únicamente las páginas re-OCR.
      // Apagar NER dejaba sus ocurrencias vivas en el resto del documento;
      // encenderlo solo lo corría sobre las páginas escaneadas. Los dos
      // fallaban en silencio, con el pipeline llegando a `Ready`.
      await expect(
        orchestrator.reanalyze("doc-1", {
          ner: { enabled: false },
          ocr: { languages: ["eng"] },
        }),
      ).rejects.toThrow(InvalidInputError);

      // El rechazo es previo a cualquier efecto: sin evento, sin cambio de
      // stage, y sin reabrir la sesión de Grouping.
      expect(emitSpy).not.toHaveBeenCalled();
      expect(reopenSpy).not.toHaveBeenCalled();
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      // Y cada campo por separado sigue funcionando: lo que se rechaza es la
      // combinación, no los flujos.
      await expect(
        orchestrator.reanalyze("doc-1", { ner: { enabled: false } }),
      ).resolves.toBeUndefined();
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

    // ─── ADR-044 §3, caso 26: el seed corre también en la vía suprimida ───

    it("seed also runs on suppressed GROUPING_FINISHED after cancelled reanalyze", async () => {
      const { bus, engines, orchestrator } = makeOrchestrator({ nerEnabled: false });
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      const group = createEntityGroup({
        id: "group-cancelled-reanalyze",
        members: [
          {
            occurrenceId: "occ-1",
            pageIndex: 0,
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            source: DetectionSource.Regex,
          },
        ],
      });
      vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
        documentId: docId,
        groups: [group],
        conflicts: [],
        rules: [],
      }));

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
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);
      // v1.5.1: el mock replica el guard real de renderPage (rechaza con
      // CancelledError si la señal ya está abortada, `render.engine.ts`
      // renderPageInternal) — sin esto, el test pasaría de forma vacía
      // incluso si el seed reusara la señal (ya abortada) del documento en
      // vez de la señal propia que exige el fix (Orchestrator.md v1.5.1).
      vi.spyOn(engines.render, "renderPage").mockImplementation((input, ctx) => {
        if (ctx.abortSignal.aborted) {
          return Promise.reject(new CancelledError(input.documentId));
        }
        return Promise.resolve(
          createRenderPageOutput({
            documentId: input.documentId,
            pageIndex: input.pageIndex,
            kind: input.kind,
          }),
        );
      });

      const reanalyzePromise = orchestrator.reanalyze("doc-1", { ner: { enabled: true } });
      await Promise.resolve();
      await Promise.resolve();

      await orchestrator.cancel("doc-1");
      await expect(reanalyzePromise).resolves.toBeUndefined();

      expect(readySpy).not.toHaveBeenCalled(); // PIPELINE_READY derivado, suprimido (ADR-038 §6)
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
      // El seed del preview (ADR-044) corre igual en la vía suprimida por la
      // cancelación: no depende de que PIPELINE_READY llegue a emitirse.
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "doc-1",
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
        }),
        expect.anything(),
      );

      // v1.5.1: el invariante real que este caso prueba — el seed usa una
      // señal PROPIA, nunca la del documento (ya abortada acá por
      // cancelReanalyze, ADR-038 §6). `toHaveBeenCalledWith` de arriba no
      // alcanza para probarlo (pasaría igual aunque el mock hubiera
      // rechazado con CancelledError, ya que solo mira los argumentos, no la
      // resolución) — se toma el `ctx` real recibido y se verifica
      // explícitamente que su `abortSignal` NO está abortada.
      const renderPageCalls = (engines.render.renderPage as ReturnType<typeof vi.fn>).mock.calls;
      const seedCall = renderPageCalls.find(
        (call) => call[0]?.documentId === "doc-1" && call[0]?.pageIndex === 0,
      );
      expect(seedCall).toBeDefined();
      expect(seedCall?.[1]?.abortSignal.aborted).toBe(false);
    });

    // ─── ADR-052 §3 (v1.5.4): el controlador del preview mediado pasa a ser
    // por documento, atado a la BAJA (closeDocument/dispose), no a la
    // cancelación (cancelReanalyze). No-regresión de la v1.5.1: si el
    // controlador nuevo se atara al lugar equivocado (p. ej. si
    // cancelReanalyze terminara abortándolo), este test lo muestra —
    // inspecciona el AbortController directamente, sin depender de que el
    // mock de renderPage reaccione a la señal (a diferencia del caso de
    // arriba, que sí lo necesita para no pasar vacío contra el bug de
    // v1.5.1, ya cerrado).

    it("cancelReanalyze still lets the mediated seed run", async () => {
      const { engines, orchestrator } = makeOrchestrator({ nerEnabled: false });
      await orchestrator.importDocument(createImportInput());
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      // Precondición: el seed del GROUPING_FINISHED del import ya creó el
      // controlador por documento (mediatedPreviewCtx llama incondicional al
      // arrancar seedAnonymizedPreview, aun sin páginas con reemplazos) — si
      // esto fuera undefined, el resto del test probaría algo vacío.
      const controllerBefore = orchestrator["mediatedPreviewControllers"].get("doc-1");
      expect(controllerBefore).toBeDefined();
      expect(controllerBefore?.signal.aborted).toBe(false);

      const group = createEntityGroup({
        id: "group-cancel-reanalyze-controller",
        members: [
          {
            occurrenceId: "occ-1",
            pageIndex: 0,
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            source: DetectionSource.Regex,
          },
        ],
      });
      vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
        documentId: docId,
        groups: [group],
        conflicts: [],
        rules: [],
      }));
      (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

      const deferred = createDeferred<never>();
      (engines.ner.processPages as ReturnType<typeof vi.fn>).mockImplementation(
        (_inputs, ctx: { abortSignal: AbortSignal }) => {
          ctx.abortSignal.addEventListener("abort", () => {
            deferred.reject(new CancelledError("doc-1"));
          });
          return deferred.promise;
        },
      );

      const reanalyzePromise = orchestrator.reanalyze("doc-1", { ner: { enabled: true } });
      await Promise.resolve();
      await Promise.resolve();

      // cancelReanalyze (ADR-038 §6) aborta abortRegistry.abort("doc-1")
      // ANTES de finishSession — el invariante que este test protege: el
      // controlador del preview mediado NO debe abortarse acá, a diferencia
      // de abortRegistry.
      await orchestrator.cancel("doc-1");
      await expect(reanalyzePromise).resolves.toBeUndefined();

      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

      const controllerAfter = orchestrator["mediatedPreviewControllers"].get("doc-1");
      expect(controllerAfter).toBe(controllerBefore); // mismo controlador: no se reemplazó ni se limpió.
      expect(controllerAfter?.signal.aborted).toBe(false); // y sigue sin abortar.

      // Y el seed del GROUPING_FINISHED suprimido (ADR-038 §6, ADR-044 §3)
      // sigue corriendo de verdad con esa señal.
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "doc-1",
          pageIndex: 0,
          kind: "anonymized",
          mode: "preview",
        }),
        expect.objectContaining({ abortSignal: controllerAfter?.signal }),
      );
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

  // ─── Mediación grupos→Render del preview (ADR-044, §13 caso 27) ───

  it("toggle off then on restores the replacement in preview", async () => {
    // Bug 2 de ADR-044: el flush recompone del snapshot completo en cada
    // edición (no de un input previamente filtrado), así que un toggle
    // off→on restaura el reemplazo por construcción.
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    const baseGroup = createEntityGroup({
      id: "group-toggle",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });

    // Paso 1: grupo creado habilitado -> el flush pinta el reemplazo.
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [{ ...baseGroup, enabled: true }],
      conflicts: [],
      rules: [],
    }));
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group: { ...baseGroup, enabled: true },
    });
    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({
          pageIndex: 0,
          replacements: [expect.objectContaining({ groupId: "group-toggle" })],
        }),
        expect.anything(),
      );
    });

    // Paso 2: toggle off -> el flush recomputa con replacements: [].
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [{ ...baseGroup, enabled: false }],
      conflicts: [],
      rules: [],
    }));
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group: { ...baseGroup, enabled: false },
      changes: ["enabled"],
    });
    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({ pageIndex: 0, replacements: [] }),
        expect.anything(),
      );
    });

    // Paso 3 (bug 2): toggle back on -> el reemplazo se restaura porque el
    // flush recompone del snapshot vigente, no de un input filtrado previo.
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [{ ...baseGroup, enabled: true }],
      conflicts: [],
      rules: [],
    }));
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group: { ...baseGroup, enabled: true },
      changes: ["enabled"],
    });
    await vi.waitFor(() => {
      expect(engines.render.renderPage).toHaveBeenCalledWith(
        expect.objectContaining({
          pageIndex: 0,
          replacements: [expect.objectContaining({ groupId: "group-toggle" })],
        }),
        expect.anything(),
      );
    });
  });

  it("group edit during Exporting flushes preview render", async () => {
    // Caso 15/27: la edición fluye a Grouping sin pasar por el pipeline,
    // incluso durante Exporting — el flush del preview corre igual.
    const { bus, engines, orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());

    const deferred = createDeferred<never>();
    (engines.export.export as ReturnType<typeof vi.fn>).mockReturnValue(deferred.promise);

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: false,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });
    await vi.waitFor(() =>
      expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Exporting),
    );

    const group = createEntityGroup({
      id: "group-exporting-edit",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));
    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group,
      changes: ["replacementMode"],
    });

    await vi.waitFor(() => {
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

    deferred.reject(new Error("cleanup"));
    await vi.waitFor(() => expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Failed));
  });

  it("seed render failure warns without PIPELINE_FAILED", async () => {
    // El preview mediado es best-effort (ADR-044 §3): un fallo de render del
    // seed nunca escala a PIPELINE_FAILED.
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);

    const group = createEntityGroup({
      id: "group-seed-fail",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));
    vi.spyOn(engines.render, "renderPage").mockRejectedValue(new Error("seed render boom"));

    const logger = createMockLogger();
    const failedSpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, failedSpy);

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger,
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    expect(failedSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("preview"),
        expect.objectContaining({ documentId: "doc-1" }),
      );
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

  // ─── getPageWords/getPageSize (ADR-061 §4) ───

  it("getPageWords/getPageSize on unknown documentId or pageIndex throw InvalidInputError", async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);

    expect(() => orchestrator.getPageWords("doc-unknown", 0)).toThrow(InvalidInputError);
    expect(() => orchestrator.getPageSize("doc-unknown", 0)).toThrow(InvalidInputError);
    expect(() => orchestrator.getPageWords("doc-1", 99)).toThrow(InvalidInputError);
    expect(() => orchestrator.getPageSize("doc-1", 99)).toThrow(InvalidInputError);

    // Camino feliz: el guard no rompe el acceso a una página válida.
    expect(orchestrator.getPageWords("doc-1", 0)).toEqual([]);
    expect(orchestrator.getPageSize("doc-1", 0)).toEqual({ width: 595, height: 842 });
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

// ─── selectLineWords — caso borde de origen (ADR-058 §5) ───
describe("selectLineWords — origen de las palabras (ADR-058 §5)", () => {
  it('OCR words (source: "ocr") are selected like PDF words', () => {
    const replacement = createReplacement({
      bbox: { x: 0, y: 0, width: 20, height: 12 },
      replacementValue: "[PRS-01]",
    });
    const pdfWord = createWord({ source: "pdf", bbox: { x: 25, y: 0, width: 20, height: 12 } });
    const ocrWord = createWord({ source: "ocr", bbox: { x: 50, y: 0, width: 20, height: 12 } });

    const result = selectLineWords([pdfWord, ocrWord], [replacement]);

    expect(result).toEqual([pdfWord, ocrWord]);
  });
});
