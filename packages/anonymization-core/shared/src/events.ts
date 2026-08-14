/**
 * @anonly/shared — Payloads tipados de cada evento del bus.
 *
 * Fuente de verdad: docs/architecture/04_Event_System.md y docs/core/Contracts.md §8.
 *
 * Reglas:
 * - Todos los campos readonly.
 * - Nunca incluir Document completo ni Page completa; usar refs (documentId, pageIndex).
 * - Occurrence y EntityGroup sí pueden viajar completos (unidad funcional).
 * - Cualquier ArrayBuffer va como Transferable en postMessage al Worker, no como
 *   payload del bus de eventos del host.
 *
 * Nota: se usan interfaces individuales + EventPayloadMap (type map) en lugar de
 * un namespace porque verbatimModuleSyntax no soporta indexed access types
 * sobre namespaces importados con import type.
 */

import type {
  EngineEvents,
  PersonGenderChoice,
  PipelineStage,
  ReplacementMode,
  WorkerJobType,
} from "./enums.js";
import type { SerializedEngineError } from "./errors.js";
import type {
  Conflict,
  DocumentSourceKind,
  EntityGroup,
  ExportOptions,
  Occurrence,
  Rule,
} from "./types.js";

// ─── Pipeline ───
export interface DocumentImported {
  readonly documentId: string;
  readonly name: string;
  readonly sizeBytes: number;
}
export interface PipelineStageChanged {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly progress: number;
}
export interface PipelineProgress {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly current: number;
  readonly total: number;
}
export interface PipelineReady {
  readonly documentId: string;
  readonly groupCount: number;
  readonly conflictCount: number;
}
export interface PipelineCancelled {
  readonly documentId: string;
  readonly reason: string;
}
export interface PipelineFailed {
  readonly documentId: string;
  readonly error: SerializedEngineError;
}
export interface CancelRequested {
  readonly documentId: string;
  readonly jobId?: string;
}

// ─── PDF ───
export interface PageParsed {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly wordCount: number;
  readonly requiresOCR: boolean;
}
export interface DocumentParsed {
  readonly documentId: string;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>;
  readonly sourceKind: DocumentSourceKind;
}
export interface PdfPasswordRequired {
  readonly documentId: string;
}
export interface PdfInvalid {
  readonly documentId: string;
  readonly reason: string;
}

// ─── OCR ───
export interface OcrStarted {
  readonly documentId: string;
  readonly pagesToProcess: ReadonlyArray<number>;
  /** true si el modelo Tesseract se está descargando (primera vez; ADR-021 §3). */
  readonly modelLoading?: boolean;
}
export interface OcrPageFinished {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly wordCount: number;
  readonly confidence: number;
}
export interface OcrFinished {
  readonly documentId: string;
  readonly durationMs: number;
  /** true si el modelo Tesseract se descargó durante esta corrida (ADR-021 §3). */
  readonly modelDownloaded?: boolean;
}
export interface OcrPageFailed {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly error: SerializedEngineError;
}

// ─── Detectores ───
export interface EntityFound {
  readonly documentId: string;
  readonly occurrence: Occurrence;
}
export interface RegexFinished {
  readonly documentId: string;
  readonly occurrenceCount: number;
  readonly durationMs: number;
}
export interface NerStarted {
  readonly documentId: string;
  readonly pageCount: number;
  readonly modelId: string;
  readonly modelLoading?: boolean;
}
export interface NerModelLoading {
  readonly modelId: string;
  readonly progress: number;
}
export interface NerModelReady {
  readonly modelId: string;
}
export interface NerPageFinished {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly occurrenceCount: number;
}
export interface NerFinished {
  readonly documentId: string;
  readonly occurrenceCount: number;
  readonly durationMs: number;
}

// ─── Grouping ───
export interface EntityGroupCreated {
  readonly documentId: string;
  readonly group: EntityGroup;
}
export interface EntityGroupUpdated {
  readonly documentId: string;
  readonly group: EntityGroup;
  readonly changes: ReadonlyArray<keyof EntityGroup>;
}
export interface EntityGroupRemoved {
  readonly documentId: string;
  readonly groupId: string;
}
export interface GroupReplacementChanged {
  readonly documentId: string;
  readonly groupId: string;
  readonly mode: ReplacementMode;
  readonly value: string;
}
export interface GroupToggled {
  readonly documentId: string;
  readonly groupId: string;
  readonly enabled: boolean;
}
export interface ConflictDetected {
  readonly documentId: string;
  readonly conflict: Conflict;
}
export interface ConflictResolved {
  readonly documentId: string;
  readonly conflictId: string;
  readonly mode: ReplacementMode;
}
export interface GroupingFinished {
  readonly documentId: string;
  readonly groupCount: number;
  readonly conflictCount: number;
  readonly durationMs: number;
}

