/**
 * PdfWorker — entry-point que corre `PdfEngine.process()` dentro de un Web
 * Worker de SO real (ADR-036 §3; `architecture/05_Worker_Architecture.md`
 * §7.1). Envuelve el motor real sin modificar su lógica interna (ADR-013 §6):
 * este archivo es pura mensajería.
 *
 * - Bus puente: cada `ctx.bus.emit(channel, event, payload)` del motor viaja
 *   como mensaje `EVENT` al host; el host-bridge genérico (`WorkerPool`,
 *   PR11, `packages/anonymization-core/src/worker-pool.ts`) lo re-emite en el
 *   bus real (ADR-013 §6: "los eventos observables se emiten siempre en
 *   host"). `PdfEngine` nunca se suscribe al bus (ADR-014, invariante
 *   contractual): `on`/`once`/`off` son no-ops seguros acá.
 * - Logger puente: cada llamada a `ctx.logger.*` viaja como mensaje `LOG`; el
 *   host ya la traduce a `ctx.logger` real (`toLogMeta` en `worker-pool.ts`).
 * - Cache local: `PdfEngine` no lee `ctx.cache`; esta implementación solo
 *   satisface el tipo de `EngineContext`.
 * - `AbortSignal` por job: un `AbortController` por `jobId`/`signalId`
 *   (`WorkerPool.dispatchRemote` usa `signalId === jobId`), abortado al
 *   recibir `CANCEL`.
 *
 * Handshake INIT (ver ADR-036 §2): `WorkerPool` (PR11) despacha `RUN` directo
 * sin enviar `INIT` primero ("RUN ya se encola sin esperar READY" —
 * `worker-pool.ts#handleWorkerMessage`). Este entry-point se auto-inicializa
 * al cargar el módulo con los defaults documentados en `Contracts.md` §6
 * (`maxPageCount = 10000`, `workerPool.timeouts["pdf-parse"] = 30000` — los
 * únicos dos campos que `PdfEngine.init()`/`.process()` leen) para no
 * depender de ese mensaje. Si el host llega a enviar `INIT` en el futuro, el
 * motor se re-inicializa con la config real (`handleInit`). Gap conocido, no
 * bloqueante: overrides de esos dos valores vía `createCore(config)` no
 * llegan a este worker mientras `WorkerPool` no transporte `INIT` con la
 * config real — ningún E2E de este hito los ejercita (ver informe del PR).
 *
 * Con `fuseOcrPage` como función pura sin estado retenido (ADR-041), este
 * worker solo envuelve `process()`: no hay una segunda "puerta" de entrada al
 * motor que rutear (la fusión corre host-side, síncrona, en el Orchestrator).
 */
import {
  CancelledError,
  EngineError,
  InvalidInputError,
  type EngineConfig,
  type EngineContext,
  type ICache,
  type IEventBus,
  type ILogger,
  type LogLevel,
  type PdfParsePayload,
  type Serializable,
  type WorkerCapabilities,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { PdfEngine } from "../pdf.engine.js";
import type { PdfEngineInput } from "../pdf.types.js";

/**
 * `pdfjs-dist` spawnea su propio Worker interno para `getDocument()` salvo
 * que `GlobalWorkerOptions.workerSrc` esté configurado (si no, rechaza con
 * `Error: No "GlobalWorkerOptions.workerSrc" specified.` — reclasificado por
 * `pdf.engine.ts` como `PdfInvalidError`/`PDF_INVALID`, indistinguible en la
 * UI de un PDF corrupto real; mismo hallazgo que `apps/react-client/src/main.tsx`
 * documentó para el hilo principal). Cada Worker tiene su **propio** scope
 * global — el `GlobalWorkerOptions.workerSrc` que `main.tsx` configura en el
 * hilo principal no alcanza acá: este entry-point importa su propia instancia
 * de `pdfjs-dist` y necesita su propia asignación, antes de cualquier
 * `PdfEngine.init()`/`.process()`. El import `?url` solo lo resuelve Vite
 * (este archivo es el único de `pdf-engine` que Vite bundlea, ADR-036 §2) —
 * ver `worker/vite-worker-env.d.ts` para el ambient del tipo.
 */
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const WORKER_CAPABILITIES: WorkerCapabilities = { maxPageBatchSize: 8 };
const WORKER_ID = `pdf-worker-${Math.random().toString(36).slice(2)}`;

/**
 * Defaults documentados en `Contracts.md` §6 — únicos dos campos que
 * `PdfEngine` lee de `EngineConfig` (`pdf.maxPageCount`,
 * `workerPool.timeouts["pdf-parse"]`). El resto son placeholders
 * estructuralmente válidos, nunca leídos por `PdfEngine` (ver nota de
 * cabecera sobre el handshake INIT).
 */
function buildLocalDefaultConfig(): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 1,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 1,
      maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
      timeouts: {
        "pdf-parse": 30_000,
        "ocr-page": 60_000,
        "ner-page": 20_000,
        "render-page": 10_000,
        "export-page": 30_000,
      },
      maxRetries: {
        "pdf-parse": 1,
        "ocr-page": 2,
        "ner-page": 1,
        "render-page": 1,
        "export-page": 1,
      },
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60_000,
    },
    pdf: { maxPageCount: 10_000 },
    ner: {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
  };
}

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

/**
 * Bus puente (ADR-036 §3): `PdfEngine` nunca se suscribe al bus (ADR-014) —
 * `on`/`once`/`off` son no-ops seguros. `emit`/`emitAsync` serializan el
 * evento como mensaje `EVENT` hacia el host. Exportada (además de usarse acá)
 * para poder testear la implementación de la bridge de forma aislada
 * (`__tests__/worker-entry.test.ts`) — `entry.ts` ya es su propio boundary
 * público (subpath `"./worker"`, ADR-036 §2), no pasa por `index.ts`.
 */
