/**
 * `PipelineOrchestrator` — secuencia las etapas del pipeline (0-11 de
 * `06_Pipeline.md`), despacha jobs a los pools, media la fusión OCR→PDF
 * (ADR-014), gestiona la sesión de Grouping (ADR-034 §2), implementa el
 * `RenderPageProvider` del Export (ADR-034 §3), rastrea/revoca blob URLs
 * (ADR-034 §5) y gestiona la cancelación.
 *
 * Nota de sincronía (importante para leer este archivo): `IEventBus.emit`
 * despacha **síncrono en línea** a los handlers suscritos
 * (`04_Event_System.md` §13). `GroupingEngine.finishSession`/el auto-finish
 * interno (`maybeFinishSession`) no tienen ningún `await` real en su cuerpo:
 * corren íntegramente síncronos hasta emitir `GROUPING_FINISHED`. Por eso,
 * para cuando `await this.engines.regex.process(...)` o
 * `await pool.dispatch(() => this.engines.ner.processPages(...))` resuelven,
 * la cascada completa (Grouping → `GROUPING_FINISHED` → `handleGroupingFinished`
 * de este archivo → `PIPELINE_READY`) ya ocurrió — no hace falta una espera
 * adicional basada en eventos para saber cuándo el pipeline llegó a `Ready`.
 */

import type { ExportEngineInput, RenderPageProvider } from "@anonly/export-engine";
import type { NerPageInput } from "@anonly/ner-engine";
import type { OcrPageInput } from "@anonly/ocr-engine";
import { PdfPasswordRequiredError } from "@anonly/pdf-engine";
import type { PdfEngineOutput } from "@anonly/pdf-engine";
import { RenderFailedError } from "@anonly/render-engine";
import type { RenderPageInput } from "@anonly/render-engine";
import {
  CancelledError,
  DetectionSource,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  PipelineStage,
  type CancelRequested,
  type Document,
  type DocumentClosed,
  type DocumentParsed,
  type EngineConfig,
  type EngineContext,
  type ExportFailed,
  type ExportFinished,
  type ExportOptions,
  type ExportRequested,
  type GroupingFinished,
  type ICache,
  type IEventBus,
  type ILogger,
  type NerPageFinished,
  type OcrPageFailed,
  type OcrPageFinished,
  type PageParsed,
  type PdfInvalid,
  type PdfPasswordRequired,
  type PipelineState,
  type PreviewPageFailed,
  type PreviewUpdated,
  type ReanalyzeConfigPatch,
  type RegexFinished,
  type RenderFailed as RenderFailedPayload,
  type Unsubscribe,
  type Word,
  type WorkerJobTimeout,
  type WorkerPoolSaturated,
} from "@anonly/shared";

import { AbortRegistry } from "./abort-registry.js";
import {
  BlobUrlTracker,
  exportBlobKey,
  exportPrefixFor,
  previewBlobKey,
  previewPrefixFor,
} from "./blob-tracker.js";
import { OrchestratorDisposedError } from "./errors.js";
import { PipelineStateStore } from "./pipeline-state.js";
import type {
  AnonymizationCoreEngines,
  ImportDocumentInput,
  IPipelineOrchestrator,
} from "./types.js";
import { WorkerPoolManager, type PoolKey } from "./worker-pool.js";

function ocrWordsCacheKey(documentId: string, pageIndex: number): string {
  // Formato de clave documentado (ADR-014 §Decisión, ADR-021 §4): el lado
  // host del OcrPool deposita las Word[] acá — hoy, el propio OcrEngine.
  return `ocr-words:${documentId}:${pageIndex}`;
}

// ─── reanalyze (ADR-038 §1): helpers de módulo (sin estado de instancia) ───

const REANALYZE_PATCH_KEYS = new Set(["ner", "ocr"]);

/**
 * Precondición de forma de `ReanalyzeConfigPatch` (ADR-038 §1, caso 21 del
 * spec): vacío o con campos no soportados → `InvalidInputError`. No valida
 * "patch idéntico a la config efectiva" (eso lo decide `reanalyze` una vez
 * mergeado, comparando contra la config efectiva vigente).
 */
function validateReanalyzePatch(patch: ReanalyzeConfigPatch): void {
  if (patch == null) {
    throw new InvalidInputError("ReanalyzeConfigPatch es null o undefined.");
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new InvalidInputError("ReanalyzeConfigPatch vacío: debe incluir 'ner' y/o 'ocr'.");
  }
  for (const key of keys) {
    if (!REANALYZE_PATCH_KEYS.has(key)) {
      throw new InvalidInputError(`Campo no soportado en ReanalyzeConfigPatch: '${key}'.`, {
        field: key,
      });
    }
  }
  if (patch.ner !== undefined && typeof patch.ner.enabled !== "boolean") {
    throw new InvalidInputError("patch.ner.enabled debe ser boolean.");
  }
  if (patch.ocr !== undefined && !Array.isArray(patch.ocr.languages)) {
    throw new InvalidInputError("patch.ocr.languages debe ser un array de strings.");
  }
}

/** Merge de un patch sobre la config efectiva vigente (solo ner.enabled/ocr.languages). */
function mergeReanalyzePatch(current: EngineConfig, patch: ReanalyzeConfigPatch): EngineConfig {
  return {
    ...current,
    ner: patch.ner !== undefined ? { ...current.ner, enabled: patch.ner.enabled } : current.ner,
    ocr: patch.ocr !== undefined ? { ...current.ocr, languages: patch.ocr.languages } : current.ocr,
  };
}

