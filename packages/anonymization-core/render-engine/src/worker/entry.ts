/**
 * RenderWorker — entry-point que corre el kernel de Render (rasterización
 * pdfjs-dist + composición OffscreenCanvas + encode) dentro de un Web Worker
 * de SO real (ADR-043; `architecture/05_Worker_Architecture.md` §7.4).
 *
 * A diferencia de `PdfWorker` (ADR-036 §1, "el entry-point corre el motor
 * real"): acá NO se instancia `RenderEngine`. La clase completa —estado,
 * cache LRU, supersede, suscripciones al bus, emisión de eventos/blob URLs—
 * queda host-side (ADR-043 §1, desviación sancionada de ADR-036 §1 para este
 * motor). Este archivo es pura mensajería alrededor de las 4 funciones del
 * kernel (`./kernel.js`).
 *
 * - Sin bus/logger puente: el kernel no emite eventos observables (los
 *   motores los emiten siempre en host, ADR-013 §6) ni loguea nada — no hay
 *   nada que reenviar por `EVENT`/`LOG` desde acá.
 * - Config local (mismo patrón que `pdf-engine/src/worker/entry.ts`,
 *   ADR-036 §2): auto-init eager con los defaults documentados en
 *   `Contracts.md` §6 (`render.jpegQuality = 0.85`,
 *   `workerPool.timeouts["render-page"] = 10000`) — únicos dos campos que el
 *   kernel necesita (el resto de `scale`/`imageFormat`/etc. ya vienen
 *   resueltos en el propio payload, construidos por el host). Si el host
 *   llega a enviar `INIT` con la config real, se re-adopta. Gap conocido, no
 *   bloqueante (mismo precedente que PdfWorker): overrides de esos dos
 *   valores vía `createCore(config)` no llegan a este worker hasta que
 *   `WorkerPool` transporte `INIT` con la config real.
 * - `AbortSignal` por job: un `AbortController` por `jobId`/`signalId`
 *   (`WorkerPool.dispatchRemote` usa `signalId === jobId`), abortado al
 *   recibir `CANCEL` — mismo mecanismo que `PdfWorker`.
 * - Discriminación por forma del payload de "render-page" (ADR-043 §4,
 *   ampliado a un quinto caso por ADR-059 §5; orden documentado también en
 *   `05_Worker_Architecture.md` §7.4), en este orden EXACTO: `"buffer" in
 *   payload` -> load-document (`LoadDocumentPayload`); `"rows" in payload`
 *   -> legend (`RenderLegendPayload`, ADR-059 §5 — sin `documentId`, así que
 *   no puede colisionar con ninguno de los otros cuatro; va temprano, antes
 *   de "kind"/"pageIndex", pero podría ir en cualquier posición relativa a
 *   esos dos); `"kind" in payload` -> render (`RenderPagePayload`);
 *   `"pageIndex" in payload` -> rasterize (`RasterizePagePayload`); si no ->
 *   unload-document (`UnloadDocumentPayload`, el único de los 5 sin ninguno
 *   de esos 4 campos). Los controles (load/unload) viajan como `RUN` con
 *   `jobType: "render-page"` directo a cada worker, sin cola (`WorkerInbound`
 *   no cambia, ADR-043 §4).
 */