export function createBridgeBus(): IEventBus {
  return {
    on: () => () => undefined,
    once: () => () => undefined,
    off: () => undefined,
    emit: (channel, event, payload) => {
      post({ type: "EVENT", channel, event, payload });
    },
    emitAsync: (channel, event, payload) => {
      post({ type: "EVENT", channel, event, payload });
      return Promise.resolve();
    },
  };
}

/**
 * Logger puente (ADR-036 §3): cada llamada viaja como mensaje `LOG`; el host
 * ya la traduce a `ctx.logger` real (`worker-pool.ts#toLogMeta`).
 */
function createBridgeLogger(): ILogger {
  const send = (
    level: LogLevel,
    message: string,
    meta?: Readonly<Record<string, unknown>>,
  ): void => {
    if (meta !== undefined) {
      // Cast de frontera de transporte (ADR-019/ADR-036 §3): ILogger recibe
      // Record<string, unknown>, WorkerOutbound.LOG.meta es Serializable. Los
      // callers reales de ctx.logger en pdf.engine.ts solo pasan datos planos.
      post({ type: "LOG", level, message, meta: meta as Serializable });
    } else {
      post({ type: "LOG", level, message });
    }
  };
  return {
    debug: (message, meta) => send("debug", message, meta),
    info: (message, meta) => send("info", message, meta),
    warn: (message, meta) => send("warn", message, meta),
    error: (message, meta) => send("error", message, meta),
  };
}

/**
 * Cache local (ADR-036 §3): `PdfEngine` no la lee; solo satisface el tipo de
 * `EngineContext`. Exportada por el mismo motivo que `createBridgeBus`.
 */
export function createLocalCache(): ICache {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    set: (key, value) => {
      store.set(key, value);
    },
    delete: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get size() {
      return store.size;
    },
    get bytes() {
      return 0;
    },
  };
}

const bridgeBus = createBridgeBus();
const bridgeLogger = createBridgeLogger();
const localCache = createLocalCache();

let engineConfig: EngineConfig = buildLocalDefaultConfig();
const engine = new PdfEngine();

function buildInitContext(): EngineContext {
  return {
    bus: bridgeBus,
    logger: bridgeLogger,
    cache: localCache,
    abortSignal: new AbortController().signal,
    config: engineConfig,
  };
}

let engineInitialized: Promise<void> = engine.init(buildInitContext());

/** Un `AbortController` por job en curso, indexado por `signalId` (`=== jobId`, ver `worker-pool.ts#dispatchRemote`). */
const jobControllers = new Map<string, AbortController>();

function handleInit(config: unknown): void {
  // Cast de frontera de transporte (ADR-019): `INIT.config` es `unknown` a
  // este nivel; el entry-point de cada motor lo afina a su propio tipo.
  engineConfig = config as EngineConfig;
  engineInitialized = engine.init(buildInitContext());
  void engineInitialized.then(() => {
    post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
  });
}

async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
  const { jobId, signalId, jobType, payload } = message;

  if (jobType !== "pdf-parse") {
    post({
      type: "FAILED",
      jobId,
      error: new InvalidInputError(`PdfWorker no soporta jobType '${jobType}'.`, {
        jobType,
      }).serialize(),
    });
    return;
  }

  const controller = new AbortController();
  jobControllers.set(signalId, controller);

  try {
    await engineInitialized;

    // Cast de frontera de transporte (ADR-019): `RUN.payload` es `unknown` a
    // este nivel; el entry-point de cada motor lo afina a su propio tipo
    // (PdfParsePayload, `03_Data_Model.md` §18).
    const parsePayload = payload as PdfParsePayload;
    const input: PdfEngineInput = {
      documentId: parsePayload.documentId,
      buffer: parsePayload.buffer,
      ...(parsePayload.password !== undefined ? { password: parsePayload.password } : {}),
    };
    const ctx: EngineContext = {
      bus: bridgeBus,
      logger: bridgeLogger,
      cache: localCache,
      abortSignal: controller.signal,
      config: engineConfig,
    };

    const result = await engine.process(input, ctx);
    // ADR-042: COMPLETED.result es unknown a nivel de transporte — compila
    // directo, sin cast (el host-bridge consumidor afina el tipo concreto).
    post({ type: "COMPLETED", jobId, result });
  } catch (err: unknown) {
    if (err instanceof CancelledError) {
      post({ type: "CANCELLED", jobId, signalId });
    } else if (err instanceof EngineError) {
      post({ type: "FAILED", jobId, error: err.serialize() });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: "FAILED", jobId, error: new InvalidInputError(message).serialize() });
    }
  } finally {
    jobControllers.delete(signalId);
  }
}

function handleCancel(message: Extract<WorkerInbound, { type: "CANCEL" }>): void {
  jobControllers.get(message.signalId)?.abort();
}

async function handleDispose(): Promise<void> {
  await engine.dispose();
}

self.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
  const message = ev.data;
  switch (message.type) {
    case "INIT":
      handleInit(message.config);
      break;
    case "RUN":
      void handleRun(message);
      break;
    case "CANCEL":
      handleCancel(message);
      break;
    case "DISPOSE":
      void handleDispose();
      break;
  }
});

// Auto-init eager (ver nota de cabecera: WorkerPool no envía INIT en este PR).
void engineInitialized.then(() => {
  post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
});
