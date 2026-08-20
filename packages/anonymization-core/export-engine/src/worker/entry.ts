/**
 * ExportWorker — entry-point que corre el ensamblador pdf-lib
 * (`./assembler.js`) dentro de un Web Worker de SO real (ADR-047 §1-§4;
 * `architecture/05_Worker_Architecture.md` §7.5).
 *
 * A diferencia de `PdfWorker` (ADR-036 §1, "el entry-point corre el motor
 * real"): acá NO se instancia `ExportEngine`. La clase completa —validación
 * de input, el loop por página, la resolución de `Replacement[]`, el
 * `RenderPageProvider`, el retry/timeout por página, los cuatro eventos, la
 * sanitización de `title`/`filename` y la creación del blob URL— queda
 * host-side (ADR-047 §1, cuarta desviación sancionada de ADR-036 §1 y la
 * única CON estado: este worker retiene el `PDFDocument` en construcción
 * entre mensajes). Este archivo es pura mensajería alrededor de
 * `appendPage`/`savePdf`/`discardState` (`./assembler.js`).
 *
 * - Sin bus/logger puente: el ensamblador no emite eventos observables ni
 *   loguea nada (los motores los emiten siempre en host, ADR-013 §6) — no
 *   hay nada que reenviar por `EVENT`/`LOG` desde acá. Mismo criterio que
 *   `ocr-engine/src/worker/entry.ts`/`ner-engine/src/worker/entry.ts`.
 * - Sin config local: a diferencia de Pdf/Render/Ocr/Ner (que adoptan algún
 *   campo de `EngineConfig` vía `INIT.config`), el ensamblador no necesita
 *   ninguno — el único timeout relevante (`workerPool.timeouts["export-page"]`)
 *   lo aplica el host envolviendo el despacho, nunca el worker (ADR-047 §5).
 *   `INIT` solo vuelve a publicar `READY`.
 * - `AbortSignal` por job: un `AbortController` por `jobId`/`signalId`
 *   (`WorkerPool.dispatchRemote` usa `signalId === jobId`), abortado al
 *   recibir `CANCEL` — mismo mecanismo que los otros cuatro workers.
 * - Discriminación por forma del payload de "export-page" (ADR-047 §3),
 *   mismo criterio que ADR-043 §4 para `render-page`: `"pageImage" in
 *   payload` -> `append-page` (`ExportPagePayload`); si no -> `save`
 *   (`ExportSavePayload`, el único de los dos sin ese campo).
 * - Estado: `state` (`AssemblerState`) a nivel de módulo — para este worker
 *   real, es "el documento que este worker tiene en construcción" (ADR-047
 *   §4). `CANCEL` y `DISPOSE` lo descartan incondicionalmente
 *   (`discardState()`); `append-page`/`save` lo reasignan con el valor que
 *   devuelve `./assembler.js` (documentId distinto -> parcial nuevo;
 *   `save` exitoso -> vacío otra vez).
 */
import {
  CancelledError,
  EngineError,
  InvalidInputError,
  type ExportPagePayload,
  type ExportSavePayload,
  type WorkerCapabilities,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";

import {
  appendPage,
  discardState,
  savePdf,
  type AssemblerState,
  EMPTY_ASSEMBLER_STATE,
} from "./assembler.js";

const WORKER_CAPABILITIES: WorkerCapabilities = { maxPageBatchSize: 8 };
const WORKER_ID = `export-worker-${Math.random().toString(36).slice(2)}`;

/** El `PDFDocument` en construcción de este worker (ADR-047 §4). Un documento a la vez. */
let state: AssemblerState = EMPTY_ASSEMBLER_STATE;

function post(message: WorkerOutbound, transfer?: ReadonlyArray<Transferable>): void {
  // Forma `StructuredSerializeOptions` y no la posicional `(message, [])`:
  // con `lib: ["DOM", "WebWorker"]` (tsconfig.base) el overload posicional de
  // `Window` gana y no acepta una transfer list. La copia mutable es porque
  // `StructuredSerializeOptions.transfer` es `Transferable[]`, no readonly.
  if (transfer !== undefined && transfer.length > 0) {
    self.postMessage(message, { transfer: [...transfer] });
  } else {
    self.postMessage(message);
  }
}

/** Un `AbortController` por job en curso, indexado por `signalId` (`=== jobId`, ver `worker-pool.ts#dispatchRemote`). */
const jobControllers = new Map<string, AbortController>();

// ─── Discriminación por forma del payload de "export-page" (ADR-047 §3) ───

function isExportPagePayload(payload: unknown): payload is ExportPagePayload {
  return typeof payload === "object" && payload !== null && "pageImage" in payload;
}

async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
  const { jobId, signalId, jobType, payload } = message;

  if (jobType !== "export-page") {
    post({
      type: "FAILED",
      jobId,
      error: new InvalidInputError(`ExportWorker no soporta jobType '${jobType}'.`, {
        jobType,
      }).serialize(),
    });
    return;
  }

  const controller = new AbortController();
  jobControllers.set(signalId, controller);

  try {
    if (isExportPagePayload(payload)) {
      state = await appendPage(state, payload, { abortSignal: controller.signal });
      // Sin datos que devolver: el host solo necesita la confirmación de
      // COMPLETED antes de despachar la próxima página (Export_Engine.md §15
      // item 22).
      post({ type: "COMPLETED", jobId, result: null });
    } else {
      // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a
      // este nivel; único de los dos sin "pageImage" -> ExportSavePayload.
      const savePayload = payload as ExportSavePayload;
      const { buffer, state: nextState } = await savePdf(state, savePayload, {
        abortSignal: controller.signal,
      });
      state = nextState;
      // ADR-042: COMPLETED.result es unknown a nivel de transporte — el
      // host-bridge (export.engine.ts) lo afina a ArrayBuffer.
      //
      // ADR-079 §1: se transfiere. `savePdf` ya devolvió el estado limpio
      // (`discardState`), así que este worker no vuelve a mirar el buffer —
      // la condición exacta que hace segura la transferencia.
      post({ type: "COMPLETED", jobId, result: buffer }, [buffer]);
    }
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
  // ADR-047 §4: CANCEL descarta el PDFDocument parcial incondicionalmente
  // (ver comentario de `discardState` en assembler.ts).
  state = discardState();
}

function handleDispose(): void {
  state = discardState();
}

self.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
  const message = ev.data;
  switch (message.type) {
    case "INIT":
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

// Auto-init eager (mismo patrón que Pdf/Render/Ocr/NerWorker: WorkerPool no
// envía INIT en este PR; RUN ya se encola sin esperar READY).
post({ type: "READY", workerId: WORKER_ID, capabilities: WORKER_CAPABILITIES });
