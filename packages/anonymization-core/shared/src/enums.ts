/**
 * @anonly/shared — Enumeradores del Core.
 *
 * Fuente de verdad: docs/core/Contracts.md §1, §2, §5.
 * Toda modificación debe ir con PR de docs aparte que actualice Contracts.md primero.
 */

export enum EngineId {
  Pdf = "pdf",
  Ocr = "ocr",
  Regex = "regex",
  Ner = "ner",
  Grouping = "grouping",
  Render = "render",
  Export = "export",
}

export enum EventChannel {
  Pipeline = "pipeline",
  UI = "ui",
  Pdf = "pdf",
  Ocr = "ocr",
  Regex = "regex",
  Ner = "ner",
  Grouping = "grouping",
  Render = "render",
  Export = "export",
  Workers = "workers",
}

export enum EngineEvents {
  // Pipeline
  DOCUMENT_IMPORTED = "DOCUMENT_IMPORTED",
  PIPELINE_STAGE_CHANGED = "PIPELINE_STAGE_CHANGED",
  PIPELINE_PROGRESS = "PIPELINE_PROGRESS",
  PIPELINE_READY = "PIPELINE_READY",
  PIPELINE_CANCELLED = "PIPELINE_CANCELLED",
  PIPELINE_FAILED = "PIPELINE_FAILED",
  CANCEL_REQUESTED = "CANCEL_REQUESTED",

  // PDF
  PAGE_PARSED = "PAGE_PARSED",
  DOCUMENT_PARSED = "DOCUMENT_PARSED",
  PDF_PASSWORD_REQUIRED = "PDF_PASSWORD_REQUIRED",
  PDF_INVALID = "PDF_INVALID",

  // OCR
  OCR_STARTED = "OCR_STARTED",
  OCR_PAGE_FINISHED = "OCR_PAGE_FINISHED",
  OCR_FINISHED = "OCR_FINISHED",
  OCR_PAGE_FAILED = "OCR_PAGE_FAILED",

  // Detectores
  ENTITY_FOUND = "ENTITY_FOUND",
  REGEX_FINISHED = "REGEX_FINISHED",
  NER_STARTED = "NER_STARTED",
  NER_MODEL_LOADING = "NER_MODEL_LOADING",
  NER_MODEL_READY = "NER_MODEL_READY",
  NER_PAGE_FINISHED = "NER_PAGE_FINISHED",
  NER_FINISHED = "NER_FINISHED",

  // Grouping
  ENTITY_GROUP_CREATED = "ENTITY_GROUP_CREATED",
  ENTITY_GROUP_UPDATED = "ENTITY_GROUP_UPDATED",
  ENTITY_GROUP_REMOVED = "ENTITY_GROUP_REMOVED",
  GROUP_REPLACEMENT_CHANGED = "GROUP_REPLACEMENT_CHANGED",
  GROUP_TOGGLED = "GROUP_TOGGLED",
  CONFLICT_DETECTED = "CONFLICT_DETECTED",
  CONFLICT_RESOLVED = "CONFLICT_RESOLVED",
  GROUPING_FINISHED = "GROUPING_FINISHED",

  // Render
  PREVIEW_UPDATED = "PREVIEW_UPDATED",
  PREVIEW_PAGE_FAILED = "PREVIEW_PAGE_FAILED",
  RENDER_REQUESTED = "RENDER_REQUESTED",
  RENDER_FINISHED = "RENDER_FINISHED",
  RENDER_FAILED = "RENDER_FAILED",

  // Export
  EXPORT_REQUESTED = "EXPORT_REQUESTED",
  EXPORT_STARTED = "EXPORT_STARTED",
  EXPORT_PROGRESS = "EXPORT_PROGRESS",
  EXPORT_FINISHED = "EXPORT_FINISHED",
  EXPORT_FAILED = "EXPORT_FAILED",

  // Workers
  WORKER_JOB_DISPATCHED = "WORKER_JOB_DISPATCHED",
  WORKER_JOB_COMPLETED = "WORKER_JOB_COMPLETED",
  WORKER_JOB_FAILED = "WORKER_JOB_FAILED",
  WORKER_JOB_CANCELLED = "WORKER_JOB_CANCELLED",
  WORKER_JOB_TIMEOUT = "WORKER_JOB_TIMEOUT",
  WORKER_POOL_SATURATED = "WORKER_POOL_SATURATED",

  // UI inputs
  GROUP_UPDATE_REQUESTED = "GROUP_UPDATE_REQUESTED",
  GROUP_MERGE_REQUESTED = "GROUP_MERGE_REQUESTED",
  GROUP_SPLIT_REQUESTED = "GROUP_SPLIT_REQUESTED",
  RULE_CREATED = "RULE_CREATED",
  RULE_UPDATED = "RULE_UPDATED",
  RULE_DELETED = "RULE_DELETED",
  CONFLICT_RESOLVE_REQUESTED = "CONFLICT_RESOLVE_REQUESTED",
  DOCUMENT_CLOSED = "DOCUMENT_CLOSED",
}

export enum EntityType {
  Person = "PERSON",
  Organization = "ORGANIZATION",
  Address = "ADDRESS",
  DNI = "DNI",
  CUIT = "CUIT",
  Phone = "PHONE",
  Email = "EMAIL",
  IBAN = "IBAN",
  CreditCard = "CREDIT_CARD",
  Date = "DATE",
  License = "LICENSE",
  Plate = "PLATE",
  Custom = "CUSTOM",
}

