<!-- CONTEXT: scope=contratos-base | dependencias=03_Data_Model.md,04_Event_System.md | audiencia=IA-implementador | fase=3 -->

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
  readonly ner: NerConfig;
  readonly ocr: OcrConfig;
  readonly grouping: GroupingConfig;
  readonly render: RenderConfig;
  readonly export: ExportConfig;
}
```

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
    payload: EventPayloads[E]
  ): void;
  emitAsync<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    payload: EventPayloads[E]
  ): Promise<void>;
}

export type EventHandler<E extends EngineEvents> = (payload: EventPayloads[E]) => void;
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
  abstract readonly engineId: EngineId;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(message: string, retryable: boolean, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;
    this.details = Object.freeze({ ...(details ?? {}) });
  }
}

export interface SerializedEngineError {
  readonly code: EngineErrorCode;
  readonly engineId: EngineId;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}
```

Cada motor define sus subclases concretas en su `<engine>.errors.ts`. Toda subclase setea `code`, `engineId`, `retryable` y `details`.

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
  readonly maxQueuePerPool: number;
  readonly timeouts: Readonly<Record<WorkerJobType, number>>;
  readonly maxRetries: Readonly<Record<WorkerJobType, number>>;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly cancelSlaMs: number;
  readonly idleDisposeMs: number;
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
  readonly pageTimeoutMs: number;
}

export interface GroupingConfig {
  readonly similarityThreshold: number;
  readonly minAliasFrequency: number;
}

export interface RenderConfig {
  readonly previewScale: number;
  readonly fullScale: number;
  readonly jpegQuality: number;
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
| `MAX_QUEUE_PER_POOL` | `32` (PDF/Render), `8` (OCR/NER) | `WorkerPoolConfig.maxQueuePerPool` |
| `PREVIEW_CACHE_PAGES` | `16` | `RenderConfig` |
| `WORDS_CACHE_PAGES` | `32` | `EngineConfig.cache` |

---

## 7. Tipos de `Transferable`

Wrapper para `ArrayBuffer` que se transfiere (zero-copy) al cruzar boundary de worker. Solo se puede consumir una vez.

```ts
export interface Transferable<T extends ArrayBuffer | ImageData> {
  readonly buffer: T;
  consume(): T;   // lanza si ya fue consumido
}
```

---

## 8. Tipos de payload de eventos (`EventPayloads`)

```ts
export namespace EventPayloads {
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
  export interface OcrStarted { readonly documentId: string; readonly pagesToProcess: ReadonlyArray<number>; }
  export interface OcrPageFinished { readonly documentId: string; readonly pageIndex: number; readonly wordCount: number; readonly confidence: number; }
  export interface OcrFinished { readonly documentId: string; readonly durationMs: number; }
  export interface OcrPageFailed { readonly documentId: string; readonly pageIndex: number; readonly error: SerializedEngineError; }

  // Detectores
  export interface EntityFound { readonly documentId: string; readonly occurrence: Occurrence; }
  export interface RegexFinished { readonly documentId: string; readonly occurrenceCount: number; readonly durationMs: number; }
  export interface NerStarted { readonly documentId: string; readonly pageCount: number; readonly modelId: string; }
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
  export interface PreviewUpdated { readonly documentId: string; readonly pageIndex: number; readonly canvasBlobUrl: string; }
  export interface PreviewPageFailed { readonly documentId: string; readonly pageIndex: number; readonly error: SerializedEngineError; }
  export interface RenderRequested { readonly documentId: string; readonly pageIndices: ReadonlyArray<number>; readonly mode: "preview" | "full"; }
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
}
```

> Los tipos `Occurrence`, `EntityGroup`, `Conflict`, `Rule`, `ExportOptions`, etc. están definidos en `03_Data_Model.md`. Este namespace los referencia sin redefinirlos.

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
3. Todo `EngineEvents` nuevo se agrega al enum aquí, al `EventPayloads` namespace, y a `04_Event_System.md`.
4. Ningún tipo puede referenciar tipos de librerías externas (pdfjs, tesseract, onnx). Se definen wrappers propios.
5. Todo tipo es inmutable (`readonly`, `ReadonlyArray`).

---

## 11. Referencias

- `03_Data_Model.md` — definiciones semánticas de los modelos.
- `04_Event_System.md` — tabla exhaustiva de eventos.
- `ai/Module_Specification_Template.md` — cómo se usa este archivo desde un spec.
- `ai/Code_Standards.md` — reglas de TS estricto.
