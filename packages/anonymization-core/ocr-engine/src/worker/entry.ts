/**
 * OcrWorker — entry-point que corre el kernel de reconocimiento OCR
 * (tesseract.js) dentro de un Web Worker de SO real (ADR-045 §3;
 * `architecture/05_Worker_Architecture.md` §7.2).
 *
 * A diferencia de `PdfWorker` (ADR-036 §1, "el entry-point corre el motor
 * real"): acá NO se instancia `OcrEngine`. La clase completa —loop por
 * página, retry/timeout, depósito en `ctx.cache`, emisión de los cuatro
 * eventos— queda host-side (ADR-045 §1, segunda desviación sancionada de
 * ADR-036 §1, precedente ADR-043 para Render). Este archivo es pura
 * mensajería alrededor de `kernelRecognize` (`./kernel.js`).
 *
 * - Sin bus/logger puente: el kernel no emite eventos observables ni loguea
 *   nada (los motores los emiten siempre en host, ADR-013 §6) — no hay nada
 *   que reenviar por `EVENT`/`LOG` desde acá. Mismo criterio que
 *   `render-engine/src/worker/entry.ts`.
 * - `AbortSignal` por job: un `AbortController` por `jobId`/`signalId`
 *   (`WorkerPool.dispatchRemote` usa `signalId === jobId`), abortado al
 *   recibir `CANCEL` — mismo mecanismo que PdfWorker/RenderWorker.
 * - Config local (mismo patrón que `render-engine/src/worker/entry.ts`,
 *   ADR-036 §2): auto-init eager con el default documentado en
 *   `Contracts.md` §6 (`workerPool.timeouts["ocr-page"] = 60000`) — único
 *   campo que el kernel necesita de `EngineConfig` (los idiomas viajan en el
 *   propio `OcrPagePayload`, resueltos por `OcrEngine` host-side). Si el host
 *   llega a enviar `INIT` con la config real, se re-adopta. Gap conocido, no
 *   bloqueante (mismo precedente que Pdf/Render): overrides de ese valor vía
 *   `createCore(config)` no llegan a este worker mientras `WorkerPool` no
 *   transporte `INIT` con la config real.
 */
import {
  CancelledError,
  EngineError,
  InvalidInputError,
  type OcrPagePayload,
  type WorkerCapabilities,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";

import { kernelDispose, kernelRecognize } from "./kernel.js";

const WORKER_CAPABILITIES: WorkerCapabilities = { maxPageBatchSize: 8 };
const WORKER_ID = `ocr-worker-${Math.random().toString(36).slice(2)}`;

// Default de Contracts.md §6 (WorkerPoolConfig.timeouts["ocr-page"]) — único
// campo que el kernel necesita de EngineConfig (ver nota de cabecera).
let ocrPageTimeoutMs = 60_000;

interface LocalConfigShape {
  readonly workerPool?: { readonly timeouts?: { readonly "ocr-page"?: number } };
}

function applyConfig(config: unknown): void {
  // Cast de frontera de transporte (ADR-019): INIT.config es unknown a este
  // nivel; el entry-point de cada motor lo afina a los campos que necesita.
  const candidate = config as LocalConfigShape | null | undefined;
  const timeout = candidate?.workerPool?.timeouts?.["ocr-page"];
  if (timeout !== undefined) ocrPageTimeoutMs = timeout;
}

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

/** Un `AbortController` por job en curso, indexado por `signalId` (`=== jobId`, ver `worker-pool.ts#dispatchRemote`). */
const jobControllers = new Map<string, AbortController>();

async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
  const { jobId, signalId, jobType, payload } = message;

  if (jobType !== "ocr-page") {
    post({
      type: "FAILED",
      jobId,
      error: new InvalidInputError(`OcrWorker no soporta jobType '${jobType}'.`, {
        jobType,
      }).serialize(),
    });
    return;
  }

  const controller = new AbortController();
  jobControllers.set(signalId, controller);

  try {
    // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a este
    // nivel; el entry-point lo afina a OcrPagePayload (03_Data_Model.md §18).
    const ocrPayload = payload as OcrPagePayload;
    const result = await kernelRecognize(ocrPayload, {
      timeoutMs: ocrPageTimeoutMs,
      abortSignal: controller.signal,
    });
    // ADR-042: COMPLETED.result es unknown a nivel de transporte — compila
    // directo, sin cast (el host-bridge consumidor, acá ocr.engine.ts, afina
    // el tipo concreto que este kernel realmente produce).
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

function handleDispose(): void {
  void kernelDispose();
}

self.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
  const message = ev.data;
  switch (message.type) {
    case "INIT":
      applyConfig(message.config);
      post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
      break;
    case "RUN":
      void handleRun(message);
      break;
    case "CANCEL":
      handleCancel(message);
      break;
    case "DISPOSE":
      handleDispose();
      break;
  }
});

// Auto-init eager (ver nota de cabecera: WorkerPool no envía INIT en este
// PR; RUN ya se encola sin esperar READY, mismo patrón que Pdf/RenderWorker).
post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
