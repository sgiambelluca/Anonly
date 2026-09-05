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

import { buildPageReplacements } from "@anonly/export-engine";
import type { ExportEngineInput, RenderPageProvider } from "@anonly/export-engine";
import type { NerPageInput } from "@anonly/ner-engine";
import type { OcrPageInput } from "@anonly/ocr-engine";
import { decodePdfEngineOutput, fuseOcrPage, fuseOcrRegion } from "@anonly/pdf-engine";
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
  isEngineErrorCode,
  PipelineStage,
  type CancelRequested,
  type CoreRuntimeOptions,
  type Document,
  type DocumentClosed,
  type DocumentParsed,
  type EngineConfig,
  type EngineContext,
  type EntityGroup,
  type EntityGroupCreated,
  type EntityGroupRemoved,
  type EntityGroupUpdated,
  type ExportFailed,
  type ExportFinished,
  type ExportOptions,
  type ExportRequested,
  type GroupingFinished,
  type ICache,
  type IEventBus,
  type ILogger,
  type ManualEntityRequest,
  type NerPageFinished,
  type OcrPageFailed,
  type OcrPageFinished,
  type OcrRegion,
  type Page,
  type PageParsed,
  type PdfInvalid,
  type PdfParsePayload,
  type PdfPasswordRequired,
  type PipelineState,
  type PreviewPageFailed,
  type PreviewUpdated,
  type ReanalyzeConfigPatch,
  type RegexFinished,
  type RenderFailed as RenderFailedPayload,
  type Replacement,
  type TextMatch,
  type Unsubscribe,
  type WorkerFactory,
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
import { selectLineWords } from "./line-words.js";
import { PipelineStateStore } from "./pipeline-state.js";
import type {
  AnonymizationCoreEngines,
  ImportDocumentInput,
  IPipelineOrchestrator,
  ManualEntityResult,
} from "./types.js";
import { WorkerPoolManager, type ManagedPoolKey } from "./worker-pool.js";

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
  // ADR-081: `ner` + `ocr` en el mismo patch se rechaza. La regla 4 de
  // ADR-038 §5 prometía "la unión de las reglas anteriores" y eso nunca se
  // implementó: con ambos campos se entra SOLO por `runReanalyzeOcrFlow`,
  // que por diseño toca únicamente las páginas re-OCR. Apagar NER dejaba sus
  // ocurrencias vivas en el resto del documento; encenderlo solo lo corría
  // sobre las páginas escaneadas. Los dos fallaban en silencio, con el
  // pipeline llegando a `Ready`. La equivalencia se obtiene componiendo dos
  // llamadas —y el orden importa: al revés, el flujo de NER correría sobre
  // un texto que el OCR posterior invalida.
  if (patch.ner !== undefined && patch.ocr !== undefined) {
    throw new InvalidInputError(
      "ReanalyzeConfigPatch con 'ner' y 'ocr' a la vez no está soportado: enviá un patch por campo, OCR primero (ADR-081).",
    );
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

// ─── Mediación grupos→Render del preview (ADR-044): helper de módulo ───

/**
 * Etapas anteriores a `Ready` (Orchestrator.md §13 caso 26): el seed de
 * `GROUPING_FINISHED` cubre todas las páginas con reemplazos del snapshot
 * completo, así que los eventos `ENTITY_GROUP_*` que llegan mientras el
 * documento está en alguna de estas etapas (incluida `Idle`/sin
 * `PipelineState` todavía) solo actualizan el mapa de páginas conocidas — no
 * agendan flush.
 */
const PRE_READY_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Idle,
  PipelineStage.Importing,
  PipelineStage.Extracting,
  PipelineStage.OCRing,
  PipelineStage.Detecting,
  PipelineStage.Grouping,
]);

export interface PipelineOrchestratorOptions {
  readonly bus: IEventBus;
  readonly logger: ILogger;
  readonly cache: ICache;
  readonly config: EngineConfig;
  readonly engines: AnonymizationCoreEngines;
  /**
   * Factories de `Worker` real inyectadas por `createCore(config, runtime)`
   * (ADR-036 §2, Contracts.md §3.5). Ausente => los cuatro pools quedan
   * in-process (comportamiento del Hito 9/ADR-035, sin cambios). Los
   * factories `pdf`/`ocr`/`ner`/`render` se consumen acá mismo, en el
   * constructor, pasándolos a `WorkerPoolManager`. `workers.export` (el
   * `WorkerPool` de `size: 1` del ExportWorker, ADR-047 §2) NO pasa por
   * acá: `create-core.ts` lo construye e inyecta directo a
   * `new ExportEngine(exportPool)`, espejo de `ocrPool`/`nerPool` — el
   * Orchestrator no retiene ninguna factory de export (retirado en PR16).
   */
  readonly runtime?: CoreRuntimeOptions;
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
  // ADR-065 §8: las regiones de OCR (páginas CON texto nativo, una imagen sin
  // explicar) no viven en el modelo de datos — a diferencia de textlessPages,
  // que se recomputa en cualquier momento desde page.requiresOCR — así que se
  // pierden apenas termina la extracción si este componente no las retiene.
  // Se setean una única vez en runPipelineFrom (pdfOutput.ocrRegions) y nunca
  // se recomputan; reanalyze las lee para la unión de páginas a re-escanear
  // (§13 caso 20).
  private readonly ocrRegionsByDocument = new Map<string, ReadonlyArray<OcrRegion>>();
  private readonly renderLoadedDocuments = new Set<string>();
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
  // ADR-061 §5: literales agregados a mano por documento, durables — se
  // re-aplican tras cualquier re-detección que pueda haber descartado sus
  // ocurrencias (reapplyManualLiterals, invocado desde runReanalyzeOcrFlow).
  // Sin esto, un reanalyze de OCR borra en silencio las entidades que el
  // usuario agregó a mano sobre las páginas re-OCR-eadas (el modo de falla
  // que ADR-061 existe para cerrar). Se descarta en closeDocument/dispose,
  // mismo patrón que el resto del estado por documento.
  private readonly manualLiteralsByDocument = new Map<string, ManualEntityRequest[]>();
  // ─── Mediación grupos→Render del preview (ADR-044) ───
  // Por documento: groupId → páginas conocidas (members actuales de la última
  // vez que se vio el grupo). Necesario para ENTITY_GROUP_REMOVED (el payload
  // solo trae groupId) y para detectar páginas que un grupo abandonó por
  // merge/split/dropOccurrences. Se limpia en DOCUMENT_CLOSED.
  private readonly groupPagesByDocument = new Map<string, Map<string, Set<number>>>();
  // Páginas marcadas sucias por documento, pendientes del flush coalescido
  // por microtask (§13 caso 27). Vacío durante las etapas pre-Ready: el seed
  // de GROUPING_FINISHED las cubre sin necesitar el flush incremental.
  private readonly dirtyPagesByDocument = new Map<string, Set<number>>();
  // Evita agendar más de un flush por documento por ráfaga de eventos.
  private readonly flushScheduledDocuments = new Set<string>();
  // Controlador por documento del seed/flush del preview mediado (ADR-052
  // §3, v1.5.4): inmune a la cancelación del documento (abortRegistry) pero
  // NO a su baja — closeDocument/dispose lo abortan y lo limpian de acá,
  // cancelReanalyze NO lo toca (ver mediatedPreviewCtx).
  private readonly mediatedPreviewControllers = new Map<string, AbortController>();
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