// ─── Render ───
export interface PreviewUpdated {
  readonly documentId: string;
  readonly pageIndex: number;
  /** A qué visor corresponde el blob: original o anonimizado (ADR-016). */
  readonly kind: "original" | "anonymized";
  readonly canvasBlobUrl: string;
}
export interface PreviewPageFailed {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly error: SerializedEngineError;
}
export interface RenderRequested {
  readonly documentId: string;
  readonly pageIndices: ReadonlyArray<number>;
  readonly mode: "preview" | "full";
  /**
   * Panel que pide el render (ADR-056 §1). REQUERIDO — el motor renderiza
   * solo ese lado, nunca los dos. Lo determina el panel emisor (un
   * `PdfViewer` por kind), NUNCA el toggle de sincronización de scroll
   * (ADR-056 §2).
   */
  readonly kind: "original" | "anonymized";
  /**
   * Escala absoluta pdfjs (1.0 = 72 DPI), misma semántica que
   * `RenderPageInput.scale` (ADR-037 §1). Ausente → `previewScale`/`fullScale`
   * según `mode`. Rango válido: `0 < scale <= MAX_RENDER_SCALE`.
   */
  readonly scale?: number;
}
export interface RenderFinished {
  readonly documentId: string;
  readonly pageIndices: ReadonlyArray<number>;
  readonly durationMs: number;
}
export interface RenderFailed {
  readonly documentId: string;
  readonly error: SerializedEngineError;
}

// ─── Export ───
export interface ExportRequested {
  readonly documentId: string;
  readonly options: ExportOptions;
}
export interface ExportStarted {
  readonly documentId: string;
}
export interface ExportProgress {
  readonly documentId: string;
  readonly current: number;
  readonly total: number;
}
export interface ExportFinished {
  readonly documentId: string;
  readonly blobUrl: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
}
export interface ExportFailed {
  readonly documentId: string;
  readonly error: SerializedEngineError;
}

// ─── Workers ───
export interface WorkerJobDispatched {
  readonly jobId: string;
  readonly workerId: string;
  readonly type: WorkerJobType;
}
export interface WorkerJobCompleted {
  readonly jobId: string;
  readonly result: unknown;
}
export interface WorkerJobFailed {
  readonly jobId: string;
  readonly error: SerializedEngineError;
}
export interface WorkerJobCancelled {
  readonly jobId: string;
  readonly signalId: string;
}
export interface WorkerJobTimeout {
  readonly jobId: string;
  readonly timeoutMs: number;
}
export interface WorkerPoolSaturated {
  readonly type: WorkerJobType;
  readonly queueLength: number;
}

// ─── UI inputs ───
export interface GroupUpdateRequested {
  readonly documentId: string;
  readonly groupId: string;
  // ADR-069 §4: personGender no sale de un Pick de EntityGroup porque su tercer
  // estado ("neutral") no existe como valor almacenado — borra el campo. Sobre
  // un grupo de type distinto de Person se ignora con warn.
  readonly patch: Partial<
    Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">
  > & { readonly personGender?: PersonGenderChoice };
}
export interface GroupMergeRequested {
  readonly documentId: string;
  readonly sourceGroupId: string;
  readonly targetGroupId: string;
}
export interface GroupSplitRequested {
  readonly documentId: string;
  readonly groupId: string;
  readonly occurrenceIds: ReadonlyArray<string>;
}
export interface RuleCreated {
  readonly documentId: string;
  readonly rule: Rule;
}
export interface RuleUpdated {
  readonly documentId: string;
  readonly ruleId: string;
  readonly patch: Partial<Rule>;
}
export interface RuleDeleted {
  readonly documentId: string;
  readonly ruleId: string;
}
export interface ConflictResolveRequested {
  readonly documentId: string;
  readonly conflictId: string;
  readonly mode: ReplacementMode;
}
export interface DocumentClosed {
  readonly documentId: string;
}

