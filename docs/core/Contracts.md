<!-- CONTEXT: scope=contratos-base | dependencias=03_Data_Model.md,04_Event_System.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=IA-implementador | fase=3 (§3.5 actualizado en fase 10: CoreRuntimeOptions/WorkerLike/WorkerFactory para transporte de workers —ADR-036 §2—, IPipelineOrchestrator.reanalyze/ReanalyzeConfigPatch —ADR-038 §1—; §6 gana MAX_RENDER_SCALE/PREVIEW_CACHE_MAX_BYTES —ADR-037 §2-3—; §8 RenderRequested.scale —ADR-037 §1—) -->

# Anonly — Contratos Base (`@anonly/shared`)

> Define **todos** los tipos, interfaces, enums, error codes y contratos compartidos entre motores. Es el único paquete del que un motor puede importar tipos. Un implementador debe leer este archivo **completo** antes de tocar cualquier motor.

**Paquete**: `@anonly/shared`
**Ubicación**: `packages/anonymization-core/shared/`
**Reglas**: inmutable, ESM, TS estricto, sin dependencias externas, sin React, sin network, sin DOM.

---

## 1. Engine ID

```ts
export enum EngineId {
  Pdf = "pdf",
  Ocr = "ocr",
  Regex = "regex",
  Ner = "ner",
  Grouping = "grouping",
  Render = "render",
  Export = "export",
}
```

---

## 2. Engine events (canales del bus)

```ts
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
```

---

## 3. Interfaces base

### 3.1 `IEngine`

Todo motor implementa esta interfaz.

```ts
export interface IEngine {
  readonly id: EngineId;
  init(ctx: EngineContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface EngineContext {
  readonly bus: IEventBus;
  readonly logger: ILogger;
  readonly cache: ICache;
  readonly abortSignal: AbortSignal;
  readonly config: EngineConfig;
}

export interface EngineConfig {
  readonly workerPool: WorkerPoolConfig;
  readonly pdf: PdfEngineConfig;
  readonly ner: NerConfig;
  readonly ocr: OcrConfig;
  readonly grouping: GroupingConfig;
  readonly render: RenderConfig;
  readonly export: ExportConfig;
}
```

`EngineConfig` es fija para la vida de un `createCore`, con una única excepción: `IPipelineOrchestrator.reanalyze` (§3.5) puede actualizar `ner.enabled`/`ocr.languages` en runtime vía una config efectiva mantenida por el Orchestrator (ADR-038 §1). Ningún otro campo es mutable en runtime.

### 3.2 `IEventBus`

```ts
export interface IEventBus {
  on<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    handler: EventHandler<E>
  ): Unsubscribe;
  once<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    handler: EventHandler<E>
  ): Unsubscribe;
  off<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    handler: EventHandler<E>
  ): void;
  emit<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    payload: EventPayloadMap[E]
  ): void;
  emitAsync<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    payload: EventPayloadMap[E]
  ): Promise<void>;
}

export type EventHandler<E extends EngineEvents> = (payload: EventPayloadMap[E]) => void;
export type Unsubscribe = () => void;
```

### 3.3 `ILogger`

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ILogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

Reglas: nunca loguear contenido del documento ni passwords. Ver `08_Security_Model.md` §7.

### 3.4 `ICache`

LRU con límite por items y bytes.

```ts
export interface ICache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, bytes?: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
}
```

### 3.5 Façade del Core (`createCore`)

Contrato público del paquete `@anonly/anonymization-core` (ADR-034 §7: se comparte con la UI, por eso se refleja acá; el spec normativo completo es `core/Orchestrator.md` §6).

