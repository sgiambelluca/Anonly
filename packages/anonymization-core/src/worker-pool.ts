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
  WorkerCrashedError,
  type EventPayloadMap,
  type IEventBus,
  type ILogger,
  type Serializable,
  type SerializedEngineError,
  type WorkerFactory,
  type WorkerInbound,
  type WorkerJobType,
  type WorkerLike,
  type WorkerOutbound,
} from "@anonly/shared";

// "export" (ADR-047 §2): identificador interno del `WorkerPool` de size 1
// que transporta el ExportWorker — su único uso observable es el string
// `${poolKey}-pool` del `workerId` en la telemetría `WORKER_JOB_*`. NO es un
// pool en el sentido de `05_Worker_Architecture.md` §1.1 (sin cola
// prioritaria multi-worker, sin clave propia en `WorkerPoolConfig`): por eso
// `WorkerPoolManager` (que sí gestiona los cuatro pools "de verdad", con
// creación perezosa y disposición por idle) lo excluye vía `ManagedPoolKey`.
export type PoolKey = "pdf" | "ocr" | "ner" | "render" | "export";

// Unión de los cuatro pools que gestiona `WorkerPoolManager` (creación
// perezosa, disposición por idle). Excluye "export": ese `WorkerPool` lo
// construye e inyecta `create-core.ts` directo al `ExportEngine` (ADR-047
// §2, espejo de `ocrPool`/`nerPool`), sin pasar por el manager.
export type ManagedPoolKey = Exclude<PoolKey, "export">;

const WORKER_OUTBOUND_TYPES: ReadonlySet<string> = new Set([
  "READY",
  "PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "LOG",
  "EVENT",
]);

/** `addEventListener("message", ...)` puede recibir un `MessageEvent` real (DOM, `.data` envuelve el mensaje) o el mensaje directo (fakes de test, ADR-036 §2). */
function hasDataProperty(value: unknown): value is { readonly data: unknown } {
  return typeof value === "object" && value !== null && "data" in value;
}

function isWorkerOutboundShape(value: unknown): value is WorkerOutbound {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { readonly type: unknown }).type;
  return typeof type === "string" && WORKER_OUTBOUND_TYPES.has(type);
}

/** Normaliza la entrega de un mensaje de worker (real o fake) a su `WorkerOutbound` tipado. */
function extractWorkerOutbound(ev: unknown): WorkerOutbound | undefined {
  const candidate = hasDataProperty(ev) ? ev.data : ev;
  return isWorkerOutboundShape(candidate) ? candidate : undefined;
}

