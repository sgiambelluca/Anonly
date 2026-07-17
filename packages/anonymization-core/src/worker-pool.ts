/**
 * `WorkerPool` + `WorkerPoolManager` (`05_Worker_Architecture.md`).
 *
 * Decisión de diseño acotada por el scope de este PR (documentada en el
 * reporte final, no una elección de arquitectura libre): un `PdfPool`/
 * `OcrPool`/`NerPool`/`RenderPool` con Web Workers de SO reales requiere
 * archivos de entry-point de worker que importen `pdfjs-dist`/`tesseract.js`/
 * `@huggingface/transformers` **dentro de cada paquete de motor**
 * (`pdf-engine/`, `ocr-engine/`, `ner-engine/`) — el propio ADR-013 §6 pide
 * aislar la función pura `parsePage` "para que Hito 9 la envuelva en un job
 * del worker sin modificarla", es decir, un archivo de worker nuevo dentro de
 * `pdf-engine/`. Esta tarea autoriza explícitamente tocar solo `shared`,
 * `render-engine` y `export-engine` (ADR-034) — ningún otro motor. Además, el
 * entorno de test del Core es `environment: "node"` (`vitest.config.ts`), sin
 * `Worker`/`OffscreenCanvas` de browser reales ni bundler propio del Core
 * (`Code_Standards.md` §1: "El Core no usa bundler") para resolver
 * `new Worker(new URL(...))`.
 *
 * Por eso estos pools son colas de concurrencia limitada **in-process**: no
 * generan hilos de SO reales, pero sí aportan — de forma genuina y testeable —
 * la semántica documentada en `05_Worker_Architecture.md`: cola prioritaria,
 * límite de concurrencia por pool, backpressure (`WORKER_POOL_SATURATED`),
 * reintentos con backoff exponencial (solo para errores `retryable`) y
 * traducción a los eventos `WORKER_*`. Cada pool despacha llamando
 * directamente a los métodos públicos ya existentes de cada motor
 * (`PdfEngine.process`, `OcrEngine.processPage`, `NerEngine.processPage`,
 * `RenderEngine.renderPage`/`rasterizePage`) sin cambiar su interfaz pública
 * (ADR-013/ADR-021: "sin cambio de interfaz pública"). El timeout por-página
 * ya lo aplican los propios motores con `ctx.config.workerPool.timeouts[...]`
 * (p. ej. `parsePageTextWithTimeout` en pdf-engine, `recognizeWithTimeout` en
 * ocr-engine): este pool no duplica esa carrera, solo decide si reintenta.
 */

import {
  CancelledError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EventChannel,
  type IEventBus,
  type ILogger,
  type SerializedEngineError,
  type WorkerJobType,
} from "@anonly/shared";

export type PoolKey = "pdf" | "ocr" | "ner" | "render";

export interface WorkerPoolOptions {
  readonly poolKey: PoolKey;
  readonly jobType: WorkerJobType;
  readonly size: number;
  readonly maxQueue: number;
  readonly maxRetries: number;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly bus: IEventBus;
  readonly logger: ILogger;
}

export interface DispatchParams<TResult> {
  readonly run: () => Promise<TResult>;
  readonly signal: AbortSignal;
  /** Mayor primero; FIFO dentro de la misma prioridad (05_Worker_Architecture.md §6.1). */
  readonly priority?: number;
  /** Reintentos propios de este dispatch (por defecto, el `maxRetries` del pool). */
  readonly maxRetriesOverride?: number;
  /**
   * Override del criterio de reintento (por defecto, `err.retryable`). Caso
   * de uso real: `05_Worker_Architecture.md` §5 documenta `PDF_PASSWORD_REQUIRED`
   * como no-retryable, pero `PdfPasswordRequiredError` (pdf-engine, fuera del
   * alcance de este PR) lo marca `retryable: true` — inconsistencia real
   * detectada en este hito (ver reporte final); el dispatch de `pdf-parse`
   * pasa un override acá en vez de reintentar en vano contra la misma
   * contraseña faltante.
   */
  readonly isRetryable?: (err: unknown) => boolean;
}

interface QueueEntry {
  readonly jobId: string;
  readonly priority: number;
  readonly createdAt: number;
  readonly execute: () => Promise<void>;
}