```ts
export interface IAnonymizationCore {
  readonly bus: IEventBus;
  readonly engines: {
    readonly pdf: PdfEngine;
    readonly ocr: OcrEngine;
    readonly regex: RegexEngine;
    readonly ner: NerEngine;
    readonly grouping: GroupingEngine;
    readonly render: RenderEngine;
    readonly export: ExportEngine;
  };
  readonly orchestrator: IPipelineOrchestrator;
  dispose(): Promise<void>;
}

export interface ImportDocumentInput {
  readonly documentId: string;        // UUID v4 generado por el caller
  readonly name: string;
  readonly buffer: ArrayBuffer;       // PDF binario
  readonly password?: string;
}

export interface IPipelineOrchestrator {
  importDocument(input: ImportDocumentInput): Promise<void>;   // etapas 0..7 (hasta Ready)
  retryWithPassword(documentId: string, password: string): Promise<void>;
  // Re-corre detección (Regex/NER) y/o re-OCR sobre un documento ya cargado sin
  // perder las ediciones manuales del usuario (grupos, reglas, conflictos
  // resueltos). Ver ADR-038 §1. Precondición: stage ∈ {Ready, Failed}.
  reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void>;
  cancel(documentId: string, jobId?: string): Promise<void>;
  closeDocument(documentId: string): Promise<void>;
  getState(documentId: string): PipelineState;
  dispose(): Promise<void>;
}

// ─── Re-análisis parcial preservando ediciones (Hito 10, ADR-038 §1) ───
// Cubre exactamente los dos settings de UI que afectan detección
// (React_Client.md §3.6/§3.7). Ampliar el patch (p. ej. otros campos de
// NerConfig) requiere ADR nuevo. La inmutabilidad de EngineConfig por sesión
// (§3.1) se relaja únicamente por esta vía: el Orchestrator mantiene una
// config efectiva que reanalyze actualiza mergeando el patch.
export interface ReanalyzeConfigPatch {
  readonly ner?: { readonly enabled: boolean };
  readonly ocr?: { readonly languages: ReadonlyArray<string> };
}

// ─── Transporte de Web Workers reales (Hito 10, ADR-036 §2) ───
// Los Worker de SO los crea la app (única con bundler: Vite resuelve
// `import X from "@anonly/<engine>/worker?worker"`) y los inyecta acá como
// factories. Sin factory para un kind, ese despacho queda in-process
// (comportamiento del Hito 9, ADR-035 §1) — la migración es motor por motor y
// los tests del Core siguen corriendo en node sin `Worker`.
// Las factories van en un parámetro aparte y NO dentro de EngineConfig:
// EngineConfig viaja serializado al worker en INIT y las funciones no son
// structured-cloneables.

export interface WorkerLike {
  postMessage(message: unknown, transfer?: ReadonlyArray<globalThis.Transferable>): void;
  addEventListener(type: "message" | "error", listener: (ev: unknown) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

// "export" refiere al ExportWorker único (sin pool propio, ADR-036 §1).
export type WorkerEntryKind = "pdf" | "ocr" | "ner" | "render" | "export";

export interface CoreRuntimeOptions {
  readonly workers?: Partial<Readonly<Record<WorkerEntryKind, WorkerFactory>>>;
}

export async function createCore(
  config?: Partial<EngineConfig>,
  runtime?: CoreRuntimeOptions
): Promise<IAnonymizationCore>;
```

---

## 4. Error codes y clases

```ts
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
}

export abstract class EngineError extends Error {
  abstract readonly code: EngineErrorCode;
  abstract readonly engineId: EngineId | "core";
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(message: string, retryable: boolean, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;
    this.details = Object.freeze({ ...(details ?? {}) });
  }

  serialize(): SerializedEngineError {
    return {
      code: this.code,
      engineId: this.engineId,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }

  // Reconstruye un EngineError genérico a partir de su forma serializada (cruza
  // el boundary de un Worker vía postMessage). Los motores concretos pueden
  // hacer su propio override para devolver su subclase específica.
  static deserialize(serialized: SerializedEngineError): EngineError {
    return new DeserializedEngineError(serialized);
  }
}

export interface SerializedEngineError {
  readonly code: EngineErrorCode;
  // "core": error de infraestructura compartida no atribuible a un motor
  // concreto (p. ej. ENGINE_NOT_INITIALIZED, INVALID_INPUT). Ver ADR-019.
  readonly engineId: EngineId | "core";
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}
```

Cada motor define sus subclases concretas en su `<engine>.errors.ts`. Toda subclase setea `code`, `engineId`, `retryable` y `details`. Los errores genéricos compartidos (`EngineNotInitializedError`, `EngineDisposedError`, `InvalidInputError`, `CancelledError`, definidos en `shared/src/errors.ts`) usan `engineId: "core"` porque no pertenecen a ningún motor.

---

## 5. Modelos de datos (replica de `03_Data_Model.md`)

Los tipos completos están en `03_Data_Model.md`. Aquí solo los enums referenciados en contratos.

```ts
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
}

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

export type WorkerJobType =
  | "pdf-parse"
  | "ocr-page"
  | "ner-page"
  | "render-page"
  | "export-page";
```

---

## 6. Configuración por motor