interface PendingRemoteJob {
  readonly slotIndex: number;
  /**
   * `true` para los envíos de `broadcast()` (los controles `load-document`/
   * `unload-document` de `05_Worker_Architecture.md` §7.4, que van "directo
   * a cada worker, **sin cola**"). No consumen un slot de concurrencia —
   * apuntan a un worker que ya existe, no piden uno libre —, así que
   * `assignRemoteSlot()` no los cuenta: contarlos hacía que cualquier
   * `dispatch()` concurrente con un re-priming (ADR-043 §5) muriera con el
   * error de invariante, y ese error no es reintentable (`InvalidInputError`,
   * `retryable: false`) — la página quedaba sin `PREVIEW_UPDATED` para
   * siempre.
   */
  readonly isBroadcast?: boolean;
  readonly resolve: (result: unknown) => void;
  readonly reject: (err: unknown) => void;
  /**
   * Ciclo de vida del modelo NER reportado por un worker remoto (ADR-046
   * §4, primer consumidor de `PROGRESS`): enrutado por `jobId` desde
   * `handleWorkerMessage`. Ausente para jobs que no lo necesitan (pdf/ocr/
   * render) — no se llama nunca en ese caso.
   */
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

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
  /**
   * Factory de `Worker` real inyectada vía `CoreRuntimeOptions.workers`
   * (ADR-036 §2, Contracts.md §3.5). Si está presente Y el `dispatch()` de un
   * job trae `payload`, ese job se despacha por `postMessage` a una instancia
   * real (una por slot de concurrencia, creada perezosamente — ver
   * `workerForSlot`) en vez de invocar `run()` in-process. Ausente => el pool
   * es 100% in-process, comportamiento idéntico al Hito 9 (ADR-035 §1).
   */
  readonly workerFactory?: WorkerFactory;
  /**
   * Re-priming (ADR-043 §5): invocado y esperado (`await`) por
   * `workerForSlot` inmediatamente después de crear un worker real nuevo —
   * ANTES de que ese worker reciba cualquier job — para que el motor dueño
   * de este pool pueda re-enviarle su propio estado retenido (en `RenderPool`:
   * `load-document` de todos los documentos vigentes vía `broadcast`, ver
   * `RenderEngine#reprimeWorkers`). Sin uso fuera de `RenderPool`: los demás
   * pools (pdf/ocr/ner) no tienen estado por documento que re-primear.
   */
  readonly onWorkerCreated?: () => Promise<void>;
  /**
   * Liberación por inactividad (ADR-080, `05_Worker_Architecture.md` §8.1).
   * Tras este tiempo sin trabajo, el pool termina sus `WorkerLike` vivos y
   * **sigue usable**: el próximo `dispatch` reconstruye el worker por el
   * camino perezoso de `workerForSlot` (y lo re-primea con
   * `onWorkerCreated`, si lo hay).
   *
   * Ausente o `0` desactiva el mecanismo — lo que usan los tests, que no
   * pueden depender de temporizadores reales. El valor de producción sale
   * de `WorkerPoolConfig.idleDisposeMs` (default 60 s, `Contracts.md` §6),
   * que hasta ADR-080 solo consumía `WorkerPoolManager` — o sea que los
   * cuatro pools que `create-core.ts` construye desde ADR-043/045/046/047
   * retenían sus workers (incluidos los ~178 MB del modelo NER) hasta
   * cerrar la pestaña.
   */
  readonly idleDisposeMs?: number;
}

export interface DispatchParams<TResult> {
  readonly run: () => Promise<TResult>;
  readonly signal: AbortSignal;
  /** Mayor primero; FIFO dentro de la misma prioridad (05_Worker_Architecture.md §6.1). */
  readonly priority?: number;
  /** Reintentos propios de este dispatch (por defecto, el `maxRetries` del pool). */
  readonly maxRetriesOverride?: number;
  /**
   * Payload serializable para despacho remoto (ADR-036 §2/§3): si el pool
   * tiene `workerFactory` configurada Y este campo está presente, el job se
   * despacha por `postMessage` (`{ type: "RUN", jobType: <jobType del pool>,
   * payload }`) en vez de invocar `run()`. Ausente, o pool sin
   * `workerFactory` => se invoca `run()` in-process (comportamiento de hoy,
   * Hito 9/ADR-035). Callers existentes (Orchestrator, Hito 9) no pasan este
   * campo: su comportamiento no cambia.
   */
  readonly payload?: unknown;
  /**
   * Override del criterio de reintento (por defecto, `err.retryable`).
   *
   * **Sin call sites hoy.** El único que existió fue el dispatch de
   * `pdf-parse`, que lo usaba para compensar que `PdfPasswordRequiredError`
   * se construía con `retryable: true` pese a que
   * `05_Worker_Architecture.md` §5 documenta `PDF_PASSWORD_REQUIRED` como
   * no-retryable. **ADR-049 cerró las dos mitades**: el PR 17.1 puso el
   * `retryable` en `false` en el propio error (`pdf.errors.ts`) y el PR 17.2
   * retiró el override de acá. El campo se conserva como seam genérico del
   * pool; el caso que lo motivaba ya no existe.
   */
  readonly isRetryable?: (err: unknown) => boolean;
  /**
   * Ciclo de vida del modelo NER (ADR-046 §4): `WorkerPool` deja de
   * descartar los `PROGRESS` — los enruta al job pendiente correspondiente
   * (por `jobId`) para que el motor los traduzca a eventos de dominio en
   * host. Un `PROGRESS` de un job ya resuelto se descarta en silencio
   * (`handleWorkerMessage`). En modo in-process (`executeJob` invoca
   * `params.run()` directo) este campo no lo usa el pool: el motor ya le
   * pasa el mismo callback directo al kernel (ADR-035, comportamiento
   * observable idéntico).
   */
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
  /**
   * Transferencia real de los `ArrayBuffer` de `payload` (ADR-079 §2). El
   * pool **no la deduce**: solo el motor dueño sabe si vuelve a mirar el
   * buffer después de despachar, y transferir uno que el emisor reusa lo
   * deja detachado (`byteLength === 0`) — es exactamente el bug #6 del PR10.
   *
   * Hoy el único caller es `ocr-engine` con su `imageData` (~8 MB por página
   * A4 a 300 dpi), que el host rasteriza para ese job y suelta. El buffer
   * del PDF de `load-document` **nunca** se transfiere, y por eso
   * `broadcast()` no acepta este campo: ahí el mismo buffer va a N workers,
   * y el primer transfer dejaría a los N-1 restantes con 0 bytes.
   *
   * Ignorado en el camino in-process (no hay `postMessage` que lo use).
   */
  readonly transferList?: ReadonlyArray<globalThis.Transferable>;
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

/** `ILogger` exige `meta` objeto (`Record<string, unknown>`); `WorkerOutbound.LOG.meta` es `Serializable` (puede ser primitivo/array). Envuelve lo que no sea ya un objeto plano. */
function toLogMeta(meta: unknown): Readonly<Record<string, unknown>> | undefined {
  if (meta === undefined) return undefined;
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    return meta as Readonly<Record<string, unknown>>;
  }
  return { value: meta };
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

