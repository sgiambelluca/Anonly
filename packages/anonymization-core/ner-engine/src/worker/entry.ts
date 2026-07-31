/**
 * NerWorker — entry-point que corre el kernel de inferencia NER
 * (`@huggingface/transformers`) dentro de un Web Worker de SO real
 * (ADR-046 §3; `architecture/05_Worker_Architecture.md` §7.3).
 *
 * A diferencia de `PdfWorker` (ADR-036 §1, "el entry-point corre el motor
 * real"): acá NO se instancia `NerEngine`. La clase completa —loop por
 * página, partición en batches, retry/timeout, mapeo de spans a
 * `Occurrence`, emisión de los seis eventos— queda host-side (ADR-046 §1,
 * tercera desviación sancionada de ADR-036 §1, precedentes ADR-043/ADR-045
 * para Render/OCR). Este archivo es pura mensajería alrededor de
 * `kernelClassify` (`./kernel.js`).
 *
 * - Sin bus/logger puente para eventos de dominio: el kernel no emite
 *   ningún evento observable ni loguea nada (los motores los emiten siempre
 *   en host, ADR-013 §6) — no hay `EVENT`/`LOG` que reenviar desde acá.
 * - **Sí** reenvía `PROGRESS`: a diferencia de OCR/Render, acá el ciclo de
 *   vida del modelo (`NerKernelProgress`, ADR-046 §4) es lo único
 *   observable que solo puede reportarse dentro del worker. Este
 *   entry-point lo reenvía tal cual (`post({ type: "PROGRESS", ... })`), sin
 *   traducirlo: la traducción a `NER_MODEL_LOADING`/`NER_MODEL_READY` la hace
 *   el motor, en host, a través del `onProgress` que `WorkerPool` enruta
 *   (`worker-pool.ts#handleWorkerMessage`).
 * - `AbortSignal` por job: un `AbortController` por `jobId`/`signalId`
 *   (`WorkerPool.dispatchRemote` usa `signalId === jobId`), abortado al
 *   recibir `CANCEL` — mismo mecanismo que Pdf/Render/OcrWorker.
 * - Config local (mismo patrón que `ocr-engine/src/worker/entry.ts`,
 *   ADR-036 §2): auto-init eager con el default documentado en
 *   `Contracts.md` §6 (`workerPool.timeouts["ner-page"] = 20000`) — único
 *   campo que el kernel necesita de `EngineConfig` (el resto —`modelId`,
 *   `quantization`, `wasmPaths`— viaja en el propio `NerPagePayload`,
 *   resuelto por `NerEngine` host-side). Si el host llega a enviar `INIT`
 *   con la config real, se re-adopta. Gap conocido, no bloqueante (mismo
 *   precedente que Pdf/Render/Ocr).
 */
import {
  CancelledError,
  EngineError,
  InvalidInputError,
  type NerPagePayload,
  type WorkerCapabilities,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";

import { kernelClassify, kernelDispose } from "./kernel.js";

const WORKER_CAPABILITIES: WorkerCapabilities = { maxPageBatchSize: 8 };
const WORKER_ID = `ner-worker-${Math.random().toString(36).slice(2)}`;

// Default de Contracts.md §6 (WorkerPoolConfig.timeouts["ner-page"]) — único
// campo que el kernel necesita de EngineConfig (ver nota de cabecera).
let nerPageTimeoutMs = 20_000;

interface LocalConfigShape {
  readonly workerPool?: { readonly timeouts?: { readonly "ner-page"?: number } };
}

function applyConfig(config: unknown): void {
  // Cast de frontera de transporte (ADR-019): INIT.config es unknown a este
  // nivel; el entry-point de cada motor lo afina a los campos que necesita.
  const candidate = config as LocalConfigShape | null | undefined;
  const timeout = candidate?.workerPool?.timeouts?.["ner-page"];
  if (timeout !== undefined) nerPageTimeoutMs = timeout;
}

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

/** Un `AbortController` por job en curso, indexado por `signalId` (`=== jobId`, ver `worker-pool.ts#dispatchRemote`). */
const jobControllers = new Map<string, AbortController>();

async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
  const { jobId, signalId, jobType, payload } = message;

  if (jobType !== "ner-page") {
    post({
      type: "FAILED",
      jobId,
      error: new InvalidInputError(`NerWorker no soporta jobType '${jobType}'.`, {
        jobType,
      }).serialize(),
    });
    return;
  }

  const controller = new AbortController();
  jobControllers.set(signalId, controller);

  try {
    // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a este
    // nivel; el entry-point lo afina a NerPagePayload (03_Data_Model.md §18).
    const nerPayload = payload as NerPagePayload;
    const spans = await kernelClassify(nerPayload, {
      timeoutMs: nerPageTimeoutMs,
      abortSignal: controller.signal,
      // ADR-046 §4: reenvía el ciclo de vida del modelo tal cual, sin
      // traducirlo — la traducción a eventos de dominio ocurre en host.
      onProgress: (progress, partial) => post({ type: "PROGRESS", jobId, progress, partial }),
    });
    // ADR-046 §1: COMPLETED { spans } — sin bbox/wordSpan/id, el mapeo a
    // Occurrence lo hace el host, que es quien tiene las Word[] de la página.
    post({ type: "COMPLETED", jobId, result: { spans } });
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
// PR; RUN ya se encola sin esperar READY, mismo patrón que Pdf/Render/OcrWorker).
post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