// ─── Type Map: EngineEvents → payload type ───
// Esto reemplaza al namespace EventPayloads. Permite EventPayloadMap[E] en IEventBus
// siendo compatible con verbatimModuleSyntax y import type.
export type EventPayloadMap = {
  [EngineEvents.DOCUMENT_IMPORTED]: DocumentImported;
  [EngineEvents.PIPELINE_STAGE_CHANGED]: PipelineStageChanged;
  [EngineEvents.PIPELINE_PROGRESS]: PipelineProgress;
  [EngineEvents.PIPELINE_READY]: PipelineReady;
  [EngineEvents.PIPELINE_CANCELLED]: PipelineCancelled;
  [EngineEvents.PIPELINE_FAILED]: PipelineFailed;
  [EngineEvents.CANCEL_REQUESTED]: CancelRequested;
  [EngineEvents.PAGE_PARSED]: PageParsed;
  [EngineEvents.DOCUMENT_PARSED]: DocumentParsed;
  [EngineEvents.PDF_PASSWORD_REQUIRED]: PdfPasswordRequired;
  [EngineEvents.PDF_INVALID]: PdfInvalid;
  [EngineEvents.OCR_STARTED]: OcrStarted;
  [EngineEvents.OCR_PAGE_FINISHED]: OcrPageFinished;
  [EngineEvents.OCR_FINISHED]: OcrFinished;
  [EngineEvents.OCR_PAGE_FAILED]: OcrPageFailed;
  [EngineEvents.ENTITY_FOUND]: EntityFound;
  [EngineEvents.REGEX_FINISHED]: RegexFinished;
  [EngineEvents.NER_STARTED]: NerStarted;
  [EngineEvents.NER_MODEL_LOADING]: NerModelLoading;
  [EngineEvents.NER_MODEL_READY]: NerModelReady;
  [EngineEvents.NER_PAGE_FINISHED]: NerPageFinished;
  [EngineEvents.NER_FINISHED]: NerFinished;
  [EngineEvents.ENTITY_GROUP_CREATED]: EntityGroupCreated;
  [EngineEvents.ENTITY_GROUP_UPDATED]: EntityGroupUpdated;
  [EngineEvents.ENTITY_GROUP_REMOVED]: EntityGroupRemoved;
  [EngineEvents.GROUP_REPLACEMENT_CHANGED]: GroupReplacementChanged;
  [EngineEvents.GROUP_TOGGLED]: GroupToggled;
  [EngineEvents.CONFLICT_DETECTED]: ConflictDetected;
  [EngineEvents.CONFLICT_RESOLVED]: ConflictResolved;
  [EngineEvents.GROUPING_FINISHED]: GroupingFinished;
  [EngineEvents.PREVIEW_UPDATED]: PreviewUpdated;
  [EngineEvents.PREVIEW_PAGE_FAILED]: PreviewPageFailed;
  [EngineEvents.RENDER_REQUESTED]: RenderRequested;
  [EngineEvents.RENDER_FINISHED]: RenderFinished;
  [EngineEvents.RENDER_FAILED]: RenderFailed;
  [EngineEvents.EXPORT_REQUESTED]: ExportRequested;
  [EngineEvents.EXPORT_STARTED]: ExportStarted;
  [EngineEvents.EXPORT_PROGRESS]: ExportProgress;
  [EngineEvents.EXPORT_FINISHED]: ExportFinished;
  [EngineEvents.EXPORT_FAILED]: ExportFailed;
  [EngineEvents.WORKER_JOB_DISPATCHED]: WorkerJobDispatched;
  [EngineEvents.WORKER_JOB_COMPLETED]: WorkerJobCompleted;
  [EngineEvents.WORKER_JOB_FAILED]: WorkerJobFailed;
  [EngineEvents.WORKER_JOB_CANCELLED]: WorkerJobCancelled;
  [EngineEvents.WORKER_JOB_TIMEOUT]: WorkerJobTimeout;
  [EngineEvents.WORKER_POOL_SATURATED]: WorkerPoolSaturated;
  [EngineEvents.GROUP_UPDATE_REQUESTED]: GroupUpdateRequested;
  [EngineEvents.GROUP_MERGE_REQUESTED]: GroupMergeRequested;
  [EngineEvents.GROUP_SPLIT_REQUESTED]: GroupSplitRequested;
  [EngineEvents.RULE_CREATED]: RuleCreated;
  [EngineEvents.RULE_UPDATED]: RuleUpdated;
  [EngineEvents.RULE_DELETED]: RuleDeleted;
  [EngineEvents.CONFLICT_RESOLVE_REQUESTED]: ConflictResolveRequested;
  [EngineEvents.DOCUMENT_CLOSED]: DocumentClosed;
};