  // ─── Transporte por postMessage (ADR-036 §2/§3); vacío/no usado si no hay
  // `workerFactory` (comportamiento in-process de hoy, sin cambios). ───
  private readonly remoteWorkers = new Map<number, WorkerLike>();
  private readonly pendingRemoteJobs = new Map<string, PendingRemoteJob>();
  /**
   * Broadcasts de control en vuelo (`broadcast()`). Un `dispatch()` remoto
   * espera a que se vacíen antes de postear su `RUN`: los controles de
   * `05_Worker_Architecture.md` §7.4 mutan el estado por documento del worker
   * (`load-document` recrea el `PDFDocumentProxy`, `unload-document` lo
   * libera), así que un `render-page` entregado al mismo worker en el medio
   * trabaja contra un proxy que se está destruyendo — pdf.js lo rechaza con
   * "Rendering cancelled". Los broadcasts nunca esperan a un dispatch, así
   * que esta espera es unidireccional y no puede deadlockear (incluido el
   * broadcast anidado que dispara `onWorkerCreated` desde `workerForSlot`).
   */
  private readonly inFlightBroadcasts = new Set<Promise<unknown>>();

  /** Temporizador de `releaseIdleWorkers` (ADR-080). `null` = no armado. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Broadcast (ADR-043 §4): envía `payload` como `RUN` con el `jobType` de
   * este pool directo a CADA worker vivo — sin pasar por la cola de
   * prioridad (no es un job encolable) — y espera el `COMPLETED` de todos.
   * Usado por `RenderPool` para los controles `load-document`/
   * `unload-document` (`RenderEngine#loadDocument`/`unloadDocument`): a
   * diferencia de `dispatch()` (un job va a UN worker), un control de
   * `RenderEngine` debe llegar a TODOS, porque cualquiera de ellos podría
   * recibir el próximo job `render-page` sobre ese documento.
   *
   * Sin `workerFactory` (in-process, ADR-035): degenera en una sola
   * invocación de `run()` (el kernel local) — mismo criterio que
   * `executeJob`. Con `workerFactory`: asegura que exista al menos un worker
   * (`workerForSlot(0)`, bootstrap perezoso — el primer `load-document` de la
   * sesión puede llegar antes que cualquier job real haya creado un worker) y
   * despacha a TODOS los que ya viven en el pool en ese momento (incluidos
   * los creados por jobs `render-page` previos).
   */
  async broadcast<TResult>(
    payload: unknown,
    run: () => Promise<TResult>,
  ): Promise<ReadonlyArray<TResult>> {
    if (this.disposed) {
      return Promise.reject(new CancelledError(nextJobId(this.options.jobType)));
    }
    if (this.options.workerFactory === undefined) {
      return [await run()];
    }

    await this.workerForSlot(0);
    const entries = [...this.remoteWorkers.entries()];
    const all = Promise.all(
      entries.map(([slot, worker]) => this.sendBroadcastToWorker<TResult>(slot, worker, payload)),
    );
    // Registrado para que `dispatchRemote` no entregue un job a un worker
    // mientras este control le está mutando el estado por documento (ver
    // `inFlightBroadcasts`).
    this.inFlightBroadcasts.add(all);
    try {
      return await all;
    } finally {
      this.inFlightBroadcasts.delete(all);
      // Un broadcast no pasa por `pump()`, así que sin esto un pool cuya
      // última actividad fue un control (`load-document`/`unload-document`)
      // nunca armaría su temporizador de idle (ADR-080 §2).
      this.refreshIdleTimer();
    }
  }