let jobCounter = 0;
function nextJobId(jobType: string): string {
  jobCounter += 1;
  return `${jobType}-${jobCounter}-${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  return err instanceof EngineError && err.retryable;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof EngineError && err.code.endsWith("_TIMEOUT");
}

function toSerializedError(err: unknown): SerializedEngineError {
  if (err instanceof EngineError) return err.serialize();
  // Defensivo: todo método público de un motor está contractualmente
  // obligado a lanzar una subclase de EngineError (Code_Standards.md §7); esta
  // rama no debería alcanzarse en producción. Se clasifica como INVALID_INPUT
  // (sin inventar un EngineErrorCode nuevo, I-4) solo para no perder el
  // mensaje en el evento de telemetría WORKER_JOB_FAILED — el error real
  // igual se re-lanza tal cual al caller de `dispatch()`.
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: EngineErrorCode.INVALID_INPUT,
    engineId: "core",
    message,
    retryable: false,
    details: {},
  };
}

export class WorkerPool {
  private readonly options: WorkerPoolOptions;
  private active = 0;
  private readonly queue: QueueEntry[] = [];
  private disposed = false;

  constructor(options: WorkerPoolOptions) {
    this.options = options;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.active;
  }

  get isSaturated(): boolean {
    return this.queue.length > this.options.maxQueue;
  }

  /** Backpressure (05_Worker_Architecture.md §6.3): espera hasta que la cola baje del 50%. */
  async waitForCapacity(): Promise<void> {
    if (!this.isSaturated) return;
    const half = this.options.maxQueue / 2;
    while (this.queue.length > half && !this.disposed) {
      await sleep(10);
    }
  }

  dispatch<TResult>(params: DispatchParams<TResult>): Promise<TResult> {
    const jobId = nextJobId(this.options.jobType);
    if (this.disposed) {
      // El pool ya fue dispuesto (idle-dispose o dispose() global): se trata
      // como cancelación, no como error de programación — un pool inactivo
      // disponiéndose es un flujo normal (05_Worker_Architecture.md §8).
      return Promise.reject(new CancelledError(jobId));
    }

    return new Promise<TResult>((resolve, reject) => {
      if (params.signal.aborted) {
        reject(new CancelledError(jobId));
        return;
      }

      const entry: QueueEntry = {
        jobId,
        priority: params.priority ?? 50,
        createdAt: Date.now(),
        execute: async (): Promise<void> => {
          try {
            const result = await this.runWithRetry(jobId, params);
            resolve(result);
          } catch (err: unknown) {
            // Mismo patrón que PdfEngine.fuseOcrPage (pdf-engine/src/pdf.engine.ts):
            // reject() espera un Error; `err` es `unknown` por contrato de captura.
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
      };

      const onAbort = (): void => {
        const idx = this.queue.findIndex((e) => e.jobId === jobId);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          reject(new CancelledError(jobId));
        }
        // Si ya no está en cola (en ejecución), la propia llamada al motor
        // observa `ctx.abortSignal` en sus checkpoints internos y rechaza con
        // CancelledError por su cuenta (mismo patrón que todos los motores).
      };
      params.signal.addEventListener("abort", onAbort, { once: true });

      this.enqueue(entry);
    });
  }

  /** Rechaza todos los jobs en cola (no los que ya están corriendo) y marca el pool como dispuesto. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  private enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
    this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    if (this.queue.length > this.options.maxQueue) {
      this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_POOL_SATURATED, {
        type: this.options.jobType,
        queueLength: this.queue.length,
      });
    }
    this.pump();
  }

  private pump(): void {
    while (this.active < this.options.size && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry === undefined) break;
      this.active += 1;
      void entry.execute().finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async runWithRetry<TResult>(
    jobId: string,
    params: DispatchParams<TResult>,
  ): Promise<TResult> {
    const maxRetries = params.maxRetriesOverride ?? this.options.maxRetries;
    let attempt = 0;
    let lastError: unknown;

    this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_DISPATCHED, {
      jobId,
      workerId: `${this.options.poolKey}-pool`,
      type: this.options.jobType,
    });

    while (attempt <= maxRetries) {
      if (params.signal.aborted) {
        this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_CANCELLED, {
          jobId,
          signalId: jobId,
        });
        throw new CancelledError(jobId);
      }

      try {
        const result = await params.run();
        this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_COMPLETED, {
          jobId,
          result: null,
        });
        return result;
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = err;

        if (isTimeoutError(err)) {
          this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_TIMEOUT, {
            jobId,
            timeoutMs: 0, // el timeout real ya lo aplicó el motor; no duplicado acá.
          });
        }

        const retryPredicate = params.isRetryable ?? isRetryable;
        const canRetry = attempt < maxRetries && retryPredicate(err);
        if (!canRetry) break;

        const delay = Math.min(
          this.options.baseRetryDelayMs * 2 ** attempt,
          this.options.maxRetryDelayMs,
        );
        await sleep(delay);
        attempt += 1;
      }
    }

    this.options.bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_FAILED, {
      jobId,
      error: toSerializedError(lastError),
    });
    throw lastError;
  }
}

export interface WorkerPoolManagerOptions {
  readonly bus: IEventBus;
  readonly logger: ILogger;
  readonly getPoolSize: (key: PoolKey) => number;
  readonly getMaxQueue: (key: PoolKey) => number;
  readonly getMaxRetries: (jobType: WorkerJobType) => number;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly idleDisposeMs: number;
}

const JOB_TYPE_BY_POOL: Readonly<Record<PoolKey, WorkerJobType>> = {
  pdf: "pdf-parse",
  ocr: "ocr-page",
  ner: "ner-page",
  render: "render-page",
};

/**
 * Gestiona los cuatro pools con creación perezosa (`05_Worker_Architecture.md`
 * §8) y disposición tras `idleDisposeMs` de inactividad.
 */
export class WorkerPoolManager {
  private readonly options: WorkerPoolManagerOptions;
  private readonly pools = new Map<PoolKey, WorkerPool>();
  private readonly idleTimers = new Map<PoolKey, ReturnType<typeof setTimeout>>();

  constructor(options: WorkerPoolManagerOptions) {
    this.options = options;
  }

  getPool(key: PoolKey): WorkerPool {
    this.touch(key);
    const existing = this.pools.get(key);
    if (existing !== undefined) return existing;

    const jobType = JOB_TYPE_BY_POOL[key];
    const pool = new WorkerPool({
      poolKey: key,
      jobType,
      size: this.options.getPoolSize(key),
      maxQueue: this.options.getMaxQueue(key),
      maxRetries: this.options.getMaxRetries(jobType),
      baseRetryDelayMs: this.options.baseRetryDelayMs,
      maxRetryDelayMs: this.options.maxRetryDelayMs,
      bus: this.options.bus,
      logger: this.options.logger,
    });
    this.pools.set(key, pool);
    return pool;
  }

  /** Reinicia el temporizador de disposición-por-inactividad de `key`. */
  private touch(key: PoolKey): void {
    const existingTimer = this.idleTimers.get(key);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.pools.get(key)?.dispose();
      this.pools.delete(key);
      this.idleTimers.delete(key);
    }, this.options.idleDisposeMs);
    this.idleTimers.set(key, timer);
  }

  disposeAll(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
  }
}