export enum ReplacementMode {
  Mask = "mask",
  Synthetic = "synthetic",
  Placeholder = "placeholder",
  Redact = "redact",
}

export enum DetectionSource {
  Regex = "regex",
  NER = "ner",
  OCR = "ocr",
  Manual = "manual",
}

export enum AnnotationKind {
  Highlight = "highlight",
  Replacement = "replacement",
  Redact = "redact",
  Conflict = "conflict",
  // ADR-058 §7: el reemplazo hubo que encogerlo por debajo del umbral de
  // legibilidad (DEGRADED_FONT_RATIO). Es una señal de RENDER, no de datos: marca
  // que esos píxeles quedaron comprometidos. No confundir con la marca de
  // "género sin determinar" del árbol de entidades, que es una afordancia de UI
  // sobre información faltante y no se pinta en el canvas (ADR-060 §5).
  Degraded = "degraded",
}

// ADR-060 §2: solo aplicable a EntityGroup de type === Person. Ausente = sin
// determinar; no es una tercera categoría (03_Data_Model.md §9).
export type PersonGender = "f" | "m";

// ADR-069 §4: lo que el usuario elige en el selector de tres estados. El
// tercer estado viaja como VALOR ("neutral"), no como ausencia de la clave:
// los otros campos de GroupUpdateRequested.patch siempre vienen con valor y se
// resuelven con `!== undefined`, así que sin este token el usuario no podría
// deshacer su elección. Al aplicarlo, "neutral" BORRA EntityGroup.personGender
// —el almacenamiento sigue siendo "f" | "m" | ausente— y el motor recuerda
// aparte que la elección la hizo el humano (Grouping_Engine.md §13 caso 34).
export type PersonGenderChoice = PersonGender | "neutral";

export enum ConflictReason {
  Overlap = "overlap",
  Disagree = "disagree",
  LowConfidence = "low_confidence",
  AmbiguousCanonical = "ambiguous_canonical",
}

export enum PipelineStage {
  Idle = "idle",
  Importing = "importing",
  Extracting = "extracting",
  OCRing = "ocring",
  Detecting = "detecting",
  Grouping = "grouping",
  Ready = "ready",
  Rendering = "rendering",
  Exporting = "exporting",
  Done = "done",
  Failed = "failed",
  Cancelled = "cancelled",
}

export type RuleScope = "group" | "type" | "global";

export type WorkerJobType = "pdf-parse" | "ocr-page" | "ner-page" | "render-page" | "export-page";

/**
 * Códigos de error canónicos del Core.
 * Todo motor que lance un error debe usar una subclase de EngineError
 * con uno de estos códigos.
 *
 * Fuente de verdad: docs/core/Contracts.md §4.
 */
export enum EngineErrorCode {
  // PDF
  PDF_PASSWORD_REQUIRED = "PDF_PASSWORD_REQUIRED",
  PDF_INVALID = "PDF_INVALID",
  PDF_CORRUPTED = "PDF_CORRUPTED",
  PDF_TIMEOUT = "PDF_TIMEOUT",
  // OCR
  OCR_PAGE_FAILED = "OCR_PAGE_FAILED",
  OCR_TIMEOUT = "OCR_TIMEOUT",
  OCR_MODEL_MISSING = "OCR_MODEL_MISSING",
  // Regex
  REGEX_INVALID_PATTERN = "REGEX_INVALID_PATTERN",
  // NER
  NER_MODEL_MISSING = "NER_MODEL_MISSING",
  NER_MODEL_LOAD_FAILED = "NER_MODEL_LOAD_FAILED",
  NER_TIMEOUT = "NER_TIMEOUT",
  NER_PAGE_FAILED = "NER_PAGE_FAILED",
  // Grouping
  GROUPING_INVALID_PATCH = "GROUPING_INVALID_PATCH",
  GROUPING_GROUP_NOT_FOUND = "GROUPING_GROUP_NOT_FOUND",
  // Render
  RENDER_PAGE_FAILED = "RENDER_PAGE_FAILED",
  RENDER_TIMEOUT = "RENDER_TIMEOUT",
  RENDER_FAILED = "RENDER_FAILED", // fatal de batch (ADR-031)
  // Export
  EXPORT_FAILED = "EXPORT_FAILED",
  EXPORT_NO_ENABLED_GROUPS = "EXPORT_NO_ENABLED_GROUPS",
  EXPORT_TIMEOUT = "EXPORT_TIMEOUT",
  // Generic
  ENGINE_NOT_INITIALIZED = "ENGINE_NOT_INITIALIZED",
  ENGINE_DISPOSED = "ENGINE_DISPOSED",
  INVALID_INPUT = "INVALID_INPUT",
  CANCELLED = "CANCELLED",
  /**
   * ADR-077: crash de transporte de un Worker. Es del transporte, no del
   * dominio, así que su `engineId` es "core" y sirve para los cinco pools.
   * Retryable: el worker de reemplazo arranca limpio y el `RenderPool` lo
   * re-primea antes del primer job (ADR-043 §5).
   */
  WORKER_CRASHED = "WORKER_CRASHED",
}