  /**
   * Espera a los `broadcast()` de control en vuelo (una sola pasada: un
   * broadcast que arranque *después* de esta llamada no la extiende, así
   * que un dispatch no puede quedar postergado indefinidamente).
   */
  private async settleInFlightBroadcasts(): Promise<void> {
    if (this.inFlightBroadcasts.size === 0) return;
    await Promise.allSettled([...this.inFlightBroadcasts]);
  }

  private sendBroadcastToWorker<TResult>(
    slot: number,
    worker: WorkerLike,
    payload: unknown,
  ): Promise<TResult> {
    const jobId = nextJobId(this.options.jobType);
    return new Promise<TResult>((resolve, reject) => {
      this.pendingRemoteJobs.set(jobId, {
        slotIndex: slot,
        isBroadcast: true,
        resolve: (result) => resolve(result as TResult),
        reject,
      });
      const runMessage: WorkerInbound = {
        type: "RUN",
        jobId,
        signalId: jobId,
        jobType: this.options.jobType,
        payload,
      };
      worker.postMessage(runMessage);
    });
  }

  /** Rechaza todos los jobs en cola (no los que ya están corriendo) y marca el pool como dispuesto. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Jobs remotos en curso: se tratan igual que los de cola (dispose() es un
    // flujo normal, 05_Worker_Architecture.md §8), no un error de programación.
    for (const [jobId, pending] of this.pendingRemoteJobs) {
      this.pendingRemoteJobs.delete(jobId);
      pending.reject(new CancelledError(jobId));
    }
    for (const worker of this.remoteWorkers.values()) {
      const disposeMessage: WorkerInbound = { type: "DISPOSE" };
      worker.postMessage(disposeMessage);
      worker.terminate();
    }
    this.remoteWorkers.clear();
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
    this.refreshIdleTimer();
  }

  /**
   * Ocioso = las **cuatro** condiciones a la vez (ADR-080 §1). Las dos
   * últimas no son redundantes: un job remoto puede estar en vuelo sin
   * contar en `active` según el camino, y un `broadcast` de re-priming no
   * pasa por la cola ni por `pump()` (ver `assignRemoteSlot`), así que no
   * aparece en ninguna de las dos primeras. Sin ellas, la liberación podría
   * caer sobre un re-priming en curso.
   */
  private get isIdle(): boolean {
    return (
      this.active === 0 &&
      this.queue.length === 0 &&
      this.pendingRemoteJobs.size === 0 &&
      this.inFlightBroadcasts.size === 0
    );
  }