```ts
export interface WorkerPoolConfig {
  readonly pdfPoolSize: number;
  readonly ocrPoolSize: number;
  readonly nerPoolSize: number;
  readonly renderPoolSize: number;
  // Por pool: el default documentado (32 PDF/Render, 8 OCR/NER) no era
  // expresable con un escalar (ADR-034 §7).
  readonly maxQueuePerPool: Readonly<Record<"pdf" | "ocr" | "ner" | "render", number>>;
  readonly timeouts: Readonly<Record<WorkerJobType, number>>;
  readonly maxRetries: Readonly<Record<WorkerJobType, number>>;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly cancelSlaMs: number;
  readonly idleDisposeMs: number;
}

export interface PdfEngineConfig {
  readonly maxPageCount: number; // default 10000
}

export interface NerConfig {
  readonly modelId: string;
  readonly quantization: "q8" | "q4" | "f32";
  readonly confidenceThreshold: number;
  readonly batchSize: number;
  readonly enabled: boolean;
}

export interface OcrConfig {
  readonly languages: ReadonlyArray<string>;
  readonly dpi: number;
  // Timeout y retries por pagina: fuente unica workerPool.timeouts["ocr-page"] y
  // maxRetries["ocr-page"] (ADR-021 §2, precedente ADR-013).
}

export interface GroupingConfig {
  readonly similarityThreshold: number;
  readonly minAliasFrequency: number;
}

export interface RenderConfig {
  readonly previewScale: number;
  readonly fullScale: number;
  readonly jpegQuality: number;
  readonly cachePages: number; // PREVIEW_CACHE_PAGES, default 16
}

export interface ExportConfig {
  readonly defaultDpi: number;
  readonly defaultImageFormat: "png" | "jpeg";
  readonly defaultJpegQuality: number;
}
```

### Constantes nombradas (umbrales)

| Constante | Valor default | Dónde |
|---|---|---|
| `GROUPING_SIMILARITY_THRESHOLD` | `0.88` | `GroupingConfig.similarityThreshold` |
| `NER_CONFIDENCE_THRESHOLD` | `0.7` | `NerConfig.confidenceThreshold` |
| `CANCEL_SLA_MS` | `200` | `WorkerPoolConfig.cancelSlaMs` |
| `MAX_QUEUE_PER_POOL` | `{ pdf: 32, ocr: 8, ner: 8, render: 32 }` | `WorkerPoolConfig.maxQueuePerPool` (ADR-034 §7) |
| `PREVIEW_CACHE_PAGES` | `16` | `RenderConfig` |
| `WORDS_CACHE_PAGES` | `32` | `EngineConfig.cache` |
| `MAX_RENDER_SCALE` | `4` | Guard de `RenderRequested.scale`/`RenderPageInput.scale` (ADR-037 §2) |
| `PREVIEW_CACHE_MAX_BYTES` | `200 MB` | Límite por bytes del cache LRU de previews, además de `PREVIEW_CACHE_PAGES` (ADR-037 §3) |

---

## 7. Tipos de transporte binario (`Transferable`, `EncodedPageImage`)

Wrapper para `ArrayBuffer` que se transfiere (zero-copy) al cruzar boundary de worker. Solo se puede consumir una vez.

```ts
export interface Transferable<T extends ArrayBuffer | ImageData> {
  readonly buffer: T;
  consume(): T;   // lanza si ya fue consumido
}
```

Imagen de página codificada (PNG/JPEG), lista para `embedPng`/`embedJpg` de pdf-lib. Definida originalmente en `export-engine` (ADR-032 §1) y promovida a `@anonly/shared` al aparecer el segundo consumidor: Render la produce (`RenderPageOutput.encoded`), Export la consume (`RenderPageProvider.renderFull`), el Orchestrator la transporta (ADR-034 §3).

```ts
export interface EncodedPageImage {
  readonly bytes: ArrayBuffer;     // imagen codificada (PNG o JPEG)
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}
```

---

## 8. Tipos de payload de eventos (`EventPayloadMap`)

> **Nota técnica**: la forma canónica es **interfaces individuales exportadas + un type map (`EventPayloadMap`)**, no un `namespace`. Un `namespace EventPayloads` con indexed access (`EventPayloads.Foo` o `EventPayloads[E]`) importado con `import type` no es compatible con `verbatimModuleSyntax` (Code_Standards.md §2): el compilador no puede garantizar en runtime que el namespace exporta solo tipos. Interfaces top-level + type map logran el mismo resultado (un tipo por evento, indexable por `EngineEvents`) sin ese problema. El **contenido** de cada payload es idéntico al que tendría dentro del namespace; solo cambia el empaquetado.

