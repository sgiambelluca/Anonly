/**
 * @anonly/shared — Interfaces base del Core.
 *
 * Fuente de verdad: docs/core/Contracts.md §3.
 * Todo motor implementa IEngine. El bus implementa IEventBus.
 * El logger y cache se inyectan vía EngineContext.
 */

import type { EngineId, EngineEvents, WorkerJobType } from "./enums.js";
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

export interface EngineConfig {
  readonly workerPool: WorkerPoolConfig;
  readonly ner: NerConfig;
  readonly ocr: OcrConfig;
  readonly grouping: GroupingConfig;
  readonly render: RenderConfig;
  readonly export: ExportConfig;
}

export interface IEventBus {
  on<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe;
  once<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe;
  off<E extends EngineEvents>(channel: EventChannelLike, event: E, handler: EventHandler<E>): void;
  emit<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    payload: EventPayloadMap[E],
  ): void;
  emitAsync<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    payload: EventPayloadMap[E],
  ): Promise<void>;
}

/**
 * Alias de canal como string para evitar import circular con enums.ts en algunos bundlers.
 * El valor concreto está en enums.ts como EventChannel.
 */
export type EventChannelLike = string;

export type EventHandler<E extends EngineEvents> = (payload: EventPayloadMap[E]) => void;

/**
 * Niveles de log como string literal union.
 * El enum `LogLevel` de enums.ts es para uso runtime; este type es para tipos.
 */
export type LogLevelString = "debug" | "info" | "warn" | "error";

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
  readonly cachePages: number;
}

export interface ExportConfig {
  readonly defaultDpi: number;
  readonly defaultImageFormat: "png" | "jpeg";
  readonly defaultJpegQuality: number;
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

export interface WorkerInbound {
  readonly type: "RUN" | "CANCEL" | "INIT" | "DISPOSE";
  readonly jobId?: string;
  readonly signalId?: string;
  readonly jobType?: WorkerJobType;
  readonly payload?: unknown;
  readonly config?: unknown;
}

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
  | {
      readonly type: "COMPLETED";
      readonly jobId: string;
      readonly result: Serializable;
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
      readonly level: LogLevelString;
      readonly message: string;
      readonly meta?: Serializable;
    };