  /**
   * Rearma el temporizador **al quedar ocioso**, no al acceder al pool: un
   * job de diez minutos no debe disparar la liberación a los sesenta
   * segundos. Con trabajo pendiente, lo cancela.
   */
  private refreshIdleTimer(): void {
    const idleMs = this.options.idleDisposeMs ?? 0;
    if (idleMs <= 0 || this.disposed) return;

    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.isIdle) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.isIdle && !this.disposed) this.releaseIdleWorkers();
    }, idleMs);
  }

  /**
   * Libera los workers por inactividad (ADR-080 §3). **No es `dispose()`**:
   * el pool sigue usable y el próximo `dispatch` reconstruye el worker.
   * `dispose()` es terminal (marca `disposed` y rechaza todo lo que venga).
   *
   * Público para que `WorkerPoolManager` lo use en lugar de destruir el pool
   * entero, y para que los tests puedan forzarlo sin esperar un temporizador.
   */
  releaseIdleWorkers(): void {
    // Guarda propia y no solo la del temporizador: este método es público, y
    // matar workers con jobs en vuelo los deja colgados PARA SIEMPRE —
    // `terminate()` no dispara el evento `error`, así que
    // `handleWorkerTransportError` nunca corre y nadie rechaza sus promesas.
    // A diferencia de `dispose()`, que sí las rechaza con `CancelledError`.
    if (!this.isIdle) return;
    for (const worker of this.remoteWorkers.values()) {
      const disposeMessage: WorkerInbound = { type: "DISPOSE" };
      worker.postMessage(disposeMessage);
      worker.terminate();
    }
    this.remoteWorkers.clear();
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
        const result = await this.executeJob(jobId, params);
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

  /**
   * Punto único de bifurcación in-process vs. remoto (ADR-036 §2). Con
   * `workerFactory` configurada Y `params.payload` presente, despacha por
   * `postMessage`; si no, comportamiento de hoy (`run()` in-process). El
   * resto de `runWithRetry` (reintentos, backoff, eventos `WORKER_JOB_*`) es
   * idéntico para ambos caminos: no le importa de dónde vino el resultado.
   */
  private executeJob<TResult>(jobId: string, params: DispatchParams<TResult>): Promise<TResult> {
    if (this.options.workerFactory !== undefined && params.payload !== undefined) {
      return this.dispatchRemote<TResult>(
        jobId,
        params.payload,
        params.signal,
        params.onProgress,
        params.transferList,
      );
    }
    return params.run();
  }

  /**
   * Despacha un job por `postMessage` a una instancia real de worker (una
   * por slot de concurrencia, creada perezosamente — `workerForSlot`).
   * Correlaciona la respuesta por `jobId` vía `pendingRemoteJobs`,
   * gestionado en `handleWorkerMessage`. `onProgress` (ADR-046 §4) se
   * registra junto al resto del job pendiente para que un `PROGRESS` de este
   * `jobId` se lo entregue `handleWorkerMessage`.
   */
  private dispatchRemote<TResult>(
    jobId: string,
    payload: unknown,
    signal: AbortSignal,
    onProgress?: (progress: number, partial?: Serializable) => void,
    transferList?: ReadonlyArray<globalThis.Transferable>,
  ): Promise<TResult> {
    const slot = this.assignRemoteSlot();

    return new Promise<TResult>((resolve, reject) => {
      this.pendingRemoteJobs.set(jobId, {
        slotIndex: slot,
        resolve: (result) => resolve(result as TResult),
        reject,
        ...(onProgress !== undefined ? { onProgress } : {}),
      });

      // `workerForSlot` es async (ADR-043 §5: un worker nuevo se re-primea —
      // `onWorkerCreated`, awaited — antes de aceptar su primer job). El
      // `RUN` recién se postea cuando el worker está listo Y no hay ningún
      // control de `broadcast()` en vuelo sobre el pool (ver
      // `inFlightBroadcasts`): el worker de un slot que YA existía no pasa
      // por `onWorkerCreated`, así que sin esta espera recibiría su
      // `render-page` en el medio del `load-document` que le está recreando
      // el `PDFDocumentProxy`.
      void this.workerForSlot(slot)
        .then(async (worker) => {
          if (!this.pendingRemoteJobs.has(jobId)) return; // ya cancelado/resuelto mientras se creaba el worker.
          await this.settleInFlightBroadcasts();
          if (!this.pendingRemoteJobs.has(jobId)) return;

          if (signal.aborted) {
            // Abortado mientras se creaba/re-primeaba el worker: nunca llegó
            // a postearse un RUN al que cancelar — se rechaza directo, sin
            // enviar CANCEL (mismo criterio que el guard de `dispatch()` para
            // un signal ya abortado antes de encolar).
            this.pendingRemoteJobs.delete(jobId);
            reject(new CancelledError(jobId));
            return;
          }

          const sendCancel = (): void => {
            if (!this.pendingRemoteJobs.has(jobId)) return;
            const cancelMessage: WorkerInbound = { type: "CANCEL", jobId, signalId: jobId };
            worker.postMessage(cancelMessage);
          };
          signal.addEventListener("abort", sendCancel, { once: true });

          const runMessage: WorkerInbound = {
            type: "RUN",
            jobId,
            signalId: jobId,
            jobType: this.options.jobType,
            payload,
          };
          // ADR-079 §2: sin transfer list, `postMessage` clona — un memcpy
          // completo del payload. Solo se transfiere lo que el emisor no
          // vuelve a mirar, y esa decisión la toma el motor (ver
          // `DispatchParams.transferList`), nunca el pool.
          if (transferList !== undefined) worker.postMessage(runMessage, transferList);
          else worker.postMessage(runMessage);
        })
        .catch((err: unknown) => {
          this.pendingRemoteJobs.delete(jobId);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  /**
   * Slot de concurrencia 0..size-1 no usado por ningún job **encolado** en
   * curso. Siempre hay uno disponible por construcción: `pump()` solo ejecuta
   * un job (remoto o no) dentro del gate `active < size`, así que el número
   * de jobs remotos simultáneos nunca supera `size`.
   *
   * Los envíos de `broadcast()` quedan fuera de esa cuenta (`isBroadcast`):
   * no pasan por la cola ni por el gate de `pump()` — van directo a cada
   * worker vivo (`05_Worker_Architecture.md` §7.4) —, así que contarlos
   * rompía el invariante desde afuera. Con `renderPoolSize: 2` (el default de
   * un equipo `lowResource`, `config.ts`) bastaba un re-priming en vuelo
   * (ADR-043 §5) para que sus 2 envíos ocuparan los 2 slots y cualquier
   * `render-page` concurrente muriera acá.
   */
  private assignRemoteSlot(): number {
    const used = new Set<number>();
    for (const pending of this.pendingRemoteJobs.values()) {
      // Los controles de `broadcast()` no ocupan slot (ver `isBroadcast`).
      if (pending.isBroadcast === true) continue;
      used.add(pending.slotIndex);
    }
    for (let slot = 0; slot < this.options.size; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    // Invariante violado (ver comentario arriba): no es un fallo de dominio,
    // es un bug del propio pool — no hay un EngineErrorCode que lo describa
    // (I-4) y no es código público de cara al usuario (Code_Standards.md §7
    // aplica a funciones públicas del Core).
    throw new Error(
      `WorkerPool(${this.options.poolKey}): no hay slot de worker remoto libre (invariante de concurrencia violado).`,
    );
  }

  /**
   * Worker real para `slot`, creado perezosamente vía `workerFactory` (una
   * instancia por slot, reutilizada entre jobs). Async desde ADR-043 §5: un
   * worker recién creado se re-primea (`onWorkerCreated`, awaited) ANTES de
   * que el caller lo use para postear un job — el registro en
   * `remoteWorkers` ocurre síncronamente, antes del primer `await`, así que
   * dos llamadas concurrentes para el mismo `slot` (p. ej. un `broadcast` de
   * bootstrap solapado con un `dispatchRemote` real) nunca crean dos workers
   * para el mismo slot (la segunda ve `existing !== undefined` de inmediato).
   */
  private async workerForSlot(slot: number): Promise<WorkerLike> {
    const existing = this.remoteWorkers.get(slot);
    if (existing !== undefined) return existing;

    const factory = this.options.workerFactory;
    // Invariante: solo se llama desde dispatchRemote()/broadcast(), que ya
    // chequearon `workerFactory !== undefined`.
    if (factory === undefined) {
      throw new Error(
        `WorkerPool(${this.options.poolKey}): workerForSlot() llamado sin workerFactory configurada.`,
      );
    }

    const worker = factory();
    worker.addEventListener("message", (ev) => this.handleWorkerMessage(ev));
    worker.addEventListener("error", (ev) => this.handleWorkerTransportError(slot, ev));
    this.remoteWorkers.set(slot, worker);

    if (this.options.onWorkerCreated !== undefined) {
      await this.options.onWorkerCreated();
    }

    return worker;
  }

  /**
   * Único listener de mensajes por worker (no por job): correlaciona
   * COMPLETED/FAILED/CANCELLED contra `pendingRemoteJobs` por `jobId`, y
   * reenvía EVENT al bus real (transporte mecánico — ADR-013 §6: "los
   * eventos observables se emiten siempre en host"; el afinado de payload
   * específico de motor es responsabilidad del host-bridge de cada motor,
   * ADR-036 §3, fuera de alcance de este PR). READY no requiere acción del
   * pool: RUN ya se encola sin esperar READY. PROGRESS (ADR-046 §4) se
   * enruta al `onProgress` del job pendiente correspondiente, por `jobId`
   * — el primer consumidor es el ciclo de vida del modelo NER, que el motor
   * traduce a `NER_MODEL_LOADING`/`NER_MODEL_READY` en host; no es una vía
   * para emitir eventos observables desde el worker (eso sigue siendo
   * terreno de `EVENT`).
   */
  private handleWorkerMessage(ev: unknown): void {
    const outbound = extractWorkerOutbound(ev);
    if (outbound === undefined) return;

    if (outbound.type === "EVENT") {
      this.options.bus.emit(
        outbound.channel,
        outbound.event,
        // `payload` es `unknown` a nivel de transporte (ADR-036 §3); el
        // reenvío es tal cual, sin decidir enriquecimiento de motor.
        outbound.payload as EventPayloadMap[typeof outbound.event],
      );
      return;
    }

    if (outbound.type === "LOG") {
      this.options.logger[outbound.level](outbound.message, toLogMeta(outbound.meta));
      return;
    }

    if (outbound.type === "READY") {
      return;
    }

    if (outbound.type === "PROGRESS") {
      // Un PROGRESS de un job ya resuelto (o que nunca registró onProgress)
      // se descarta en silencio (ADR-046 §4).
      this.pendingRemoteJobs.get(outbound.jobId)?.onProgress?.(outbound.progress, outbound.partial);
      return;
    }

    const pending = this.pendingRemoteJobs.get(outbound.jobId);
    if (pending === undefined) return; // Mensaje tardío de un job ya resuelto (timeout/cancel previo).

    this.pendingRemoteJobs.delete(outbound.jobId);
    switch (outbound.type) {
      case "COMPLETED":
        pending.resolve(outbound.result);
        break;
      case "FAILED":
        pending.reject(EngineError.deserialize(outbound.error));
        break;
      case "CANCELLED":
        pending.reject(new CancelledError(outbound.jobId));
        break;
    }
  }

  /**
   * Worker crasheado (evento `error` de `WorkerLike`, `05_Worker_Architecture.md`
   * §9): se descarta la instancia (se recrea perezosamente en el próximo
   * dispatch remoto) y se rechazan sus jobs en curso.
   *
   * **Sin reintento** — a diferencia de lo que sugiere una lectura superficial
   * de `05_Worker_Architecture.md` §9 ("Pool lo marca como dead, lo
   * reemplaza, reintenta el job si retryable"): el rechazo usa
   * `InvalidInputError`, que fija `retryable: false` en su constructor
   * (`shared/src/errors.ts`), así que `runWithRetry` nunca reintenta este
   * caso aunque el job tenga `maxRetries > 0`. Es un diferimiento
   * deliberado, no un olvido: este PR es transporte puro — no hay ningún
   * worker real corriendo, solo fakes estructurales de test — así que no
   * hay contra qué validar un reintento genuino (que en el motor concreto
   * implica re-primear `INIT` y, para `RenderPool`, volver a mandar
   * `load-document` antes de reintentar el job, ADR-030). Ese
   * comportamiento llega recién en los PR12-16, con un worker real por
   * motor y un entry-point/host-bridge donde el re-priming tiene sentido.
   *
   * `InvalidInputError` (no un `Error` genérico — Code_Standards.md §7 exige
   * una subclase de `EngineError`) sigue el mismo criterio defensivo que ya
   * usa `toSerializedError` más arriba: no existe un `EngineErrorCode`
   * dedicado a "crash de transporte a nivel de pool" (los codes de
   * `EngineErrorCode`, `shared/src/enums.ts`, son todos por-motor —
   * `PDF_*`/`OCR_*`/`NER_*`/`RENDER_*`/`EXPORT_*` — o los 4 genéricos, que no
   * encajan semánticamente); inventar uno nuevo sin pasar por el proceso de
   * docs (Contracts.md primero, R-19) violaría I-4. Queda como ambigüedad
   * abierta para cuando exista un consumidor real del reintento (PR12+), no
   * resuelta en silencio acá.
   */
  /**
   * Crash de transporte (`05_Worker_Architecture.md` §9). El slot se libera
   * primero, así que el reintento que dispara el rechazo de abajo encuentra
   * el slot vacío y `workerForSlot` construye un worker nuevo (re-primeado
   * por `onWorkerCreated` antes de aceptar su primer job, ADR-043 §5).
   *
   * `WorkerCrashedError` es `retryable: true` (ADR-077): hasta ese ADR acá se
   * rechazaba con `InvalidInputError` —no-retryable, porque no existía un
   * código para "crash de transporte"— y el job en vuelo se perdía en
   * silencio, contra lo que §9 especifica desde el Hito 9.
   */
  private handleWorkerTransportError(slot: number, _ev: unknown): void {
    this.remoteWorkers.delete(slot);
    for (const [jobId, pending] of this.pendingRemoteJobs) {
      if (pending.slotIndex !== slot) continue;
      this.pendingRemoteJobs.delete(jobId);
      pending.reject(
        new WorkerCrashedError(
          `WorkerPool(${this.options.poolKey}): worker (slot ${slot}) emitió un error de transporte.`,
          { poolKey: this.options.poolKey, slot, jobId },
        ),
      );
    }
  }
}

export interface WorkerPoolManagerOptions {
  readonly bus: IEventBus;
  readonly logger: ILogger;
  readonly getPoolSize: (key: ManagedPoolKey) => number;
  readonly getMaxQueue: (key: ManagedPoolKey) => number;
  readonly getMaxRetries: (jobType: WorkerJobType) => number;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly idleDisposeMs: number;
  /** Factories de `Worker` real por pool (ADR-036 §2, `CoreRuntimeOptions.workers`). Ausente/sin entrada para `key` => ese pool queda in-process. */
  readonly workerFactories?: Partial<Readonly<Record<ManagedPoolKey, WorkerFactory>>>;
}

const JOB_TYPE_BY_POOL: Readonly<Record<ManagedPoolKey, WorkerJobType>> = {
  pdf: "pdf-parse",
  ocr: "ocr-page",
  ner: "ner-page",
  render: "render-page",
};

/**
 * Gestiona los cuatro pools "de verdad" (`ManagedPoolKey`) con creación
 * perezosa (`05_Worker_Architecture.md` §8) y disposición tras
 * `idleDisposeMs` de inactividad. El `WorkerPool` de `size: 1` del
 * ExportWorker (`poolKey: "export"`, ADR-047 §2) NO pasa por acá: lo
 * construye e inyecta `create-core.ts` directo al `ExportEngine`.
 */
export class WorkerPoolManager {
  private readonly options: WorkerPoolManagerOptions;
  private readonly pools = new Map<ManagedPoolKey, WorkerPool>();

  constructor(options: WorkerPoolManagerOptions) {
    this.options = options;
  }

  getPool(key: ManagedPoolKey): WorkerPool {
    const existing = this.pools.get(key);
    if (existing !== undefined) return existing;

    const jobType = JOB_TYPE_BY_POOL[key];
    const workerFactory = this.options.workerFactories?.[key];
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
      // ADR-080 §1: el temporizador vive en el POOL, que es el único que sabe
      // si de verdad está ocioso. El manager tenía el suyo propio, rearmado en
      // cada `getPool` — la definición que el propio ADR-080 Contexto §4
      // declara equivocada ("tiempo desde el último acceso", no "tiempo sin
      // trabajo"). Con dos temporizadores conviviendo, el del manager podía
      // liberar los workers de un `pdf-parse` largo a mitad del job.
      idleDisposeMs: this.options.idleDisposeMs,
      ...(workerFactory !== undefined ? { workerFactory } : {}),
    });
    this.pools.set(key, pool);
    return pool;
  }

  disposeAll(): void {
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
  }
}