```ts
// Pipeline
export interface DocumentImported { readonly documentId: string; readonly name: string; readonly sizeBytes: number; }
export interface PipelineStageChanged { readonly documentId: string; readonly stage: PipelineStage; readonly progress: number; }
export interface PipelineProgress { readonly documentId: string; readonly stage: PipelineStage; readonly current: number; readonly total: number; }
export interface PipelineReady { readonly documentId: string; readonly groupCount: number; readonly conflictCount: number; }
export interface PipelineCancelled { readonly documentId: string; readonly reason: string; }
export interface PipelineFailed { readonly documentId: string; readonly error: SerializedEngineError; }
export interface CancelRequested { readonly documentId: string; readonly jobId?: string; }

// PDF
export interface PageParsed { readonly documentId: string; readonly pageIndex: number; readonly wordCount: number; readonly requiresOCR: boolean; }
export interface DocumentParsed { readonly documentId: string; readonly pageCount: number; readonly textlessPages: ReadonlyArray<number>; readonly sourceKind: "text" | "scanned" | "mixed"; }
export interface PdfPasswordRequired { readonly documentId: string; }
export interface PdfInvalid { readonly documentId: string; readonly reason: string; }

// OCR
export interface OcrStarted { readonly documentId: string; readonly pagesToProcess: ReadonlyArray<number>; readonly modelLoading?: boolean; }
export interface OcrPageFinished { readonly documentId: string; readonly pageIndex: number; readonly wordCount: number; readonly confidence: number; }
export interface OcrFinished { readonly documentId: string; readonly durationMs: number; readonly modelDownloaded?: boolean; }
export interface OcrPageFailed { readonly documentId: string; readonly pageIndex: number; readonly error: SerializedEngineError; }

// Detectores
export interface EntityFound { readonly documentId: string; readonly occurrence: Occurrence; }
export interface RegexFinished { readonly documentId: string; readonly occurrenceCount: number; readonly durationMs: number; }
export interface NerStarted { readonly documentId: string; readonly pageCount: number; readonly modelId: string; readonly modelLoading?: boolean; }
export interface NerModelLoading { readonly modelId: string; readonly progress: number; }
export interface NerModelReady { readonly modelId: string; }
export interface NerPageFinished { readonly documentId: string; readonly pageIndex: number; readonly occurrenceCount: number; }
export interface NerFinished { readonly documentId: string; readonly occurrenceCount: number; readonly durationMs: number; }

// Grouping
export interface EntityGroupCreated { readonly documentId: string; readonly group: EntityGroup; }
export interface EntityGroupUpdated { readonly documentId: string; readonly group: EntityGroup; readonly changes: ReadonlyArray<keyof EntityGroup>; }
export interface EntityGroupRemoved { readonly documentId: string; readonly groupId: string; }
export interface GroupReplacementChanged { readonly documentId: string; readonly groupId: string; readonly mode: ReplacementMode; readonly value: string; }
export interface GroupToggled { readonly documentId: string; readonly groupId: string; readonly enabled: boolean; }
export interface ConflictDetected { readonly documentId: string; readonly conflict: Conflict; }
export interface ConflictResolved { readonly documentId: string; readonly conflictId: string; readonly mode: ReplacementMode; }
export interface GroupingFinished { readonly documentId: string; readonly groupCount: number; readonly conflictCount: number; readonly durationMs: number; }

// Render
export interface PreviewUpdated { readonly documentId: string; readonly pageIndex: number; readonly kind: "original" | "anonymized"; readonly canvasBlobUrl: string; }
export interface PreviewPageFailed { readonly documentId: string; readonly pageIndex: number; readonly error: SerializedEngineError; }
export interface RenderRequested {
  readonly documentId: string;
  readonly pageIndices: ReadonlyArray<number>;
  readonly mode: "preview" | "full";
  // ADR-037 §1: escala absoluta pdfjs (1.0 = 72 DPI), misma semántica que
  // RenderPageInput.scale (Render_Engine.md §6). Ausente → previewScale/fullScale
  // según mode. Rango válido: 0 < scale ≤ MAX_RENDER_SCALE.
  readonly scale?: number;
}
export interface RenderFinished { readonly documentId: string; readonly pageIndices: ReadonlyArray<number>; readonly durationMs: number; }
export interface RenderFailed { readonly documentId: string; readonly error: SerializedEngineError; }

// Export
export interface ExportRequested { readonly documentId: string; readonly options: ExportOptions; }
export interface ExportStarted { readonly documentId: string; }
export interface ExportProgress { readonly documentId: string; readonly current: number; readonly total: number; }
export interface ExportFinished { readonly documentId: string; readonly blobUrl: string; readonly sizeBytes: number; readonly durationMs: number; }
export interface ExportFailed { readonly documentId: string; readonly error: SerializedEngineError; }

// Workers
export interface WorkerJobDispatched { readonly jobId: string; readonly workerId: string; readonly type: WorkerJobType; }
export interface WorkerJobCompleted { readonly jobId: string; readonly result: unknown; }
export interface WorkerJobFailed { readonly jobId: string; readonly error: SerializedEngineError; }
export interface WorkerJobCancelled { readonly jobId: string; readonly signalId: string; }
export interface WorkerJobTimeout { readonly jobId: string; readonly timeoutMs: number; }
export interface WorkerPoolSaturated { readonly type: WorkerJobType; readonly queueLength: number; }

// UI inputs
export interface GroupUpdateRequested {
  readonly documentId: string;
  readonly groupId: string;
  readonly patch: Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">>;
}
export interface GroupMergeRequested { readonly documentId: string; readonly sourceGroupId: string; readonly targetGroupId: string; }
export interface GroupSplitRequested { readonly documentId: string; readonly groupId: string; readonly occurrenceIds: ReadonlyArray<string>; }
export interface RuleCreated { readonly documentId: string; readonly rule: Rule; }
export interface RuleUpdated { readonly documentId: string; readonly ruleId: string; readonly patch: Partial<Rule>; }
export interface RuleDeleted { readonly documentId: string; readonly ruleId: string; }
export interface ConflictResolveRequested { readonly documentId: string; readonly conflictId: string; readonly mode: ReplacementMode; }
export interface DocumentClosed { readonly documentId: string; }

// Type map: EngineEvents → payload type. Reemplaza al namespace EventPayloads;
// permite EventPayloadMap[E] en IEventBus (§3.2) siendo compatible con
// verbatimModuleSyntax + import type.
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
```