import {
  CancelledError,
  EngineError,
  InvalidInputError,
  type LoadDocumentPayload,
  type RenderLegendPayload,
  type RenderPagePayload,
  type UnloadDocumentPayload,
  type WorkerCapabilities,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {
  kernelDisposeAll,
  kernelLoadDocument,
  kernelRasterizePage,
  kernelRenderLegendPage,
  kernelRenderPage,
  kernelUnloadDocument,
  type RasterizePagePayloadWithRegion,
} from "./kernel.js";

/**
 * Cada Worker tiene su propio scope global (ver el comentario equivalente en
 * `pdf-engine/src/worker/entry.ts` para el hallazgo completo): el kernel usa
 * `getDocument()` en `kernelLoadDocument`, así que este entry-point necesita
 * su propia asignación de `workerSrc`, independiente de la que configura
 * `apps/react-client/src/main.tsx` para el hilo principal. El import `?url`
 * solo lo resuelve Vite (este archivo es el único de `render-engine` que
 * Vite bundlea como Worker, ADR-036 §2) — ver `worker/vite-worker-env.d.ts`.
 */
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const WORKER_CAPABILITIES: WorkerCapabilities = { maxPageBatchSize: 8 };
const WORKER_ID = `render-worker-${Math.random().toString(36).slice(2)}`;

// Defaults de Contracts.md §6 (RenderConfig.jpegQuality,
// WorkerPoolConfig.timeouts["render-page"]) — únicos dos campos que el
// kernel necesita de EngineConfig (ver nota de cabecera).
let renderJpegQuality = 0.85;
let renderPageTimeoutMs = 10_000;

interface LocalConfigShape {
  readonly render?: { readonly jpegQuality?: number };
  readonly workerPool?: { readonly timeouts?: { readonly "render-page"?: number } };
}

function applyConfig(config: unknown): void {
  // Cast de frontera de transporte (ADR-019): INIT.config es unknown a este
  // nivel; el entry-point de cada motor lo afina a los campos que necesita.
  const candidate = config as LocalConfigShape | null | undefined;
  if (candidate?.render?.jpegQuality !== undefined) {
    renderJpegQuality = candidate.render.jpegQuality;
  }
  const renderPageTimeout = candidate?.workerPool?.timeouts?.["render-page"];
  if (renderPageTimeout !== undefined) {
    renderPageTimeoutMs = renderPageTimeout;
  }
}

function post(message: WorkerOutbound): void {
  self.postMessage(message);
}

/** Un `AbortController` por job en curso, indexado por `signalId` (`=== jobId`, ver `worker-pool.ts#dispatchRemote`). */
const jobControllers = new Map<string, AbortController>();

// ─── Discriminación por forma del payload de "render-page" (ADR-043 §4) ───

function isLoadDocumentPayload(payload: unknown): payload is LoadDocumentPayload {
  return typeof payload === "object" && payload !== null && "buffer" in payload;
}

// ADR-059 §5: quinto caso, agregado sin tocar los otros cuatro checks — el
// único payload de "render-page" SIN documentId, por eso no puede colisionar.
function isRenderLegendPayload(payload: unknown): payload is RenderLegendPayload {
  return typeof payload === "object" && payload !== null && "rows" in payload;
}

function isRenderPagePayload(payload: unknown): payload is RenderPagePayload {
  return typeof payload === "object" && payload !== null && "kind" in payload;
}

// ADR-065 §5: `region` (opcional) viaja dentro de esta misma forma —
// `RasterizePagePayloadWithRegion` extiende la `RasterizePagePayload` de
// `@anonly/shared` con un campo opcional, así que la discriminación por
// forma no cambia (sigue siendo "pageIndex" in payload).
function isRasterizePagePayload(payload: unknown): payload is RasterizePagePayloadWithRegion {
  return typeof payload === "object" && payload !== null && "pageIndex" in payload;
}

async function dispatchKernel(payload: unknown, abortSignal: AbortSignal): Promise<unknown> {
  // Orden fijado por ADR-043 §4 + ADR-059 §5 (05_Worker_Architecture.md
  // §7.4) — no reordenar "buffer" -> load / "kind" -> render / "pageIndex"
  // -> rasterize entre sí; "rows" -> legend puede ir en cualquier posición
  // relativa a esos tres (no colisiona con ninguno); si no -> unload (único
  // de los 5 sin ninguno de esos 4 campos).
  if (isLoadDocumentPayload(payload)) {
    return kernelLoadDocument(payload);
  }
  if (isRenderLegendPayload(payload)) {
    return kernelRenderLegendPage(payload, { jpegQuality: renderJpegQuality });
  }
  if (isRenderPagePayload(payload)) {
    return kernelRenderPage(payload, {
      jpegQuality: renderJpegQuality,
      timeoutMs: renderPageTimeoutMs,
      abortSignal,
    });
  }
  if (isRasterizePagePayload(payload)) {
    return kernelRasterizePage(payload, { timeoutMs: renderPageTimeoutMs, abortSignal });
  }
  return kernelUnloadDocument(payload as UnloadDocumentPayload);
}

async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
  const { jobId, signalId, jobType, payload } = message;

  if (jobType !== "render-page") {
    post({
      type: "FAILED",
      jobId,
      error: new InvalidInputError(`RenderWorker no soporta jobType '${jobType}'.`, {
        jobType,
      }).serialize(),
    });
    return;
  }

  const controller = new AbortController();
  jobControllers.set(signalId, controller);

  try {
    const result = await dispatchKernel(payload, controller.signal);
    // ADR-042: COMPLETED.result es unknown a nivel de transporte — compila
    // directo, sin cast (el host-bridge consumidor, acá `render.engine.ts`,
    // afina el tipo concreto según la operación que despachó).
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
  kernelDisposeAll();
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
// PR; RUN ya se encola sin esperar READY, mismo patrón que PdfWorker).
post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
