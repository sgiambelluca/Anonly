/**
 * @anonly/shared — Interfaces base del Core.
 *
 * Fuente de verdad: docs/core/Contracts.md §3.
 * Todo motor implementa IEngine. El bus implementa IEventBus.
 * El logger y cache se inyectan vía EngineContext.
 */

import type { EngineId, EngineEvents, EventChannel, WorkerJobType } from "./enums.js";
import type { SerializedEngineError } from "./errors.js";
import type { EventPayloadMap } from "./events.js";
import type { Transferable } from "./transferable.js";
import type { WorkerCapabilities } from "./types.js";

export type Unsubscribe = () => void;

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

export interface PdfEngineConfig {
  readonly maxPageCount: number;
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

// Overrides parciales de dos niveles (ADR-039): cada sección de EngineConfig
// admite un subconjunto de campos; lo ausente cae a los defaults de
// buildDefaultEngineConfig. El merge por sub-objeto ya era la semántica de
// runtime de mergeEngineConfig; este tipo la expone (antes:
// Partial<EngineConfig>, shallow — exigía secciones completas).
export type EngineConfigOverrides = {
  readonly [K in keyof EngineConfig]?: Partial<EngineConfig[K]>;
};

export interface IEventBus {
  on<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe;
  once<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe;
  off<E extends EngineEvents>(channel: EventChannel, event: E, handler: EventHandler<E>): void;
  emit<E extends EngineEvents>(channel: EventChannel, event: E, payload: EventPayloadMap[E]): void;
  emitAsync<E extends EngineEvents>(
    channel: EventChannel,
    event: E,
    payload: EventPayloadMap[E],
  ): Promise<void>;
}

export type EventHandler<E extends EngineEvents> = (payload: EventPayloadMap[E]) => void;

/**
 * Niveles de log. Única forma: union type (no enum). Ver docs/adr/ADR-019-Hito1-Hardening.md.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ILogger {
  debug(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  info(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, meta?: Readonly<Record<string, unknown>>): void;
  error(msg: string, meta?: Readonly<Record<string, unknown>>): void;
}

export interface ICache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, bytes?: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
}

export interface WorkerPoolConfig {
  readonly pdfPoolSize: number;
  readonly ocrPoolSize: number;
  readonly nerPoolSize: number;
  readonly renderPoolSize: number;
  // Por pool (ADR-034 §7): el default documentado (32 PDF/Render, 8 OCR/NER)
  // no era expresable con un escalar.
  readonly maxQueuePerPool: Readonly<Record<"pdf" | "ocr" | "ner" | "render", number>>;
  readonly timeouts: Readonly<Record<WorkerJobType, number>>;
  readonly maxRetries: Readonly<Record<WorkerJobType, number>>;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly cancelSlaMs: number;
  readonly idleDisposeMs: number;
}

// Rutas del runtime WASM de onnxruntime-web, inyectadas por el host (la app,
// única capa con bundler — ADR-036 §2, ADR-039). Solo strings (serializable:
// EngineConfig viaja al worker en INIT). Forma objeto: URLs explícitas por
// archivo (necesario con bundlers que hashean nombres); forma string: prefijo
// de directorio. Ausente → el motor usa su default "/wasm/onnxruntime/".
export interface NerWasmPaths {
  readonly wasm?: string;
  readonly mjs?: string;
}

export interface NerConfig {
  readonly modelId: string;
  readonly quantization: "q8" | "q4" | "f32";
  readonly confidenceThreshold: number;
  readonly batchSize: number;
  readonly enabled: boolean;
  readonly wasmPaths?: string | NerWasmPaths; // ADR-039
}

export interface OcrConfig {
  readonly languages: ReadonlyArray<string>;
  readonly dpi: number;
  // Timeout y retries por página: fuente única workerPool.timeouts["ocr-page"] y
  // maxRetries["ocr-page"] (ADR-021 §2, precedente ADR-013).
}

/**
 * Re-análisis parcial preservando ediciones (Hito 10, ADR-038 §1). Cubre
 * exactamente los dos settings de UI que afectan detección
 * (`ui/React_Client.md` §3.6/§3.7): ampliar el patch (p. ej. otros campos de
 * `NerConfig`) requiere ADR nuevo. La inmutabilidad de `EngineConfig` por
 * sesión (nota de §3.1 de `Contracts.md`) se relaja únicamente por esta vía:
 * el Orchestrator mantiene una config efectiva por documento que
 * `IPipelineOrchestrator.reanalyze` actualiza mergeando este patch.
 */
export interface ReanalyzeConfigPatch {
  readonly ner?: { readonly enabled: boolean };
  readonly ocr?: { readonly languages: ReadonlyArray<string> };
}

export interface GroupingConfig {
  readonly similarityThreshold: number;
  readonly minAliasFrequency: number;
}

export interface RenderConfig {
  readonly previewScale: number;
  readonly fullScale: number;
  readonly jpegQuality: number;
  readonly cachePages: number;
}

export interface ExportConfig {
  readonly defaultDpi: number;
  readonly defaultImageFormat: "png" | "jpeg";
  readonly defaultJpegQuality: number;
}

// ─── Transporte de Web Workers reales (Hito 10, ADR-036 §2, Contracts.md §3.5) ───
//
// Los `Worker` de SO los crea la app (única con bundler: Vite resuelve
// `import X from "@anonly/<engine>/worker?worker"`) y los inyecta acá como
// factories. Sin factory para un kind, ese despacho queda in-process
// (comportamiento del Hito 9, ADR-035 §1) — la migración es motor por motor y
// los tests del Core siguen corriendo en node sin `Worker`. Las factories van
// en un parámetro aparte de `createCore` y NO dentro de `EngineConfig`:
// `EngineConfig` viaja serializado al worker en INIT y las funciones no son
// structured-cloneables.

/**
 * `WorkerLike` es estructural a propósito: un `Worker` real de DOM lo
 * satisface (misma forma), y los tests del transporte pueden inyectar fakes
 * con la misma forma sin necesitar un `Worker` de browser (ADR-036 §2).
 */
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

// ─── Tipos de mensajería worker (ver 05_Worker_Architecture.md §2) ───

export type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<Serializable>
  | { readonly [key: string]: Serializable };

export type WorkerInbound =
  | { readonly type: "INIT"; readonly config: unknown }
  | {
      readonly type: "RUN";
      readonly jobId: string;
      readonly signalId: string;
      readonly jobType: WorkerJobType;
      readonly payload: unknown;
    }
  | { readonly type: "CANCEL"; readonly jobId: string; readonly signalId: string }
  | { readonly type: "DISPOSE" };

export type WorkerOutbound =
  | {
      readonly type: "READY";
      readonly workerId: string;
      readonly capabilities: WorkerCapabilities;
    }
  | {
      readonly type: "PROGRESS";
      readonly jobId: string;
      readonly progress: number;
      readonly partial?: Serializable;
    }
  // ADR-042: `result` es `unknown` a nivel de transporte — mismo criterio que
  // `INIT.config`/`RUN.payload` (ADR-019) y `EVENT.payload` (ADR-036 §3). Los
  // `*EngineOutput` de cada motor son `interface`s (como todos los tipos de
  // dominio del Core), que TypeScript no asigna a un tipo con index signature
  // (`Serializable`) aunque todos sus campos sean datos planos compatibles
  // (microsoft/TypeScript#15300) — recursivo, no se resuelve tocando un tipo.
  // El host-bridge de cada motor afina `result` a su `*EngineOutput` esperado
  // al consumirlo (mismo patrón que `RUN.payload` en el entry-point).
  | {
      readonly type: "COMPLETED";
      readonly jobId: string;
      readonly result: unknown;
      readonly transferred?: ReadonlyArray<Transferable>;
    }
  | {
      readonly type: "FAILED";
      readonly jobId: string;
      readonly error: SerializedEngineError;
    }
  | {
      readonly type: "CANCELLED";
      readonly jobId: string;
      readonly signalId: string;
    }
  | {
      readonly type: "LOG";
      readonly level: LogLevel;
      readonly message: string;
      readonly meta?: Serializable;
    }
  // ADR-036 §3: el entry-point de cada motor corre el motor real con un bus
  // puente; cada `emit` viaja como EVENT y el host-bridge del motor lo afina
  // y re-emite en el bus real (los eventos observables se emiten siempre en
  // host, ADR-013 §6). `payload` es `unknown` a nivel de transporte, igual
  // criterio que `INIT.config`/`RUN.payload` (ADR-019).
  | {
      readonly type: "EVENT";
      readonly channel: EventChannel;
      readonly event: EngineEvents;
      readonly payload: unknown;
    };