> Los tipos `Occurrence`, `EntityGroup`, `Conflict`, `Rule`, `ExportOptions`, etc. están definidos en `03_Data_Model.md`. Estas interfaces los referencian sin redefinirlos.

### 8.1 `PipelineError`

Referenciado por `PipelineState.errors` (`03_Data_Model.md` §17):

```ts
export interface PipelineError {
  readonly stage: PipelineStage;
  readonly code: string;
  readonly message: string;
  readonly documentId: string;
}
```

---

## 9. Glosario

| Término | Significado |
|---|---|
| **Core** | `packages/anonymization-core`, todo el código de anonimización. |
| **Cliente** | App que consume el Core (MVP: `apps/react-client`). |
| **Motor / Engine** | Paquete del Core que implementa una etapa del pipeline. |
| **Orchestrator** | Componente del host que secuencia etapas y dispatcha jobs a pools. |
| **Pool** | Conjunto de Web Workers del mismo tipo, con cola prioritaria. |
| **Job** | Unidad de trabajo enviado a un Worker. |
| **Grupo / EntityGroup** | Unidad central de UI y reemplazo. Agrupa ocurrencias del mismo valor. |
| **Ocurrencia / Occurrence** | Detección cruda (interna, no expuesta a la UI). |
| **Placeholder** | Modo de reemplazo `[<TYPE> <NN>]`. |
| **Modo de reemplazo** | `mask \| synthetic \| placeholder \| redact`. |
| **Sanitización** | Proceso de limpiar metadata sensible y reconstruir el PDF. |
| **CANAL** | Subscripción del bus (`pipeline`, `ui`, `pdf`, etc.). |
| **Transferable** | Buffer que se transfiere zero-copy al worker. |
| **Snapshot** | Imagen renderizada de una página (original o anonimizada). |
| **First paint** | Tiempo hasta ver la primera página renderizada. |
| **Ready** | Estado del pipeline cuando grouping terminó y el usuario puede editar. |

---

## 10. Reglas para nuevos tipos

1. Todo tipo público se agrega primero aquí (en `Contracts.md` y en `shared/src/types.ts`).
2. Todo `EngineErrorCode` nuevo se agrega al enum aquí y al spec del motor.
3. Todo `EngineEvents` nuevo se agrega al enum aquí, a su interfaz de payload y al `EventPayloadMap`, y a `04_Event_System.md`.
4. Ningún tipo puede referenciar tipos de librerías externas (pdfjs, tesseract, onnx). Se definen wrappers propios.
5. Todo tipo es inmutable (`readonly`, `ReadonlyArray`).

---

## 11. Referencias

- `03_Data_Model.md` — definiciones semánticas de los modelos.
- `04_Event_System.md` — tabla exhaustiva de eventos.
- `ai/Module_Specification_Template.md` — cómo se usa este archivo desde un spec.
- `ai/Code_Standards.md` — reglas de TS estricto.