    const poolWorkerFactories: Partial<Readonly<Record<ManagedPoolKey, WorkerFactory>>> = {
      ...(options.runtime?.workers?.pdf !== undefined ? { pdf: options.runtime.workers.pdf } : {}),
      ...(options.runtime?.workers?.ocr !== undefined ? { ocr: options.runtime.workers.ocr } : {}),
      ...(options.runtime?.workers?.ner !== undefined ? { ner: options.runtime.workers.ner } : {}),
      ...(options.runtime?.workers?.render !== undefined
        ? { render: options.runtime.workers.render }
        : {}),
    };

    this.pools = new WorkerPoolManager({
      bus: this.bus,
      logger: this.logger,
      getPoolSize: (key) => this.poolSizeFor(key),
      getMaxQueue: (key) => this.config.workerPool.maxQueuePerPool[key],
      getMaxRetries: (jobType) => this.config.workerPool.maxRetries[jobType],
      baseRetryDelayMs: this.config.workerPool.baseRetryDelayMs,
      maxRetryDelayMs: this.config.workerPool.maxRetryDelayMs,
      idleDisposeMs: this.config.workerPool.idleDisposeMs,
      workerFactories: poolWorkerFactories,
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
    // ADR-050 §4: reescribe `retainedInputs` con el input que incluye el
    // password — `ensureRenderDocumentLoaded` lee este mismo mapa más
    // adelante en el pipeline y sin esto el documento protegido se abría en
    // PdfEngine pero no en Render (`RenderFailedError("No password given")`).
    this.retainedInputs.set(documentId, retryInput);

    this.setStage(documentId, PipelineStage.Extracting);
    await this.runPipelineFrom(documentId, retryInput, ctx);
  }

  async reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void> {
    this.assertNotDisposed();

    const state = this.state.get(documentId);
    if (
      state === undefined ||
      !(
        state.stage === PipelineStage.Ready ||
        state.stage === PipelineStage.Done ||
        state.stage === PipelineStage.Failed
      )
    ) {
      // Caso 21: precondición de stage (ADR-040: Done es el equivalente
      // operativo de Ready, "Ready con un export ya completado" — habilita
      // SettingsDialog post-export). También hace que un segundo
      // reanalyze/importDocument concurrente sobre el mismo documento se
      // autorrechace (el stage ya no es Ready/Done/Failed mientras uno corre).
      throw new InvalidInputError(
        `reanalyze requiere stage Ready, Done o Failed para ${documentId} (actual: ${state?.stage ?? "inexistente"}).`,
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

  /**
   * ADR-061 §6: agrega a mano una entidad que el detector no encontró.
   * `reopenSession` -> `regex.findLiteral` (emite `ENTITY_FOUND` con
   * `source: Manual`, camino de siempre) -> `finishSession` (ADR-028,
   * renumeración canónica). El dedup por identidad de ADR-038 §3 es lo que
   * hace segura la repetición — no hay nada que escribir acá para eso.
   * Precondición de stage idéntica a la de `getState`/`reanalyze` en su
   * forma (documento inexistente o stage fuera del conjunto permitido ->
   * `InvalidInputError`), pero el conjunto es `{Ready, Failed}` — literal de
   * `Contracts.md` §3.5, más angosto que el `{Ready, Done, Failed}` de
   * `reanalyze` (ADR-040 no amendó esta precondición). Mismo motivo que ahí:
   * esto además autorrechaza una segunda llamada concurrente (a
   * `addManualEntity` o a `reanalyze`) sobre el mismo documento, porque el
   * `setStage(Grouping)` de abajo saca el stage de `Ready` mientras esta
   * corre — transitorio, como el de `runReanalyzeNerOffFlow` (caso 19).
   */
  async addManualEntity(
    documentId: string,
    request: ManualEntityRequest,
  ): Promise<ManualEntityResult> {
    this.assertNotDisposed();

    const state = this.state.get(documentId);
    if (
      state === undefined ||
      !(state.stage === PipelineStage.Ready || state.stage === PipelineStage.Failed)
    ) {
      throw new InvalidInputError(
        `addManualEntity requiere stage Ready o Failed para ${documentId} (actual: ${state?.stage ?? "inexistente"}).`,
        { documentId, stage: state?.stage },
      );
    }

    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible para addManualEntity.`, {
        documentId,
      });
    }

    // Retenido ANTES de buscar: la durabilidad (ADR-061 §5) no depende de
    // que la búsqueda encuentre algo hoy — un reanalyze posterior puede
    // hacer aparecer el valor en una página recién re-OCR-eada.
    const literals = this.manualLiteralsByDocument.get(documentId) ?? [];
    literals.push(request);
    this.manualLiteralsByDocument.set(documentId, literals);

    const controller = this.abortRegistry.get(documentId) ?? this.abortRegistry.create(documentId);
    const ctx = this.ctxFor(controller.signal, documentId);

    this.setStage(documentId, PipelineStage.Grouping);
    this.engines.grouping.reopenSession(documentId, { expectRegex: false, expectNer: false });
    // occurrenceCount es el de findLiteral tal cual -- apariciones ANTES del
    // dedup de Grouping (ADR-061 §6 errata, punto 3). No se recalcula contra
    // el árbol de grupos: un valor ya cubierto que se fusiona entero sigue
    // devolviendo N > 0, nunca "grupos nuevos".
    const result = await this.engines.regex.findLiteral(
      { document, value: request.value, entityType: request.entityType },
      ctx,
    );
    await this.engines.grouping.finishSession(documentId);
    return { occurrenceCount: result.occurrenceCount };
  }

  /**
   * ADR-061 §8 (errata): misma búsqueda literal de `addManualEntity`, salida
   * de solo lectura sobre `regex.searchText` (sincrónico). No pasa por
   * `reopenSession`/`finishSession` ni emite nada: buscar no es agregar.
   */
  findText(documentId: string, query: string): ReadonlyArray<TextMatch> {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible para findText.`, {
        documentId,
      });
    }
    return this.engines.regex.searchText({ document, query });
  }

  /**
   * ADR-061 §4: por página y a demanda — no vuelca el `Document` entero al
   * store del cliente (Contexto §4 del ADR: hoy el cliente no tiene ni
   * palabras ni dimensiones reales de página).
   */
  getPageWords(documentId: string, pageIndex: number): ReadonlyArray<Word> {
    return this.getPageOrThrow(documentId, pageIndex).words;
  }

  getPageSize(
    documentId: string,
    pageIndex: number,
  ): { readonly width: number; readonly height: number } {
    const page = this.getPageOrThrow(documentId, pageIndex);
    return { width: page.width, height: page.height };
  }

  private getPageOrThrow(documentId: string, pageIndex: number): Page {
    const document = this.documents.get(documentId);
    if (document === undefined) {
      throw new InvalidInputError(`Documento ${documentId} no disponible.`, { documentId });
    }
    const page = document.pages[pageIndex];
    if (page === undefined) {
      throw new InvalidInputError(`Página ${pageIndex} fuera de rango para ${documentId}.`, {
        documentId,
        pageIndex,
      });
    }
    return page;
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

    // ADR-046 §7: el Orchestrator deja de envolver `processPages` en
    // `pools.getPool("ner").dispatch({run})` — invoca el método del motor
    // directo; es el propio `NerEngine` quien despacha internamente, por
    // batch, contra su `NerPool` (inyectada por el façade en
    // `create-core.ts`), mismo criterio que ADR-043/ADR-045 aplicaron a
    // render/OCR.
    await this.engines.ner.processPages(nerInputs, ctx);
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

  /**
   * Caso 20 (+ combinado): `ocr.languages` sobre la **unión** de páginas
   * `requiresOCR` y regiones retenidas (ADR-065 §8). Una página con región
   * tiene `requiresOCR === false`, así que quedaría afuera del filtro por
   * `requiresOCR` solo — y si el OCR del documento fue **solo** por región,
   * la guarda de salida temprana volvería el `reanalyze` entero un no-op
   * silencioso (el test que fija la regresión más peligrosa del ADR).
   */
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

    const requiresOcrPages = document.pages
      .filter((page) => page.requiresOCR)
      .map((page) => page.index);
    const retainedRegions = this.ocrRegionsByDocument.get(documentId) ?? [];
    // ADR-065 §4: los dos conjuntos son disjuntos por contrato — la unión
    // los combina sin necesidad de dedupe.
    const affectedPages = new Set<number>([
      ...requiresOcrPages,
      ...retainedRegions.map((region) => region.pageIndex),
    ]);

    if (affectedPages.size === 0) {
      // Sin páginas OCR ni regiones: los idiomas de OCR no afectan texto
      // nativo, nada que re-detectar (la config efectiva ya quedó
      // actualizada arriba).
      return;
    }

    this.setStage(documentId, PipelineStage.OCRing);
    this.engines.grouping.reopenSession(documentId, {
      expectRegex: true,
      expectNer: effectiveConfig.ner.enabled,
    });
    // ADR-065 §8: sobre una página con región esto también descarta las
    // ocurrencias de su texto nativo — correcto, porque Regex re-corre sobre
    // el documento completo y NER sobre las páginas re-OCR, así que se
    // vuelven a detectar (visible: una edición manual sobre esa página se
    // pierde igual que en cualquier página re-OCR-eada).
    this.engines.grouping.dropOccurrences(documentId, {
      pageIndices: [...affectedPages].sort((a, b) => a - b),
    });

    await this.runOcrStage(documentId, requiresOcrPages, retainedRegions, ctx);

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

    if (!effectiveConfig.ner.enabled) {
      // handleRegexFinished ya invocó finishSession (ner off) de forma
      // síncrona dentro del await de arriba (nota de sincronía de cabecera):
      // la sesión ya volvió a cerrarse acá. ADR-061 §5: reabrir para
      // re-aplicar los literales manuales retenidos sobre las páginas que
      // `dropOccurrences` acaba de descartar — sin esto el dato agregado a
      // mano desaparece del árbol en silencio.
      await this.reapplyManualLiterals(documentId, ctx);
      return;
    }

    const nerInputs: NerPageInput[] = updatedDocument.pages
      .filter((page) => affectedPages.has(page.index))
      .map((page) => ({ documentId, pageIndex: page.index, text: page.text, words: page.words }));

    this.progressByDocument.set(documentId, { total: nerInputs.length, current: 0 });

    // ADR-046 §7 (mismo tratamiento que el call site de
    // `runReanalyzeNerOnFlow`, aplicado acá por consistencia: el motor ya no
    // acepta ser envuelto en un `pool.dispatch` externo sin duplicar su
    // propio retry interno — problema 2 del Contexto de ADR-046).
    await this.engines.ner.processPages(nerInputs, ctx);
    // Auto-finish vía GroupingEngine (regex + ner, ambos *_FINISHED) ya
    // cerró la sesión para cuando este await resuelve (misma nota de
    // sincronía). ADR-061 §5: mismo motivo que la rama de arriba.
    await this.reapplyManualLiterals(documentId, ctx);
  }

  /**
   * ADR-061 §5: re-aplica los literales manuales retenidos del documento.
   * Único punto de enganche real: `runReanalyzeOcrFlow` es el único flujo de
   * `reanalyze` cuyo `dropOccurrences` filtra por `pageIndices` (borra
   * ocurrencias de CUALQUIER `source`, incluida `Manual`) — el de
   * `runReanalyzeNerOffFlow` filtra por `source: DetectionSource.NER` y
   * nunca puede tocar una ocurrencia manual (`matchesDropFilter`,
   * `grouping-engine`), así que no necesita este re-enganche.
   *
   * Corre DESPUÉS de que la sesión ya volvió a cerrarse por la propia
   * cascada de re-detección (Regex/NER auto-finalizan la sesión de Grouping,
   * nota de sincronía de cabecera): reabre de nuevo, re-busca cada literal
   * retenido sobre el `Document` ya actualizado por el re-OCR/re-fusión, y
   * vuelve a cerrar. El dedup por identidad de ADR-038 §3 descarta en
   * silencio los literales que ya sobrevivieron en páginas no afectadas —
   * re-buscar sobre el documento completo (no solo las páginas afectadas) es
   * inocuo, mismo razonamiento que ya vale para la re-pasada de Regex de
   * arriba. No-op si no hay literales retenidos (evita un ciclo
   * reopen/finish vacío) o si el documento ya no está disponible.
   */
  private async reapplyManualLiterals(documentId: string, ctx: EngineContext): Promise<void> {
    const literals = this.manualLiteralsByDocument.get(documentId);
    if (literals === undefined || literals.length === 0) return;

    const document = this.documents.get(documentId);
    if (document === undefined) return;

    this.engines.grouping.reopenSession(documentId, { expectRegex: false, expectNer: false });
    for (const literal of literals) {
      await this.engines.regex.findLiteral(
        { document, value: literal.value, entityType: literal.entityType },
        ctx,
      );
    }
    await this.engines.grouping.finishSession(documentId);
  }

  async closeDocument(documentId: string): Promise<void> {
    // Idempotente: closeDocument() se auto-dispara de nuevo vía la suscripción
    // a DOCUMENT_CLOSED que él mismo emite al final (para que Grouping, que
    // limpia su sesión por suscripción propia, también reciba el evento).
    if (!this.state.has(documentId) && !this.documents.has(documentId)) return;

    this.abortRegistry.abort(documentId);
    this.abortRegistry.release(documentId);
    // ADR-041 §2: PdfEngine ya no retiene documentos (sin Map interno); no
    // hay liberación por documento que invocarle (releaseDocument eliminado).
    await this.engines.render.unloadDocument(documentId);

    this.renderLoadedDocuments.delete(documentId);
    this.documents.delete(documentId);
    this.retainedInputs.delete(documentId);
    // ADR-065 §8: las regiones retenidas se descartan junto al resto del
    // estado por documento — no viven en el modelo de datos, así que no hay
    // otra copia de la que recuperarlas.
    this.ocrRegionsByDocument.delete(documentId);
    this.exportQueues.delete(documentId);
    this.exportInProgress.delete(documentId);
    this.progressByDocument.delete(documentId);
    this.effectiveConfigByDocument.delete(documentId);
    this.reanalyzeInFlight.delete(documentId);
    // ADR-061 §5: mismo patrón que el resto del estado por documento.
    this.manualLiteralsByDocument.delete(documentId);
    this.groupPagesByDocument.delete(documentId);
    this.dirtyPagesByDocument.delete(documentId);
    this.flushScheduledDocuments.delete(documentId);
    // ADR-052 §3: la baja del documento aborta el controlador del preview
    // mediado (cancelReanalyze deliberadamente NO llega a esta línea — solo
    // closeDocument/dispose bajan el documento).
    this.mediatedPreviewControllers.get(documentId)?.abort();
    this.mediatedPreviewControllers.delete(documentId);
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
    this.ocrRegionsByDocument.clear();
    this.renderLoadedDocuments.clear();
    this.exportQueues.clear();
    this.exportInProgress.clear();
    this.progressByDocument.clear();
    this.effectiveConfigByDocument.clear();
    this.reanalyzeInFlight.clear();
    this.manualLiteralsByDocument.clear();
    this.groupPagesByDocument.clear();
    this.dirtyPagesByDocument.clear();
    this.flushScheduledDocuments.clear();
    // ADR-052 §3: dispose() global es una baja para todo documento con un
    // controlador de preview mediado todavía vivo.
    for (const controller of this.mediatedPreviewControllers.values()) controller.abort();
    this.mediatedPreviewControllers.clear();

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
      // v1.2.1 (bug #6, Orchestrator.md nota de cabecera / §12 / caso 23): el
      // motor puede dejar detached el buffer que recibe (pdfjs-dist lo
      // transfiere a su worker interno) — se entrega siempre una copia, el
      // buffer retenido en `retainedInputs` nunca sale del Orchestrator.
      // El mismo objeto sirve como `PdfEngineInput` (fallback in-process,
      // `run`) y como `PdfParsePayload` (ADR-036 §2/§3, `03_Data_Model.md`
      // §18): con `workerFactory` real para "pdf", `payload` dispara el
      // despacho remoto de `WorkerPool.dispatchRemote` (PR11, ya genérico);
      // sin ella, `executeJob` sigue invocando `run()` in-process (sin cambios).
      const pdfParsePayload: PdfParsePayload = {
        documentId,
        buffer: input.buffer.slice(0),
        ...(input.password !== undefined ? { password: input.password } : {}),
      };

      // Frontera de transporte (ADR-042): WorkerOutbound.COMPLETED.result es
      // `unknown` a nivel de transporte (mismo criterio que RUN.payload/
      // INIT.config, ADR-019) y WorkerPool.dispatchRemote lo afina
      // genéricamente a `TResult` (transporte, ya genérico desde PR11, no se
      // toca acá — ADR-055 §8: el transporte no conoce el contrato del payload
      // de cada motor).
      //
      // El `<unknown>` de abajo es deliberado (ADR-055 §10). Acá había un
      // `<PdfEngineOutput>` explícito: una afirmación que el compilador NO
      // puede verificar, porque del otro lado de `run()` puede haber cruzado
      // un `postMessage` real. Era el último `dispatch<T>` con tipo concreto
      // que quedaba en producción. Con `unknown`, el compilador obliga a pasar
      // por `decodePdfEngineOutput` antes de tocar el resultado.
      //
      // El decoder lo exporta `pdf-engine`, no vive acá: es el motor el que
      // conoce el contrato de su propio worker (ADR-055 §8). Que el consumidor
      // esté en el façade es la particularidad de PDF —único motor sin puerto
      // interno, porque su entry-point corre el motor real completo (ADR-036
      // §3) en vez de un kernel— y por eso este call site es el que angosta,
      // en lugar de un `PdfJobPool` que no existe. Misma forma que
      // `fuseOcrPage` (ADR-041): función pura del motor, ejecutada host-side
      // por el façade, que como façade sí puede importar de un motor (P-1).
      //
      // Sin `isRetryable` propio (ADR-049 §4/§5): el predicado por defecto del
      // pool (`err instanceof EngineError && err.retryable`) ya decide bien,
      // incluso con el error deserializado tras cruzar un Worker real, porque
      // `PdfPasswordRequiredError.retryable === false` (pdf-engine, PR 17.1)
      // y el flag sí sobrevive al boundary (`Contracts.md` §4).
      pdfOutput = decodePdfEngineOutput(
        await this.pools.getPool("pdf").dispatch<unknown>({
          run: () => this.engines.pdf.process(pdfParsePayload, ctx),
          signal: ctx.abortSignal,
          priority: 100,
          payload: pdfParsePayload,
        }),
      );
    } catch (err: unknown) {
      this.handleExtractionFailure(documentId, err);
      return;
    }

    this.documents.set(documentId, pdfOutput.document);
    // ADR-065 §8: retenido por documento — ver el mapa arriba.
    this.ocrRegionsByDocument.set(documentId, pdfOutput.ocrRegions);

    // ADR-065 §4/§13 caso 1: los dos conjuntos son disjuntos por contrato,
    // así que la etapa OCR corre si CUALQUIERA de los dos tiene contenido —
    // un documento con texto nativo en todas las páginas pero una imagen sin
    // explicar (ocrRegions no vacío, textlessPages vacío) ya no salta la
    // etapa, que es exactamente el documento que motivó el ADR.
    if (pdfOutput.textlessPages.length > 0 || pdfOutput.ocrRegions.length > 0) {
      this.setStage(documentId, PipelineStage.OCRing);
      try {
        await this.runOcrStage(documentId, pdfOutput.textlessPages, pdfOutput.ocrRegions, ctx);
      } catch (err: unknown) {
        if (this.handleCancellationIfAny(documentId, err)) return;
        this.failPipeline(documentId, err);
        return;
      }
    } else {
      // v1.4.1 (caso 25, nota de cabecera del spec — visor en blanco para
      // documentos con texto nativo): sin páginas OCR, el documento igual se
      // carga en Render acá, simétrico a la rama de arriba, ANTES de
      // Detecting (y por lo tanto antes de la cascada síncrona
      // GROUPING_FINISHED -> handleGroupingFinished -> PIPELINE_READY — ver
      // la nota de sincronía de cabecera del archivo: el fix no puede vivir
      // dentro de handleGroupingFinished). Sin esto, el primer
      // RENDER_REQUESTED que la UI emite en cuanto observa Ready (mucho antes
      // de cualquier export) se descartaba en silencio por "documento no
      // cargado" (Render_Engine.md §8), dejando el preview en blanco.
      try {
        await this.ensureRenderDocumentLoaded(documentId);
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

  /**
   * Carga el documento en `RenderEngine` si todavía no lo está — invariante
   * de `Orchestrator.md` §2: `loadDocument` se invoca **una sola vez por
   * documento**, en la etapa 2 si hay páginas OCR (`runOcrStage`), si no
   * antes de `Detecting` (v1.4.1, caso 25, rama `else` de `runPipelineFrom`)
   * o, en su defecto (documento ya en Ready), antes del primer export
   * (`runExport`). Entrega siempre una copia (`slice(0)`) del buffer
   * retenido — nunca el original (v1.2.1, caso 23) — y es idempotente vía
   * `renderLoadedDocuments` (no vuelve a invocar `loadDocument` si ya corrió
   * para este `documentId`, sin importar desde cuál de los tres call sites).
   */
  private async ensureRenderDocumentLoaded(documentId: string): Promise<void> {
    if (this.renderLoadedDocuments.has(documentId)) return;
    const retained = this.retainedInputs.get(documentId);
    if (retained === undefined) {
      throw new InvalidInputError(`No hay buffer retenido para cargar Render (${documentId}).`, {
        documentId,
      });
    }
    // ADR-050 §4: propaga el password retenido (si lo hay) como tercer
    // argumento — sin esto `RenderEngine.loadDocument` recibe los bytes
    // todavía encriptados de un PDF protegido y falla con
    // `RenderFailedError("No password given")`.
    await this.engines.render.loadDocument(documentId, retained.buffer.slice(0), retained.password);
    this.renderLoadedDocuments.add(documentId);
  }

  private handleExtractionFailure(documentId: string, err: unknown): void {
    // Discriminación por `code`, no por `instanceof PdfPasswordRequiredError`
    // (ADR-049 §5): con transporte real de workers el error llega
    // deserializado (`DeserializedEngineError`) y la subclase concreta no
    // sobrevive al boundary — el `instanceof` daba `false` y este caso caía
    // a `failPipeline` (bug del Escenario 3 E2E).
    if (isEngineErrorCode(err, EngineErrorCode.PDF_PASSWORD_REQUIRED)) {
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
    ocrRegions: ReadonlyArray<OcrRegion>,
    ctx: EngineContext,
  ): Promise<void> {
    // Progreso granular OCR (spec Orchestrator.md §8, ADR-065 §2): total fijo
    // para toda la etapa (textlessPages.length + ocrRegions.length, ambos
    // conjuntos disjuntos); current arranca en 0 y lo incrementa
    // handleOcrPageFinished por cada OCR_PAGE_FINISHED, sea de página entera
    // o de región.
    this.progressByDocument.set(documentId, {
      total: textlessPages.length + ocrRegions.length,
      current: 0,
    });

    // ADR-034 §1: adelanta loadDocument a la etapa 2 (bytes retenidos de la
    // 0). v1.2.1 (bug #6, caso 23): copia — el buffer retenido nunca sale del
    // Orchestrator (garantizado por ensureRenderDocumentLoaded).
    await this.ensureRenderDocumentLoaded(documentId);

    const scale = ctx.config.ocr.dpi / 72;
    const ocrInputs: OcrPageInput[] = [];

    // ADR-043 §2: el Orchestrator deja de envolver `rasterizePage` en
    // `pool.dispatch({run})` — invoca el método del motor directo; es el
    // propio `RenderEngine` quien despacha internamente contra su
    // `RenderPool` (inyectada por el façade en `create-core.ts`). La
    // limitación de tasa por `waitForCapacity()` que existía acá desaparece
    // junto con la referencia directa al pool: el límite de concurrencia real
    // (`renderPoolSize`) lo sigue aplicando la propia pool del motor.
    for (const pageIndex of textlessPages) {
      if (ctx.abortSignal.aborted) throw new CancelledError(documentId);
      const imageData = await this.engines.render.rasterizePage(documentId, pageIndex, scale, ctx);
      ocrInputs.push({
        documentId,
        pageIndex,
        imageData,
        dpi: ctx.config.ocr.dpi,
        languages: ctx.config.ocr.languages,
      });
    }

    // ADR-065 §3/§5: se OCR-ea la región, no la página — `rasterizePage`
    // recibe `region.bbox` y devuelve solo el recorte (en puntos de página,
    // el motor la multiplica por `scale` internamente). El `OcrPageInput` es
    // el de siempre: el OCR Engine no sabe ni necesita saber que su
    // `imageData` es un recorte en vez de una página completa.
    for (const region of ocrRegions) {
      if (ctx.abortSignal.aborted) throw new CancelledError(documentId);
      const imageData = await this.engines.render.rasterizePage(
        documentId,
        region.pageIndex,
        scale,
        ctx,
        region.bbox,
      );
      ocrInputs.push({
        documentId,
        pageIndex: region.pageIndex,
        imageData,
        dpi: ctx.config.ocr.dpi,
        languages: ctx.config.ocr.languages,
      });
    }

    // ADR-045 §2: el Orchestrator deja de envolver `processPages` en
    // `pool.dispatch({run})` — invoca el método del motor directo; es el
    // propio `OcrEngine` quien despacha internamente, por página, contra su
    // `OcrPool` (inyectada por el façade en `create-core.ts`), mismo criterio
    // que ADR-043 aplicó a `rasterizePage`/`renderPage`. El límite de
    // concurrencia real (`ocrPoolSize`) lo sigue aplicando la propia pool del
    // motor.
    await this.engines.ocr.processPages(ocrInputs, ctx);

    // ADR-041 §3: la fusión (ADR-014) la dispara `handleOcrPageFinished` de
    // forma síncrona por cada `OCR_PAGE_FINISHED` (IEventBus.emit despacha en
    // línea, 04_Event_System.md §13): para cuando el `await` de arriba
    // resuelve, todas las fusiones de este batch ya corrieron y persistieron
    // en `this.documents`. Ya no hace falta esperar promesas de fusión
    // pendientes (waitForPendingFusions se eliminó junto con el bookkeeping
    // asíncrono que ya no existe).
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

    // ADR-046 §7: el Orchestrator deja de envolver `processPages` en
    // `pools.getPool("ner").dispatch({run})` — invoca el método del motor
    // directo; es el propio `NerEngine` quien despacha internamente, por
    // batch, contra su `NerPool` (inyectada por el façade en
    // `create-core.ts`), mismo criterio que ADR-045 aplicó a `processPages`
    // de OCR.
    await this.engines.ner.processPages(nerInputs, ctx);
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
    // `ensureRenderDocumentLoaded`) vive dentro del try/catch → `failPipeline`.
    // El guard de buffer retenido ausente pasa de warn+return silencioso a
    // lanzar InvalidInputError — antes el `EXPORT_REQUESTED` no atendido
    // dejaba el pipeline congelado en `Ready` sin ningún evento; ahora
    // siempre resuelve en `EXPORT_FAILED`/`PIPELINE_FAILED` visible en la UI.
    // Desde v1.4.1 (caso 25) `ensureRenderDocumentLoaded` es normalmente un
    // no-op acá (el documento ya se cargó antes de Ready); se mantiene por
    // los casos en que no fue así (p. ej. si el load de import falló y el
    // documento sigue presente, o flujos que lleguen a export sin haber
    // pasado por `runPipelineFrom`/`runOcrStage`).
    try {
      await this.ensureRenderDocumentLoaded(documentId);

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
      // ADR-043 §2: el Orchestrator deja de envolver `renderPage` en
      // `pool.dispatch({run})` — invoca el método del motor directo;
      // `RenderEngine` despacha internamente contra su propia `RenderPool`
      // con prioridad 1000 para `mode: "full"` (05_Worker_Architecture.md
      // §6.2, ver `render.engine.ts#renderPageInternal`).
      renderFull: async (pageIndex, replacements, abortSignal) => {
        const pageCtx: EngineContext = { ...ctx, abortSignal };
        // ADR-058 §5 / Orchestrator.md v1.7.1 ítem 22b: mismo cálculo que
        // `renderMediatedPreview` (misma función pura, mismo criterio), pero
        // repetido acá en vez de compartido — `RenderPageProvider` no gana un
        // método nuevo para esto (`Export_Engine.md` §6 queda literal: Export
        // no tiene por qué conocer `lineWords`, es un derivado host-side del
        // `Document` retenido) y todo lo necesario ya está en este scope
        // (`documentId` del closure, `pageIndex`/`replacements` propios). Es
        // el punto que hace que el repintado de línea exista también en el
        // PDF exportado, no solo en el preview.
        const pageWords = this.documents.get(documentId)?.pages[pageIndex]?.words ?? [];
        const lineWords = selectLineWords(pageWords, replacements);
        const renderInput: RenderPageInput = {
          documentId,
          pageIndex,
          kind: "anonymized",
          mode: "full",
          replacements,
          imageFormat: options.imageFormat,
          ...(lineWords !== undefined ? { lineWords } : {}),
        };
        const output = await this.engines.render.renderPage(renderInput, pageCtx);
        if (output.encoded === undefined) {
          // No debería pasar: renderPage siempre produce `encoded` en mode "full" (ADR-034 §3).
          throw new RenderFailedError(documentId, "renderPage en mode 'full' no produjo encoded.");
        }
        return output.encoded;
      },
      // ADR-059 §5: mediación de la leyenda -- Export no puede importar
      // render-engine (P-1), así que este componente (que ya importa ambos)
      // delega a RenderEngine.renderLegendPage. Dimensiones: el spec no fija
      // un tamaño de página propio para la leyenda (no es una página del
      // documento) -- se usa document.pages[0] como default razonable, el
      // mismo criterio que export.engine.ts usa del otro lado del puerto para
      // armar legendPageWidthPt/legendPageHeightPt de ExportSavePayload.
      renderLegend: async (rows, abortSignal) => {
        const legendCtx: EngineContext = { ...ctx, abortSignal };
        const firstPage = this.documents.get(documentId)?.pages[0];
        if (firstPage === undefined) {
          // No debería pasar: export.engine.ts ya valida document.pages[0]
          // antes de invocar renderLegend (Export_Engine.md §15 ítem 26).
          throw new InvalidInputError(
            `document.pages[0] no disponible para renderLegend (documentId=${documentId}).`,
            { documentId },
          );
        }
        return this.engines.render.renderLegendPage(
          rows,
          firstPage.width,
          firstPage.height,
          legendCtx,
        );
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
      // ADR-044: mediación grupos→Render del preview.
      this.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, (p) =>
        this.handleEntityGroupCreated(p),
      ),
      this.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, (p) =>
        this.handleEntityGroupUpdated(p),
      ),
      this.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, (p) =>
        this.handleEntityGroupRemoved(p),
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

    const document = this.documents.get(payload.documentId);
    if (document === undefined) {
      this.logger.warn("OCR_PAGE_FINISHED para un documento no disponible; se ignora la fusión.", {
        documentId: payload.documentId,
        pageIndex: payload.pageIndex,
      });
      return;
    }

    // ADR-041 §3: fuseOcrPage/fuseOcrRegion son funciones puras y síncronas,
    // host-side — leen (this.documents), fusionan e inmediatamente guardan la
    // copia canónica, todo dentro del mismo turno de evento (IEventBus.emit
    // es síncrono en línea, 04_Event_System.md §13). Elimina de raíz la
    // carrera lost-update entre dos OCR_PAGE_FINISHED cercanos que existía
    // cuando la fusión cruzaba el worker de forma asíncrona.
    //
    // ADR-065 §2/§8: los dos conjuntos (textlessPages/ocrRegions) son
    // disjuntos por contrato de PdfEngineOutput, así que esta página entró
    // por exactamente uno de los dos caminos — se decide cuál fusión
    // corresponde buscando el pageIndex en las regiones retenidas de este
    // documento. El Orchestrator no compensa un PdfEngineOutput que violara
    // la invariante (Orchestrator.md §13 caso 29): si un bug de pdf-engine
    // solapara los conjuntos, la fusión equivocada falla ruidosamente por los
    // guards espejo de fuseOcrPage/fuseOcrRegion (ADR-020 §6/ADR-065 §6).
    const region = this.ocrRegionsByDocument
      .get(payload.documentId)
      ?.find((candidate) => candidate.pageIndex === payload.pageIndex);

    try {
      const updatedDocument =
        region !== undefined
          ? fuseOcrRegion(document, payload.pageIndex, region.bbox, words)
          : fuseOcrPage(document, payload.pageIndex, words);
      this.documents.set(payload.documentId, updatedDocument);
    } catch (err: unknown) {
      this.logger.warn("fuseOcrPage/fuseOcrRegion falló para una página OCR.", {
        documentId: payload.documentId,
        pageIndex: payload.pageIndex,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleOcrPageFailed(payload: OcrPageFailed): void {
    // Caso 5 / ADR-065 §9: sin OCR_PAGE_FINISHED no hay fusión — ni
    // fuseOcrPage ni fuseOcrRegion corren, así que el Document retenido
    // queda exactamente como salió de pdf-engine. Para una página textless
    // eso es requiresOCR=true/ocrCompleted=false (semántica de siempre). Para
    // una región, la página YA tenía requiresOCR===false y su texto nativo
    // intacto desde la extracción — un fallo de región no lo toca: solo se
    // pierde el contenido de esa región, con ocrCompleted que nunca pasó a
    // true. No hace falta lógica adicional acá; el comentario documenta por
    // qué no la hay.
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

    // ADR-044 §3, caso 26: el seed del preview anonimizado corre siempre acá,
    // incluida la vía suprimida por cancelación de reanalyze (ver el early
    // return de abajo) — ADR-038 §6.
    this.seedAnonymizedPreview(payload.documentId);

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

  // ─── Mediación grupos→Render del preview (ADR-044) ───

  private handleEntityGroupCreated(payload: EntityGroupCreated): void {
    this.trackGroupPagesAndMarkDirty(payload.documentId, payload.group);
  }

  private handleEntityGroupUpdated(payload: EntityGroupUpdated): void {
    this.trackGroupPagesAndMarkDirty(payload.documentId, payload.group);
  }

  private handleEntityGroupRemoved(payload: EntityGroupRemoved): void {
    // El payload no trae `members` (Contracts.md §8): las páginas afectadas
    // son las previamente conocidas del mapa retenido (§13 caso 27).
    const groupMap = this.groupPagesByDocument.get(payload.documentId);
    const knownPages = groupMap?.get(payload.groupId);
    groupMap?.delete(payload.groupId);
    if (knownPages !== undefined) this.markPagesDirty(payload.documentId, knownPages);
  }

  private trackGroupPagesAndMarkDirty(documentId: string, group: EntityGroup): void {
    const groupMap = this.groupPagesByDocument.get(documentId) ?? new Map<string, Set<number>>();
    this.groupPagesByDocument.set(documentId, groupMap);
    const previousPages = groupMap.get(group.id) ?? new Set<number>();
    const currentPages = new Set<number>(group.members.map((member) => member.pageIndex));
    groupMap.set(group.id, currentPages);
    // Páginas afectadas = actuales ∪ previamente conocidas (detecta páginas
    // que el grupo abandonó por merge/split/dropOccurrences, §Decisión 3).
    const affectedPages = new Set<number>([...previousPages, ...currentPages]);
    this.markPagesDirty(documentId, affectedPages);
  }

  /**
   * Marca páginas sucias para el flush del preview mediado (§Decisión 3). En
   * las etapas pre-Ready (caso 26) es un no-op deliberado: el seed de
   * GROUPING_FINISHED va a recomputar TODAS las páginas desde el snapshot
   * completo, así que acumular acá sería redundante (y el flush nunca
   * correría de todos modos, sin necesidad de guardarlas para más tarde).
   */
  private markPagesDirty(documentId: string, pages: ReadonlySet<number>): void {
    if (pages.size === 0 || this.isPreReadyStage(documentId)) return;
    const dirty = this.dirtyPagesByDocument.get(documentId) ?? new Set<number>();
    for (const pageIndex of pages) dirty.add(pageIndex);
    this.dirtyPagesByDocument.set(documentId, dirty);
    this.scheduleFlush(documentId);
  }

  private isPreReadyStage(documentId: string): boolean {
    const stage = this.state.get(documentId)?.stage;
    return stage === undefined || PRE_READY_STAGES.has(stage);
  }

  /** Coalescido por microtask (§13 caso 27): una ráfaga de eventos en el mismo tick agenda un único flush. */
  private scheduleFlush(documentId: string): void {
    if (this.flushScheduledDocuments.has(documentId)) return;
    this.flushScheduledDocuments.add(documentId);
    queueMicrotask(() => {
      this.flushScheduledDocuments.delete(documentId);
      this.flushDirtyPages(documentId);
    });
  }

  private flushDirtyPages(documentId: string): void {
    const dirty = this.dirtyPagesByDocument.get(documentId);
    if (dirty === undefined || dirty.size === 0) return;
    this.dirtyPagesByDocument.delete(documentId);
    // Defensivo: el documento pudo cerrarse mientras se esperaba el microtask.
    if (!this.state.has(documentId)) return;

    const snapshot = this.engines.grouping.getSnapshot(documentId);
    const ctx = this.mediatedPreviewCtx(documentId);

    // A diferencia del seed, el flush SIEMPRE renderiza cada página sucia,
    // incluso si `replacements` quedó vacío (p. ej. único grupo de la página
    // deshabilitado o eliminado): así el preview vuelve al original en vez de
    // quedar con el `lastAnonymizedInputs` stale de antes de la edición (bug
    // 2 de ADR-044 — el toggle off→on recompone del snapshot, no de un
    // estado filtrado previo).
    for (const pageIndex of dirty) {
      const replacements = buildPageReplacements(pageIndex, snapshot.groups);
      this.renderMediatedPreview(documentId, pageIndex, replacements, ctx);
    }
  }

  /**
   * Seed inicial del preview anonimizado (§Decisión 3, caso 26): corre en
   * cada `GROUPING_FINISHED`, incluida la vía suprimida por cancelación de
   * `reanalyze` (ADR-038 §6, ver `handleGroupingFinished`). La cascada
   * síncrona hasta acá + el `rememberInput` síncrono de `RenderEngine.renderPage`
   * garantizan que el primer `RENDER_REQUESTED` que la UI emita al observar
   * `Ready` reconstruya ya con reemplazos reales — cierra el deadlock de
   * arranque del preview (ADR-044 §Contexto, bug 1). Corre también en la vía
   * suprimida por cancelación de `reanalyze` (`handleGroupingFinished`), donde
   * la señal del documento ya está abortada — de ahí que use una señal propia
   * (`mediatedPreviewCtx`, v1.5.1) y no la de `abortRegistry`.
   */
  private seedAnonymizedPreview(documentId: string): void {
    const document = this.documents.get(documentId);
    if (document === undefined) return;
    // El barrido completo del snapshot cubre cualquier página que haya
    // quedado marcada sucia durante las etapas pre-Ready (acumulada pero
    // nunca flusheada, caso 26): se descarta para no duplicar el render.
    this.dirtyPagesByDocument.delete(documentId);

    const snapshot = this.engines.grouping.getSnapshot(documentId);
    const ctx = this.mediatedPreviewCtx(documentId);

    for (let pageIndex = 0; pageIndex < document.pageCount; pageIndex++) {
      const replacements = buildPageReplacements(pageIndex, snapshot.groups);
      // Caso 26: páginas sin ningún reemplazo habilitado no se siembran (la
      // reconstrucción default de RENDER_REQUESTED con `replacements: []` ya
      // es correcta — a diferencia del flush, acá no hay un estado previo que
      // revertir).
      if (replacements.length === 0) continue;
      this.renderMediatedPreview(documentId, pageIndex, replacements, ctx);
    }
  }

  /**
   * `EngineContext` con una señal PROPIA, nunca ligada a `abortRegistry`
   * (v1.5.1, `Orchestrator.md` nota de cabecera): `cancelReanalyze` (ADR-038
   * §6) aborta la señal del documento **antes** de `await finishSession(...)`,
   * y como esa llamada corre síncrona hasta `GROUPING_FINISHED`, el seed que
   * `handleGroupingFinished` dispara en esa vía se ejecutaría con la señal ya
   * abortada si reusara `abortRegistry` — `renderPage` rechazaría con
   * `CancelledError` antes de `rememberInput`, y el seed nunca poblaría
   * `lastAnonymizedInputs`. El seed/flush del preview mediado ya son
   * "best-effort... inmunes al supersede" (ADR-044 §3); acá quedan además
   * inmunes a la cancelación del documento, sin tocar el orden
   * `abort`/`finishSession` de `cancelReanalyze` (ADR-038 intacto).
   *
   * (v1.5.4, ADR-052 §3 — amendment de ADR-044 §3): "nunca abortada" era
   * demasiado ancho — dejaba renders mediados corriendo contra un documento
   * cuyo proxy de Render `closeDocument`/`dispose` ya destruyeron, con su
   * `PREVIEW_UPDATED` tardío dejando un blob URL que nadie iba a revocar. La
   * señal pasa a ser **por documento** (`mediatedPreviewControllers`),
   * reutilizada entre llamadas de `seedAnonymizedPreview`/`flushDirtyPages`
   * para el mismo documento: inmune a la **cancelación** (`cancelReanalyze`
   * no la toca, invariante intacto) pero no a la **baja**
   * (`closeDocument`/`dispose` la abortan y la limpian del mapa).
   */
  private mediatedPreviewCtx(documentId: string): EngineContext {
    let controller = this.mediatedPreviewControllers.get(documentId);
    if (controller === undefined) {
      controller = new AbortController();
      this.mediatedPreviewControllers.set(documentId, controller);
    }
    return this.ctxFor(controller.signal, documentId);
  }

  /**
   * Invocación directa de `renderPage` para el preview mediado (§Decisión 1):
   * mismo patrón que el `RenderPageProvider` del export (ADR-014/ADR-043) —
   * inmune al supersede de `RENDER_REQUESTED` (`Render_Engine.md` §13 caso 21).
   * Best-effort: un fallo se loguea y no interrumpe las demás páginas ni
   * escala a `PIPELINE_FAILED` (el preview nunca es una razón para fallar el
   * pipeline).
   *
   * ADR-058 §5 / Orchestrator.md v1.7.1 ítem 22b: adjunta `lineWords` acá,
   * centralizado, en vez de en cada call site — `flushDirtyPages` y
   * `seedAnonymizedPreview` son los dos únicos caminos que llegan a este
   * método y lo heredan sin tocarlos. `makeRenderPageProvider.renderFull`
   * (el del export) no pasa por acá — ver el comentario en ese método para
   * por qué repite el cálculo en vez de compartirlo.
   */
  private renderMediatedPreview(
    documentId: string,
    pageIndex: number,
    replacements: ReadonlyArray<Replacement>,
    ctx: EngineContext,
  ): void {
    // `Page.words` del Document retenido; ausente (documento ya cerrado,
    // página fuera de rango) degrada a [] — `selectLineWords` sobre un
    // array vacío ya se comporta bien (ADR-058 §5: sin vecinas utilizables,
    // el kernel cae a shrink-to-fit).
    const pageWords = this.documents.get(documentId)?.pages[pageIndex]?.words ?? [];
    const lineWords = selectLineWords(pageWords, replacements);
    const input: RenderPageInput = {
      documentId,
      pageIndex,
      kind: "anonymized",
      mode: "preview",
      replacements,
      ...(lineWords !== undefined ? { lineWords } : {}),
    };
    this.engines.render.renderPage(input, ctx).catch((err: unknown) => {
      this.logger.warn("Render mediado del preview anonimizado falló (best-effort, ADR-044).", {
        documentId,
        pageIndex,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Guard de llegada tardía (ADR-052 §2, v1.5.4): si `documentId` ya no está
   * en `state` (el documento cerró), el `PREVIEW_UPDATED` es tardío — llegó
   * después del `revokeByPrefix` de `closeDocument`, y ese `documentId` no
   * lo vuelve a barrer ningún cierre futuro. El URL ya lo creó el motor
   * (ADR-034 §5); si el Orchestrator no lo revoca acá, nadie lo revoca
   * nunca. Es determinista: entre `revokeByPrefix` y `state.delete` de
   * `closeDocument` no hay ningún `await`, así que un `PREVIEW_UPDATED` que
   * llegue **durante** el `await unloadDocument` todavía ve `state.has ===
   * true` y se registra normal (lo barre el `revokeByPrefix` de después).
   */
  private handlePreviewUpdated(payload: PreviewUpdated): void {
    if (!this.state.has(payload.documentId)) {
      URL.revokeObjectURL(payload.canvasBlobUrl);
      this.logger.warn("PREVIEW_UPDATED tardío para un documento ya cerrado; blob URL revocado.", {
        documentId: payload.documentId,
        pageIndex: payload.pageIndex,
      });
      return;
    }
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

  /** Guard de llegada tardía (ADR-052 §2, v1.5.4) — mismo tratamiento que `handlePreviewUpdated`. */
  private handleExportFinished(payload: ExportFinished): void {
    if (!this.state.has(payload.documentId)) {
      URL.revokeObjectURL(payload.blobUrl);
      this.logger.warn("EXPORT_FINISHED tardío para un documento ya cerrado; blob URL revocado.", {
        documentId: payload.documentId,
      });
      return;
    }
    this.blobTracker.set(exportBlobKey(payload.documentId), payload.blobUrl);
    // `setStage` y no `state.update`: la transición a `Done` que pide el spec
    // (`Orchestrator.md` §8, fila `EXPORT_FINISHED`) tiene que **emitirse**,
    // no solo guardarse. Con `state.update` el estado interno pasaba a `Done`
    // y `PIPELINE_STAGE_CHANGED` nunca salía, así que para la UI el stage
    // quedaba en `Exporting` **para siempre** tras un export exitoso: el
    // botón "Exportar" desaparecía (su gate es `{Ready, Done}`), "Cancelar"
    // seguía visible, y el `blobUrl` recién generado quedaba inalcanzable —
    // el documento inutilizable justo después de terminar bien. Todas las
    // demás transiciones de este archivo ya usaban `setStage`.
    this.setStage(payload.documentId, PipelineStage.Done);
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

  private poolSizeFor(key: ManagedPoolKey): number {
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

  /**
   * `Cancelled` es **terminal**: ningún evento tardío lo pisa.
   *
   * Sin esto, un documento cancelado volvía a su etapa de trabajo. `cancel()`
   * aborta la señal y deja el stage en `Cancelled`, pero los jobs que ya
   * estaban en vuelo siguen resolviendo, y sus handlers llamaban `setStage` y
   * `emitProgress` sin mirar si todavía tenía sentido. El usuario veía
   * "Cancelado" y medio segundo después "Buscando datos sensibles: página 500
   * de 500…" — la app diciéndole que seguía procesando el documento que acababa
   * de pedir que no procesara (ADR-134).
   *
   * La guarda va acá y no en cada handler a propósito: son muchos caminos y
   * alcanza con que uno se olvide. `cancel()` escribe el stage con
   * `state.update` directo, así que no se bloquea a sí mismo.
   *
   * **No mira `cancelRequested`**, que `cancelReanalyze` también levanta:
   * cancelar un reanalyze vuelve a `Ready` a propósito (caso 22 del spec) y
   * tiene que poder seguir escribiendo su stage.
   */
  private isCancelled(documentId: string): boolean {
    return this.state.get(documentId)?.stage === PipelineStage.Cancelled;
  }

  private setStage(documentId: string, stage: PipelineStage): void {
    if (this.isCancelled(documentId)) return;
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
    // Un documento cancelado no reporta progreso: ver `isCancelled` (ADR-134).
    if (state.stage === PipelineStage.Cancelled) return;
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