function stringArraysEqual(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export interface PipelineOrchestratorOptions {
  readonly bus: IEventBus;
  readonly logger: ILogger;
  readonly cache: ICache;
  readonly config: EngineConfig;
  readonly engines: AnonymizationCoreEngines;
}

export class PipelineOrchestrator implements IPipelineOrchestrator {
  private readonly bus: IEventBus;
  private readonly logger: ILogger;
  private readonly cache: ICache;
  private readonly config: EngineConfig;
  private readonly engines: AnonymizationCoreEngines;

  private readonly abortRegistry = new AbortRegistry();
  private readonly blobTracker = new BlobUrlTracker();
  private readonly state = new PipelineStateStore();
  private readonly pools: WorkerPoolManager;
  private readonly unsubscribers: Unsubscribe[] = [];

  private readonly documents = new Map<string, Document>();
  private readonly retainedInputs = new Map<string, ImportDocumentInput>();
  private readonly renderLoadedDocuments = new Set<string>();
  private readonly pendingFusions = new Map<string, Array<Promise<void>>>();
  private readonly exportQueues = new Map<string, ExportOptions[]>();
  private readonly exportInProgress = new Set<string>();
  // Config efectiva por documento (ADR-038 §1): inicializada al `config` de
  // la instancia en `importDocument`, actualizada por `reanalyze` mergeando
  // el patch. Única excepción a la inmutabilidad de EngineConfig por sesión
  // (Contracts.md §3.1).
  private readonly effectiveConfigByDocument = new Map<string, EngineConfig>();
  // Documentos con un `reanalyze` en curso (ADR-038 §5-§6): distingue, dentro
  // de `cancel()`, la cancelación de un reanalyze (vuelve a Ready, caso 22)
  // de la cancelación de un importDocument (va a Cancelled, caso 8).
  private readonly reanalyzeInFlight = new Set<string>();
  // Progreso granular por página (PIPELINE_PROGRESS, spec Orchestrator.md
  // §8): un tracker por documento, reasignado al entrar a cada etapa con
  // progreso granular (OCR, luego Detecting con NER activo). `current` nunca
  // supera `total` (ver bumpProgress).
  private readonly progressByDocument = new Map<
    string,
    { readonly total: number; readonly current: number }
  >();

  private activeDocumentId: string | undefined;
  private disposed = false;

  constructor(options: PipelineOrchestratorOptions) {
    this.bus = options.bus;
    this.logger = options.logger;
    this.cache = options.cache;
    this.config = options.config;
    this.engines = options.engines;

    this.pools = new WorkerPoolManager({
      bus: this.bus,
      logger: this.logger,
      getPoolSize: (key) => this.poolSizeFor(key),
      getMaxQueue: (key) => this.config.workerPool.maxQueuePerPool[key],
      getMaxRetries: (jobType) => this.config.workerPool.maxRetries[jobType],
      baseRetryDelayMs: this.config.workerPool.baseRetryDelayMs,
      maxRetryDelayMs: this.config.workerPool.maxRetryDelayMs,
      idleDisposeMs: this.config.workerPool.idleDisposeMs,
    });

    this.wireSubscriptions();
  }

  // ─── IPipelineOrchestrator ───

  async importDocument(input: ImportDocumentInput): Promise<void> {
    this.assertNotDisposed();
    this.validateImportInput(input);

    const { documentId } = input;
    this.activeDocumentId = documentId;
    this.documents.delete(documentId);
    this.retainedInputs.set(documentId, input);
    this.state.create(documentId);
    // ADR-038 §1: seedea la config efectiva del documento con la config de la
    // instancia; reanalyze la actualiza a partir de acá.
    this.effectiveConfigByDocument.set(documentId, this.config);

    const controller = this.abortRegistry.create(documentId);
    const ctx = this.ctxFor(controller.signal, documentId);

    this.bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
      documentId,
      name: input.name,
      sizeBytes: input.buffer.byteLength,
    });
    this.setStage(documentId, PipelineStage.Importing);
    this.setStage(documentId, PipelineStage.Extracting);

    await this.runPipelineFrom(documentId, input, ctx);
  }

  async retryWithPassword(documentId: string, password: string): Promise<void> {
    this.assertNotDisposed();
    const retained = this.retainedInputs.get(documentId);
    if (retained === undefined || !this.state.has(documentId)) {
      throw new InvalidInputError(`No hay un import en curso para ${documentId}.`, { documentId });
    }

    const controller = this.abortRegistry.get(documentId) ?? this.abortRegistry.create(documentId);
    const ctx = this.ctxFor(controller.signal, documentId);
    const retryInput: ImportDocumentInput = { ...retained, password };

    this.setStage(documentId, PipelineStage.Extracting);
    await this.runPipelineFrom(documentId, retryInput, ctx);
  }

  async reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void> {
    this.assertNotDisposed();

    const state = this.state.get(documentId);
    if (
      state === undefined ||
      !(state.stage === PipelineStage.Ready || state.stage === PipelineStage.Failed)
    ) {
      // Caso 21: precondición de stage. También hace que un segundo
      // reanalyze/importDocument concurrente sobre el mismo documento se
      // autorrechace (el stage ya no es Ready/Failed mientras uno corre).
      throw new InvalidInputError(
        `reanalyze requiere stage Ready o Failed para ${documentId} (actual: ${state?.stage ?? "inexistente"}).`,
        { documentId, stage: state?.stage },
      );
    }

    validateReanalyzePatch(patch);

    const currentEffective = this.effectiveConfigFor(documentId);
    const nextEffective = mergeReanalyzePatch(currentEffective, patch);
    const nerChanged = currentEffective.ner.enabled !== nextEffective.ner.enabled;
    const ocrChanged =
      patch.ocr !== undefined &&
      !stringArraysEqual(currentEffective.ocr.languages, nextEffective.ocr.languages);

    if (!nerChanged && !ocrChanged) {
      // Caso 21: patch idéntico a la config efectiva vigente -> no-op sin eventos.
      return;
    }

    this.effectiveConfigByDocument.set(documentId, nextEffective);

    const controller = this.abortRegistry.get(documentId) ?? this.abortRegistry.create(documentId);
    const ctx = this.ctxFor(controller.signal, documentId);

    this.reanalyzeInFlight.add(documentId);
    try {
      if (ocrChanged) {
        // Caso 20/patch combinado (caso "4" de ADR-038 §5): OCR primero, la
        // config NER final decide si además re-corre NER en las páginas re-OCR.
        await this.runReanalyzeOcrFlow(documentId, ctx, nextEffective);
      } else if (nextEffective.ner.enabled) {
        await this.runReanalyzeNerOnFlow(documentId, ctx); // Caso 18.
      } else {
        await this.runReanalyzeNerOffFlow(documentId); // Caso 19.
      }
    } catch (err: unknown) {
      // Caso 22: cancelReanalyze() ya completó la transición a Ready +
      // PIPELINE_CANCELLED; acá no hay nada más que hacer.
      if (err instanceof CancelledError) return;
      this.failPipeline(documentId, err);
    } finally {
      this.reanalyzeInFlight.delete(documentId);
    }
  }

  cancel(documentId: string, jobId?: string): Promise<void> {
    void jobId; // MVP: cancelación total del documento (07_Performance_Strategy.md §9).
    if (!this.state.has(documentId)) return Promise.resolve(); // idempotente
    const current = this.state.get(documentId);
    if (current?.stage === PipelineStage.Cancelled) return Promise.resolve();

    if (this.reanalyzeInFlight.has(documentId)) {
      return this.cancelReanalyze(documentId);
    }

    this.abortRegistry.abort(documentId);
    this.state.update(documentId, { stage: PipelineStage.Cancelled, cancelRequested: true });
    this.releaseActiveDocument(documentId);
    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, {
      documentId,
      reason: "user_requested",
    });
    return Promise.resolve();
  }

  /**
   * Cancelación de un `reanalyze` en curso (ADR-038 §6, caso 22 del spec):
   * a diferencia de cancelar un `importDocument` (caso 8, va a `Cancelled`),
   * acá sí hay un estado editable previo al que volver — el documento sigue
   * cargado, editable y exportable. Se abortan los jobs OCR/NER en vuelo (las
   * ocurrencias ya mergeadas se conservan: Grouping no las descarta al
   * abortar), se cierra la sesión con `finishSession` (renumeración
   * determinista) ANTES de emitir `PIPELINE_CANCELLED`, suprimiendo el
   * `PIPELINE_READY` derivado de ese `GROUPING_FINISHED` (guard por
   * `cancelRequested` en `handleGroupingFinished`), y el stage final es
   * `Ready`, no `Cancelled`. Se resetea el `AbortController` del documento
   * para que operaciones futuras (otro `reanalyze`, un export) no vean una
   * señal ya abortada.
   */
  private async cancelReanalyze(documentId: string): Promise<void> {
    this.abortRegistry.abort(documentId);
    this.state.update(documentId, { cancelRequested: true });

    await this.engines.grouping.finishSession(documentId);

    this.state.update(documentId, { stage: PipelineStage.Ready, cancelRequested: false });
    this.reanalyzeInFlight.delete(documentId);
    this.abortRegistry.release(documentId);
    this.abortRegistry.create(documentId);

    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, {
      documentId,
      reason: "user_requested",
    });
  }

  // ─── Flujos de reanalyze (ADR-038 §5) ───

  /** Caso 18: `ner.enabled: false -> true`. Regex no se re-corre. */
  private async runReanalyzeNerOnFlow(documentId: string, ctx: EngineContext): Promise<void> {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible para reanalyze.`, {
        documentId,
      });
    }

    this.setStage(documentId, PipelineStage.Detecting);
    this.engines.grouping.reopenSession(documentId, { expectRegex: false, expectNer: true });

    this.progressByDocument.set(documentId, { total: document.pageCount, current: 0 });

    const nerInputs: NerPageInput[] = document.pages.map((page) => ({
      documentId,
      pageIndex: page.index,
      text: page.text,
      words: page.words,
    }));

    await this.pools.getPool("ner").dispatch({
      run: () => this.engines.ner.processPages(nerInputs, ctx),
      signal: ctx.abortSignal,
      priority: 80,
    });
    // Auto-finish vía la propia suscripción de GroupingEngine a NER_FINISHED
    // (regexFinished ya es true por reopenSession(expectRegex: false)).
  }

  /** Caso 19: `ner.enabled: true -> false`. Sin despacho asíncrono. */
  private async runReanalyzeNerOffFlow(documentId: string): Promise<void> {
    this.setStage(documentId, PipelineStage.Grouping);
    this.engines.grouping.reopenSession(documentId, { expectRegex: false, expectNer: false });
    this.engines.grouping.dropOccurrences(documentId, { source: DetectionSource.NER });
    await this.engines.grouping.finishSession(documentId);
  }

  /** Caso 20 (+ combinado): `ocr.languages` sobre páginas `requiresOCR`. */
  private async runReanalyzeOcrFlow(
    documentId: string,
    ctx: EngineContext,
    effectiveConfig: EngineConfig,
  ): Promise<void> {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible para reanalyze.`, {
        documentId,
      });
    }

    const ocrPages = document.pages.filter((page) => page.requiresOCR).map((page) => page.index);
    if (ocrPages.length === 0) {
      // Sin páginas OCR: los idiomas de OCR no afectan texto nativo, nada
      // que re-detectar (la config efectiva ya quedó actualizada arriba).
      return;
    }

    this.setStage(documentId, PipelineStage.OCRing);
    this.engines.grouping.reopenSession(documentId, {
      expectRegex: true,
      expectNer: effectiveConfig.ner.enabled,
    });
    this.engines.grouping.dropOccurrences(documentId, { pageIndices: ocrPages });

    await this.runOcrStage(documentId, ocrPages, ctx);

    this.setStage(documentId, PipelineStage.Detecting);
    const updatedDocument = this.documents.get(documentId);
    if (updatedDocument === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible tras re-OCR.`, {
        documentId,
      });
    }

    // Regex sobre el documento completo: el dedup de Grouping (ADR-038 §3)
    // descarta los duplicados de las páginas intactas.
    await this.engines.regex.process({ document: updatedDocument }, ctx);

    if (!effectiveConfig.ner.enabled) return; // handleRegexFinished ya invoca finishSession (ner off).

    const rerunPages = new Set(ocrPages);
    const nerInputs: NerPageInput[] = updatedDocument.pages
      .filter((page) => rerunPages.has(page.index))
      .map((page) => ({ documentId, pageIndex: page.index, text: page.text, words: page.words }));

    this.progressByDocument.set(documentId, { total: nerInputs.length, current: 0 });

    await this.pools.getPool("ner").dispatch({
      run: () => this.engines.ner.processPages(nerInputs, ctx),
      signal: ctx.abortSignal,
      priority: 80,
    });
    // Auto-finish vía GroupingEngine (regex + ner, ambos *_FINISHED).
  }

  async closeDocument(documentId: string): Promise<void> {
    // Idempotente: closeDocument() se auto-dispara de nuevo vía la suscripción
    // a DOCUMENT_CLOSED que él mismo emite al final (para que Grouping, que
    // limpia su sesión por suscripción propia, también reciba el evento).
    if (!this.state.has(documentId) && !this.documents.has(documentId)) return;

    this.abortRegistry.abort(documentId);
    this.abortRegistry.release(documentId);
    this.engines.pdf.releaseDocument(documentId);
    await this.engines.render.unloadDocument(documentId);

    this.renderLoadedDocuments.delete(documentId);
    this.documents.delete(documentId);
    this.retainedInputs.delete(documentId);
    this.pendingFusions.delete(documentId);
    this.exportQueues.delete(documentId);
    this.exportInProgress.delete(documentId);
    this.progressByDocument.delete(documentId);
    this.effectiveConfigByDocument.delete(documentId);
    this.reanalyzeInFlight.delete(documentId);
    this.blobTracker.revokeByPrefix(previewPrefixFor(documentId));
    this.blobTracker.revokeByPrefix(exportPrefixFor(documentId));
    this.state.delete(documentId);
    this.releaseActiveDocument(documentId);

    this.bus.emit(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, { documentId });
  }

  getState(documentId: string): PipelineState {
    return this.state.getOrThrow(documentId);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.abortRegistry.clear();
    this.pools.disposeAll();
    this.blobTracker.revokeAll();
    this.state.clear();
    this.documents.clear();
    this.retainedInputs.clear();
    this.renderLoadedDocuments.clear();
    this.pendingFusions.clear();
    this.exportQueues.clear();
    this.exportInProgress.clear();
    this.progressByDocument.clear();
    this.effectiveConfigByDocument.clear();
    this.reanalyzeInFlight.clear();

    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;

    await Promise.all([
      this.engines.pdf.dispose(),
      this.engines.ocr.dispose(),
      this.engines.regex.dispose(),
      this.engines.ner.dispose(),
      this.engines.grouping.dispose(),
      this.engines.render.dispose(),
      this.engines.export.dispose(),
    ]);
  }

  // ─── Etapas 1-7 (importDocument) ───

  private async runPipelineFrom(
    documentId: string,
    input: ImportDocumentInput,
    ctx: EngineContext,
  ): Promise<void> {
    let pdfOutput: PdfEngineOutput;
    try {
      pdfOutput = await this.pools.getPool("pdf").dispatch({
        run: () =>
          this.engines.pdf.process(
            {
              documentId,
              // v1.2.1 (bug #6, Orchestrator.md nota de cabecera / §12 / caso 23):
              // el motor puede dejar detached el buffer que recibe (pdfjs-dist lo
              // transfiere a su worker interno) — se entrega siempre una copia, el
              // buffer retenido en `retainedInputs` nunca sale del Orchestrator.
              buffer: input.buffer.slice(0),
              ...(input.password !== undefined ? { password: input.password } : {}),
            },
            ctx,
          ),
        signal: ctx.abortSignal,
        priority: 100,
        // 05_Worker_Architecture.md §5 documenta PDF_PASSWORD_REQUIRED como no
        // retryable, pero PdfPasswordRequiredError.retryable === true (pdf-engine,
        // fuera de alcance) — ver nota en DispatchParams.isRetryable.
        isRetryable: (err) =>
          err instanceof EngineError && err.retryable && !(err instanceof PdfPasswordRequiredError),
      });
    } catch (err: unknown) {
      this.handleExtractionFailure(documentId, err);
      return;
    }

    this.documents.set(documentId, pdfOutput.document);

    if (pdfOutput.textlessPages.length > 0) {
      this.setStage(documentId, PipelineStage.OCRing);
      try {
        await this.runOcrStage(documentId, pdfOutput.textlessPages, ctx);
      } catch (err: unknown) {
        if (this.handleCancellationIfAny(documentId, err)) return;
        this.failPipeline(documentId, err);
        return;
      }
    }

    // Etapa 3 (normalización, "shared"): sin acción adicional del Orchestrator.
    // La normalización NFC de Word.text ya ocurre en pdf-engine/ocr-engine
    // (`text.normalize("NFC")`) y `normalizedValue` ya lo computan
    // regex-engine/ner-engine por ocurrencia — no hay una función distinta en
    // `@anonly/shared` que invocar (ver reporte final: ambigüedad reportada,
    // no bloqueante).

    this.setStage(documentId, PipelineStage.Detecting);
    this.engines.grouping.startSession(documentId);

    try {
      await this.runDetectionStage(documentId, ctx);
    } catch (err: unknown) {
      if (this.handleCancellationIfAny(documentId, err)) return;
      this.failPipeline(documentId, err);
    }
  }

  private handleExtractionFailure(documentId: string, err: unknown): void {
    if (err instanceof PdfPasswordRequiredError) {
      // Stage queda en Extracting (ya seteado); espera retryWithPassword
      // (caso límite 3 del spec del Orchestrator).
      return;
    }
    if (this.handleCancellationIfAny(documentId, err)) return;
    this.failPipeline(documentId, err);
  }

  private async runOcrStage(
    documentId: string,
    textlessPages: ReadonlyArray<number>,
    ctx: EngineContext,
  ): Promise<void> {
    const retained = this.retainedInputs.get(documentId);
    if (retained === undefined) {
      throw new InvalidInputError(`No hay buffer retenido para ${documentId}.`, { documentId });
    }

    // Progreso granular OCR (spec Orchestrator.md §8): total fijo para toda
    // la etapa (textlessPages.length de DOCUMENT_PARSED); current arranca en
    // 0 y lo incrementa handleOcrPageFinished por cada OCR_PAGE_FINISHED.
    this.progressByDocument.set(documentId, { total: textlessPages.length, current: 0 });

    // ADR-034 §1: adelanta loadDocument a la etapa 2 (bytes retenidos de la 0).
    // v1.2.1 (bug #6, caso 23): copia — el buffer retenido nunca sale del Orchestrator.
    if (!this.renderLoadedDocuments.has(documentId)) {
      await this.engines.render.loadDocument(documentId, retained.buffer.slice(0));
      this.renderLoadedDocuments.add(documentId);
    }

    const scale = ctx.config.ocr.dpi / 72;
    const renderPool = this.pools.getPool("render");
    const ocrInputs: OcrPageInput[] = [];

    for (const pageIndex of textlessPages) {
      if (ctx.abortSignal.aborted) throw new CancelledError(documentId);
      await renderPool.waitForCapacity();
      const imageData = await renderPool.dispatch({
        run: () => this.engines.render.rasterizePage(documentId, pageIndex, scale, ctx),
        signal: ctx.abortSignal,
        priority: 90,
      });
      ocrInputs.push({
        documentId,
        pageIndex,
        imageData,
        dpi: ctx.config.ocr.dpi,
        languages: ctx.config.ocr.languages,
      });
    }

    const ocrPool = this.pools.getPool("ocr");
    await ocrPool.dispatch({
      run: () => this.engines.ocr.processPages(ocrInputs, ctx),
      signal: ctx.abortSignal,
      priority: 90,
    });

    // La fusión (ADR-014) la dispara `handleOcrPageFinished` por cada página,
    // asincrónicamente respecto del bus; hay que esperar a que todas terminen
    // antes de que Regex/NER vean el Document ya fusionado.
    await this.waitForPendingFusions(documentId);
  }

  private async runDetectionStage(documentId: string, ctx: EngineContext): Promise<void> {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible para detección.`, {
        documentId,
      });
    }

    // Regex en main thread (06_Pipeline.md §14, sin pool). `handleRegexFinished`
    // invoca `grouping.finishSession` si NER está desactivado (ADR-034 §2).
    await this.engines.regex.process({ document }, ctx);

    if (!ctx.config.ner.enabled) return;

    // Progreso granular de detección con NER activo (spec Orchestrator.md
    // §8): total = pageCount del documento; current arranca en 0 y lo
    // incrementa handleNerPageFinished por cada NER_PAGE_FINISHED.
    // REGEX_FINISHED no emite progreso granular (es un evento por
    // documento, no por página).
    this.progressByDocument.set(documentId, { total: document.pageCount, current: 0 });

    const nerInputs: NerPageInput[] = document.pages.map((page) => ({
      documentId,
      pageIndex: page.index,
      text: page.text,
      words: page.words,
    }));

    await this.pools.getPool("ner").dispatch({
      run: () => this.engines.ner.processPages(nerInputs, ctx),
      signal: ctx.abortSignal,
      priority: 80,
    });
    // Grouping auto-finaliza al recibir REGEX_FINISHED + NER_FINISHED por su
    // propia suscripción (sin cambios respecto de Hito 6); no hace falta
    // invocar finishSession acá.
  }

  private handleCancellationIfAny(documentId: string, err: unknown): boolean {
    if (err instanceof CancelledError) {
      this.releaseActiveDocument(documentId);
      return true;
    }
    return false;
  }

  private async waitForPendingFusions(documentId: string): Promise<void> {
    const pending = this.pendingFusions.get(documentId) ?? [];
    this.pendingFusions.delete(documentId);
    await Promise.all(pending);
  }

  // ─── Export (checklist §8, ADR-032 §2) ───

  private enqueueExport(documentId: string, options: ExportOptions): Promise<void> {
    if (this.exportInProgress.has(documentId)) {
      const queue = this.exportQueues.get(documentId) ?? [];
      queue.push(options);
      this.exportQueues.set(documentId, queue);
      return Promise.resolve();
    }
    return this.runExportChain(documentId, options);
  }

  private async runExportChain(documentId: string, options: ExportOptions): Promise<void> {
    this.exportInProgress.add(documentId);
    try {
      await this.runExport(documentId, options);
    } finally {
      this.exportInProgress.delete(documentId);
    }
    const queue = this.exportQueues.get(documentId);
    const next = queue?.shift();
    if (next !== undefined) {
      await this.runExportChain(documentId, next);
    }
  }

  private async runExport(documentId: string, options: ExportOptions): Promise<void> {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      this.logger.warn("EXPORT_REQUESTED para un documento no disponible.", { documentId });
      return;
    }

    const controller = this.abortRegistry.get(documentId) ?? this.abortRegistry.create(documentId);
    const ctx = this.ctxFor(controller.signal, documentId);

    // v1.2.1 (bug #6, caso 24): toda la preparación del export (incluido
    // `loadDocument`) vive dentro del try/catch → `failPipeline`. El guard de
    // buffer retenido ausente pasa de warn+return silencioso a lanzar
    // InvalidInputError — antes el `EXPORT_REQUESTED` no atendido dejaba el
    // pipeline congelado en `Ready` sin ningún evento; ahora siempre resuelve
    // en `EXPORT_FAILED`/`PIPELINE_FAILED` visible en la UI.
    try {
      if (!this.renderLoadedDocuments.has(documentId)) {
        const retained = this.retainedInputs.get(documentId);
        if (retained === undefined) {
          throw new InvalidInputError(
            "No hay buffer retenido para cargar Render antes del export.",
            { documentId },
          );
        }
        await this.engines.render.loadDocument(documentId, retained.buffer.slice(0));
        this.renderLoadedDocuments.add(documentId);
      }

      const snapshot = this.engines.grouping.getSnapshot(documentId);
      const provider = this.makeRenderPageProvider(documentId, options, ctx);

      const exportInput: ExportEngineInput = {
        documentId,
        document,
        groups: snapshot.groups,
        rules: snapshot.rules,
        options,
        renderPageProvider: provider,
      };

      this.setStage(documentId, PipelineStage.Exporting);

      await this.engines.export.export(exportInput, ctx);
    } catch (err: unknown) {
      if (err instanceof CancelledError) return; // caso 9: se descarta, sin más acción.
      // Cubre tanto el caso "EXPORT_FAILED ya emitido" (handleExportFailed ya
      // falló el pipeline; failPipeline es idempotente) como errores previos a
      // cualquier emisión (p. ej. loadDocument, buffer retenido ausente,
      // validateInput de Export).
      this.failPipeline(documentId, err);
    }
  }

  private makeRenderPageProvider(
    documentId: string,
    options: ExportOptions,
    ctx: EngineContext,
  ): RenderPageProvider {
    return {
      renderFull: async (pageIndex, replacements, abortSignal) => {
        const pool = this.pools.getPool("render");
        await pool.waitForCapacity();
        const pageCtx: EngineContext = { ...ctx, abortSignal };
        const renderInput: RenderPageInput = {
          documentId,
          pageIndex,
          kind: "anonymized",
          mode: "full",
          replacements,
          imageFormat: options.imageFormat,
        };
        const output = await pool.dispatch({
          run: () => this.engines.render.renderPage(renderInput, pageCtx),
          signal: abortSignal,
          priority: 1000, // export-page: máxima prioridad (05_Worker_Architecture.md §6.2)
        });
        if (output.encoded === undefined) {
          // No debería pasar: renderPage siempre produce `encoded` en mode "full" (ADR-034 §3).
          throw new RenderFailedError(documentId, "renderPage en mode 'full' no produjo encoded.");
        }
        return output.encoded;
      },
    };
  }

  // ─── Suscripciones del bus ───

  private wireSubscriptions(): void {
    this.unsubscribers.push(
      this.bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, (p) => this.handlePageParsed(p)),
      this.bus.on(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, (p) =>
        this.handleDocumentParsed(p),
      ),
      this.bus.on(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, (p) =>
        this.handlePdfPasswordRequired(p),
      ),
      this.bus.on(EventChannel.Pdf, EngineEvents.PDF_INVALID, (p) => this.handlePdfInvalid(p)),

      this.bus.on(EventChannel.Ocr, EngineEvents.OCR_STARTED, () => undefined),
      this.bus.on(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, (p) =>
        this.handleOcrPageFinished(p),
      ),
      this.bus.on(EventChannel.Ocr, EngineEvents.OCR_FINISHED, () => undefined),
      this.bus.on(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, (p) =>
        this.handleOcrPageFailed(p),
      ),

      this.bus.on(EventChannel.Regex, EngineEvents.REGEX_FINISHED, (p) =>
        this.handleRegexFinished(p),
      ),

      this.bus.on(EventChannel.Ner, EngineEvents.NER_PAGE_FINISHED, (p) =>
        this.handleNerPageFinished(p),
      ),
      this.bus.on(EventChannel.Ner, EngineEvents.NER_FINISHED, () => undefined),

      this.bus.on(EventChannel.Grouping, EngineEvents.GROUPING_FINISHED, (p) =>
        this.handleGroupingFinished(p),
      ),

      this.bus.on(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, (p) =>
        this.handlePreviewUpdated(p),
      ),
      this.bus.on(EventChannel.Render, EngineEvents.PREVIEW_PAGE_FAILED, (p) =>
        this.handlePreviewPageFailed(p),
      ),
      this.bus.on(EventChannel.Render, EngineEvents.RENDER_FINISHED, () => undefined),
      this.bus.on(EventChannel.Render, EngineEvents.RENDER_FAILED, (p) =>
        this.handleRenderFailed(p),
      ),

      this.bus.on(EventChannel.Export, EngineEvents.EXPORT_FINISHED, (p) =>
        this.handleExportFinished(p),
      ),
      this.bus.on(EventChannel.Export, EngineEvents.EXPORT_FAILED, (p) =>
        this.handleExportFailed(p),
      ),

      this.bus.on(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, (p) =>
        this.handleExportRequested(p),
      ),
      this.bus.on(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, (p) =>
        this.handleDocumentClosed(p),
      ),

      this.bus.on(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, (p) =>
        this.handleCancelRequested(p),
      ),

      this.bus.on(EventChannel.Workers, EngineEvents.WORKER_JOB_TIMEOUT, (p) =>
        this.handleWorkerJobTimeout(p),
      ),
      this.bus.on(EventChannel.Workers, EngineEvents.WORKER_POOL_SATURATED, (p) =>
        this.handleWorkerPoolSaturated(p),
      ),
    );
  }

  private handlePageParsed(_payload: PageParsed): void {
    // No emite PIPELINE_PROGRESS acá: PageParsed no trae `total` (pageCount
    // recién llega con DOCUMENT_PARSED) y usar un sentinela `total: 0` está
    // prohibido. El progreso de extracción se emite una única vez, en
    // handleDocumentParsed, con current = total = pageCount. La
    // granularidad por página en extracción requeriría un evento temprano
    // con pageCount que hoy no existe; si la UI la necesita, se decide por
    // ADR en el Hito 10. Suscripción registrada para cumplir la matriz
    // emisor→receptor (04_Event_System.md §11, ADR-034 §4).
  }

  private handleDocumentParsed(payload: DocumentParsed): void {
    // Único punto de progreso de la etapa Extracting (ver handlePageParsed
    // para por qué no se emite por página): current = total = pageCount.
    this.emitProgress(payload.documentId, payload.pageCount, payload.pageCount);
  }

  private handlePdfPasswordRequired(_payload: PdfPasswordRequired): void {
    // El stage ya queda en Extracting vía handleExtractionFailure (el
    // Orchestrator captura PdfPasswordRequiredError del await directo a
    // process()). La UI se suscribe directo al canal pdf (ADR-034 §4); esta
    // suscripción existe para la matriz.
  }

  private handlePdfInvalid(_payload: PdfInvalid): void {
    // PDF_INVALID también llega por el rechazo directo de pdfEngine.process()
    // (ver handleExtractionFailure → failPipeline). Suscripción para la matriz.
  }

  private handleOcrPageFinished(payload: OcrPageFinished): void {
    // Progreso granular OCR (spec Orchestrator.md §8): total fijado en
    // runOcrStage; current incrementa una vez por cada OCR_PAGE_FINISHED,
    // independientemente del resultado de la fusión de abajo. El progreso
    // sub-página que Tesseract reporta vía `PROGRESS` (OCR_Engine.md §185:
    // el worker emite `PROGRESS` al pool, que el Orchestrator traduciría a
    // PIPELINE_PROGRESS) queda diferido: en Hito 9 los pools son colas de
    // concurrencia in-process, sin transporte de eventos de worker real
    // hasta que lleguen los Web Workers reales en el Hito 10 (ADR-035 §2).
    this.bumpProgress(payload.documentId);

    const words = this.cache.get<ReadonlyArray<Word>>(
      ocrWordsCacheKey(payload.documentId, payload.pageIndex),
    );
    if (words === undefined) {
      this.logger.warn("OCR_PAGE_FINISHED sin ocr-words en cache; se ignora la fusión.", {
        documentId: payload.documentId,
        pageIndex: payload.pageIndex,
      });
      return;
    }

    const fusion = this.engines.pdf
      .fuseOcrPage(payload.documentId, payload.pageIndex, words)
      .then((updatedDocument) => {
        this.documents.set(payload.documentId, updatedDocument);
      })
      .catch((err: unknown) => {
        this.logger.warn("fuseOcrPage falló para una página OCR.", {
          documentId: payload.documentId,
          pageIndex: payload.pageIndex,
          reason: err instanceof Error ? err.message : String(err),
        });
      });

    const list = this.pendingFusions.get(payload.documentId) ?? [];
    list.push(fusion);
    this.pendingFusions.set(payload.documentId, list);
  }

  private handleOcrPageFailed(payload: OcrPageFailed): void {
    this.logger.warn("Página OCR falló tras reintentos; se continúa sin su texto (caso 5).", {
      documentId: payload.documentId,
      pageIndex: payload.pageIndex,
    });
  }

  private handleRegexFinished(payload: RegexFinished): void {
    // ADR-038 §1: usa la config efectiva del documento (no this.config), ya
    // que un reanalyze puede haber cambiado ner.enabled para este documento
    // sin afectar la config default de la instancia.
    if (!this.effectiveConfigFor(payload.documentId).ner.enabled) {
      // NER desactivado: la etapa de detección termina con Regex solo, no
      // habrá NER_PAGE_FINISHED que incremente el progreso granular. Se
      // emite acá directamente current = total = pageCount (spec
      // Orchestrator.md §8). Tiene que ir *antes* de finishSession: como
      // finishSession corre íntegramente síncrono hasta GROUPING_FINISHED
      // (ver nota de cabecera del archivo), para cuando esa llamada retorna
      // el stage ya pasó a Ready y este PIPELINE_PROGRESS quedaría con el
      // stage equivocado.
      const pageCount = this.documents.get(payload.documentId)?.pageCount;
      if (pageCount !== undefined) {
        this.emitProgress(payload.documentId, pageCount, pageCount);
      }
      // ADR-034 §2: el despacho síncrono del bus garantiza que todos los
      // ENTITY_FOUND de Regex ya fueron procesados por Grouping acá.
      // finishSession es re-ejecutable/idempotente (ADR-038 §2): si
      // reopenSession ya dejó nerFinished=true (reanalyze con ner off,
      // caso 19/20), esta llamada puede coincidir con el auto-finish interno
      // de GroupingEngine; ambas convergen al mismo GROUPING_FINISHED.
      void this.engines.grouping.finishSession(payload.documentId);
    }
  }

  private handleNerPageFinished(payload: NerPageFinished): void {
    // Progreso granular de detección con NER activo: total = pageCount
    // fijado en runDetectionStage; current incrementa una vez por cada
    // NER_PAGE_FINISHED (spec Orchestrator.md §8).
    this.bumpProgress(payload.documentId);
  }

  private handleGroupingFinished(payload: GroupingFinished): void {
    const state = this.state.get(payload.documentId);
    if (state === undefined) return;
    if (state.cancelRequested) {
      // ADR-038 §6, caso 22: GROUPING_FINISHED disparado por el
      // finishSession que cancelReanalyze() invoca (o un evento tardío tras
      // cancel() de un import) — el stage/PIPELINE_CANCELLED los gestiona
      // cancel()/cancelReanalyze() directamente; acá se suprime el
      // PIPELINE_READY derivado.
      return;
    }
    this.state.update(payload.documentId, { stage: PipelineStage.Ready, progress: 100 });
    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
      documentId: payload.documentId,
      groupCount: payload.groupCount,
      conflictCount: payload.conflictCount,
    });
  }

  private handlePreviewUpdated(payload: PreviewUpdated): void {
    this.blobTracker.set(
      previewBlobKey(payload.documentId, payload.pageIndex, payload.kind),
      payload.canvasBlobUrl,
    );
  }

  private handlePreviewPageFailed(_payload: PreviewPageFailed): void {
    // Placeholder en la UI (06_Pipeline.md §10); sin acción adicional del Orchestrator.
  }

  private handleRenderFailed(_payload: RenderFailedPayload): void {
    // Fatal de batch de RenderEngine (`renderPages`); este hito no despacha
    // `renderPages` desde el Orchestrator (solo `renderPage`/`rasterizePage`
    // singulares vía pool), así que esta rama es defensiva. La cadena real a
    // PIPELINE_FAILED pasa por EXPORT_FAILED (06_Pipeline.md §12/§13).
  }

  private handleExportRequested(payload: ExportRequested): void {
    // v1.2.1 (bug #6, caso 24): `.catch` terminal de última instancia — `runExport`
    // ya enruta sus fallos a `failPipeline`, pero `enqueueExport`/`runExportChain`
    // corren disparados (`void`) desde un handler de evento síncrono que no puede
    // propagar rechazos; sin este seatbelt, cualquier fallo no previsto en esa
    // cadena se vuelve un unhandled rejection silencioso.
    this.enqueueExport(payload.documentId, payload.options).catch((err: unknown) => {
      this.failPipeline(payload.documentId, err);
    });
  }

  private handleExportFinished(payload: ExportFinished): void {
    this.blobTracker.set(exportBlobKey(payload.documentId), payload.blobUrl);
    if (this.state.has(payload.documentId)) {
      this.state.update(payload.documentId, { stage: PipelineStage.Done });
    }
  }

  private handleExportFailed(payload: ExportFailed): void {
    if (!this.state.has(payload.documentId)) return;
    this.state.addError(payload.documentId, {
      stage: PipelineStage.Exporting,
      code: payload.error.code,
      message: payload.error.message,
      documentId: payload.documentId,
    });
    this.failPipeline(payload.documentId, payload.error);
  }

  private handleDocumentClosed(payload: DocumentClosed): void {
    void this.closeDocument(payload.documentId);
  }

  private handleCancelRequested(payload: CancelRequested): void {
    void this.cancel(payload.documentId, payload.jobId);
  }

  private handleWorkerJobTimeout(payload: WorkerJobTimeout): void {
    this.logger.warn("Job de worker excedió el timeout.", {
      jobId: payload.jobId,
      timeoutMs: payload.timeoutMs,
    });
  }

  private handleWorkerPoolSaturated(payload: WorkerPoolSaturated): void {
    this.logger.warn("Pool de workers saturado (backpressure).", {
      type: payload.type,
      queueLength: payload.queueLength,
    });
  }

  // ─── Helpers ───

  private poolSizeFor(key: PoolKey): number {
    switch (key) {
      case "pdf":
        return this.config.workerPool.pdfPoolSize;
      case "ocr":
        return this.config.workerPool.ocrPoolSize;
      case "ner":
        return this.config.workerPool.nerPoolSize;
      case "render":
        return this.config.workerPool.renderPoolSize;
    }
  }

  private ctxFor(signal: AbortSignal, documentId: string): EngineContext {
    return {
      bus: this.bus,
      logger: this.logger,
      cache: this.cache,
      abortSignal: signal,
      config: this.effectiveConfigFor(documentId),
    };
  }

  /** Config efectiva del documento (ADR-038 §1): la de `reanalyze`, o `this.config` si no hay override. */
  private effectiveConfigFor(documentId: string): EngineConfig {
    return this.effectiveConfigByDocument.get(documentId) ?? this.config;
  }

  private setStage(documentId: string, stage: PipelineStage): void {
    const updated = this.state.update(documentId, { stage });
    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, {
      documentId,
      stage,
      progress: updated.progress,
    });
  }

  /**
   * Emite PIPELINE_PROGRESS con el `stage` vigente del documento en el
   * momento de la emisión (payload canónico, `Contracts.md` §8:
   * `{ documentId, stage, current, total }`). No-op si el documento no
   * tiene `PipelineState` (p. ej. eventos emitidos sin un `importDocument`
   * previo, como en los tests de la matriz emisor→receptor).
   */
  private emitProgress(documentId: string, current: number, total: number): void {
    const state = this.state.get(documentId);
    if (state === undefined) return;
    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, {
      documentId,
      stage: state.stage,
      current,
      total,
    });
  }

  /**
   * Incrementa en 1 el `current` del tracker de progreso granular por
   * página del documento (OCR/NER, spec Orchestrator.md §8) y emite
   * PIPELINE_PROGRESS. `current` nunca supera `total`. No-op si no hay un
   * tracker activo para el documento (mismos casos defensivos que
   * `emitProgress`).
   */
  private bumpProgress(documentId: string): void {
    const progress = this.progressByDocument.get(documentId);
    if (progress === undefined) return;
    const current = Math.min(progress.current + 1, progress.total);
    this.progressByDocument.set(documentId, { total: progress.total, current });
    this.emitProgress(documentId, current, progress.total);
  }

  private releaseActiveDocument(documentId: string): void {
    if (this.activeDocumentId === documentId) this.activeDocumentId = undefined;
  }

  /** Idempotente: si ya está en Failed, no vuelve a emitir PIPELINE_FAILED. */
  private failPipeline(documentId: string, err: unknown): void {
    // Idempotente y defensivo: si el documento ya no existe (p. ej. una
    // carrera con closeDocument()/cancel()) o ya está Failed, no hace nada.
    if (!this.state.has(documentId)) return;
    if (this.state.get(documentId)?.stage === PipelineStage.Failed) return;

    const serialized =
      err instanceof EngineError ? err.serialize() : this.toGenericSerializedError(err);

    this.state.addError(documentId, {
      stage: this.state.get(documentId)?.stage ?? PipelineStage.Failed,
      code: serialized.code,
      message: serialized.message,
      documentId,
    });
    this.state.update(documentId, { stage: PipelineStage.Failed });
    this.releaseActiveDocument(documentId);
    this.bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, {
      documentId,
      error: serialized,
    });
  }

  private toGenericSerializedError(err: unknown): {
    readonly code: EngineErrorCode;
    readonly engineId: "core";
    readonly message: string;
    readonly retryable: boolean;
    readonly details: Readonly<Record<string, unknown>>;
  } {
    // Ya serializado (p. ej. payload.error de EXPORT_FAILED, un SerializedEngineError).
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      "message" in err &&
      "retryable" in err
    ) {
      const candidate = err as {
        readonly code: EngineErrorCode;
        readonly message: string;
        readonly retryable: boolean;
        readonly details?: Readonly<Record<string, unknown>>;
      };
      return {
        code: candidate.code,
        engineId: "core",
        message: candidate.message,
        retryable: candidate.retryable,
        details: candidate.details ?? {},
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: EngineErrorCode.INVALID_INPUT,
      engineId: "core",
      message,
      retryable: false,
      details: {},
    };
  }

  private validateImportInput(input: ImportDocumentInput): void {
    if (input == null) {
      throw new InvalidInputError("input es null o undefined.");
    }
    if (input.buffer.byteLength === 0) {
      throw new InvalidInputError("buffer vacío.", { documentId: input.documentId });
    }
    if (this.state.has(input.documentId)) {
      throw new InvalidInputError(`documentId ${input.documentId} ya existe (documento abierto).`, {
        documentId: input.documentId,
      });
    }
    if (this.activeDocumentId !== undefined && this.activeDocumentId !== input.documentId) {
      throw new InvalidInputError(
        `Ya hay un documento activo (${this.activeDocumentId}); cerralo antes de importar otro (MVP, caso 12).`,
        { documentId: input.documentId, activeDocumentId: this.activeDocumentId },
      );
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new OrchestratorDisposedError();
  }
}
