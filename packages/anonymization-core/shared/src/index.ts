/**
 * @anonly/shared — Punto único de export del paquete.
 *
 * Todo consumer del Core importa desde "@anonly/shared".
 * Nada se importa desde rutas internas (Code_Standards.md §3).
 *
 * Fuente de verdad: docs/core/Contracts.md.
 */

// Enums
export {
  EngineId,
  EventChannel,
  EngineEvents,
  EntityType,
  ReplacementMode,
  DetectionSource,
  AnnotationKind,
  ConflictReason,
  PipelineStage,
  EngineErrorCode,
} from "./enums.js";
export type { RuleScope, WorkerJobType } from "./enums.js";

// Modelos de datos (03_Data_Model.md)
export type {
  BoundingBox,
  WordSpan,
  Word,
  Page,
  DocumentMetadata,
  Document,
  DocumentSourceKind,
  Occurrence,
  OccurrenceRef,
  EntityGroup,
  Replacement,
  RuleTarget,
  Rule,
  Annotation,
  ConflictCandidate,
  Conflict,
  PipelineError,
  PipelineState,
  WorkerJob,
  WorkerJobPayload,
  PdfParsePayload,
  OcrPagePayload,
  NerPagePayload,
  RenderPagePayload,
  ExportPagePayload,
  ExportOptions,
  ExportMetadata,
  WorkerCapabilities,
} from "./types.js";

// Interfaces base (Contracts.md §3)
export type {
  IEngine,
  EngineContext,
  EngineConfig,
  PdfEngineConfig,
  IEventBus,
  EventHandler,
  Unsubscribe,
  ILogger,
  ICache,
  WorkerPoolConfig,
  NerConfig,
  OcrConfig,
  GroupingConfig,
  RenderConfig,
  ExportConfig,
  Serializable,
  WorkerInbound,
  WorkerOutbound,
  LogLevel,
} from "./interfaces.js";

// Errores (Contracts.md §4)
export {
  EngineError,
  EngineNotInitializedError,
  EngineDisposedError,
  InvalidInputError,
  CancelledError,
} from "./errors.js";
export type { SerializedEngineError } from "./errors.js";

// Eventos y payloads (Contracts.md §8 + 04_Event_System.md)
// Interfaces individuales + type map (sin namespace, compatible con verbatimModuleSyntax)
export type {
  EventPayloadMap,
  // Pipeline
  DocumentImported,
  PipelineStageChanged,
  PipelineProgress,
  PipelineReady,
  PipelineCancelled,
  PipelineFailed,
  CancelRequested,
  // PDF
  PageParsed,
  DocumentParsed,
  PdfPasswordRequired,
  PdfInvalid,
  // OCR
  OcrStarted,
  OcrPageFinished,
  OcrFinished,
  OcrPageFailed,
  // Detectores
  EntityFound,
  RegexFinished,
  NerStarted,
  NerModelLoading,
  NerModelReady,
  NerPageFinished,
  NerFinished,
  // Grouping
  EntityGroupCreated,
  EntityGroupUpdated,
  EntityGroupRemoved,
  GroupReplacementChanged,
  GroupToggled,
  ConflictDetected,
  ConflictResolved,
  GroupingFinished,
  // Render
  PreviewUpdated,
  PreviewPageFailed,
  RenderRequested,
  RenderFinished,
  RenderFailed,
  // Export
  ExportRequested,
  ExportStarted,
  ExportProgress,
  ExportFinished,
  ExportFailed,
  // Workers
  WorkerJobDispatched,
  WorkerJobCompleted,
  WorkerJobFailed,
  WorkerJobCancelled,
  WorkerJobTimeout,
  WorkerPoolSaturated,
  // UI inputs
  GroupUpdateRequested,
  GroupMergeRequested,
  GroupSplitRequested,
  RuleCreated,
  RuleUpdated,
  RuleDeleted,
  ConflictResolveRequested,
  DocumentClosed,
} from "./events.js";

// Transferable (Contracts.md §7)
export { makeTransferable, isTransferable } from "./transferable.js";
export type { Transferable } from "./transferable.js";

// Sintetizador (ADR-012-Replacement-Modes.md)
export { synthesize } from "./synthesizer.js";
