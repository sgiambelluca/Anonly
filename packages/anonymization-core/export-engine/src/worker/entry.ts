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

import { startWorkerEntry, type ExportPagePayload, type ExportSavePayload } from "@anonly/shared";

import {
  appendPage,
  discardState,
  savePdf,
  type AssemblerState,
  EMPTY_ASSEMBLER_STATE,
} from "./assembler.js";

/** El `PDFDocument` en construcción de este worker (ADR-047 §4). Un documento a la vez. */
let state: AssemblerState = EMPTY_ASSEMBLER_STATE;

// ─── Discriminación por forma del payload de "export-page" (ADR-047 §3) ───

function isExportPagePayload(payload: unknown): payload is ExportPagePayload {
  return typeof payload === "object" && payload !== null && "pageImage" in payload;
}

startWorkerEntry({
  workerId: "export",
  jobType: "export-page",
  capabilities: { maxPageBatchSize: 8 },

  async run(payload, ctx) {
    if (isExportPagePayload(payload)) {
      state = await appendPage(state, payload, { abortSignal: ctx.abortSignal });
      // Sin datos que devolver: el host solo necesita la confirmación de
      // COMPLETED antes de despachar la próxima página (Export_Engine.md §15
      // item 22).
      return null;
    }
    // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a este
    // nivel; único de los dos sin "pageImage" -> ExportSavePayload.
    const { buffer, state: nextState } = await savePdf(state, payload as ExportSavePayload, {
      abortSignal: ctx.abortSignal,
    });
    state = nextState;
    // ADR-042: COMPLETED.result es unknown a nivel de transporte — el
    // host-bridge (export.engine.ts) lo afina a ArrayBuffer.
    return buffer;
  },

  /*
   * ADR-079 §1: el buffer del `save` se transfiere. `savePdf` ya devolvió el
   * estado limpio (`discardState`), así que este worker no vuelve a mirarlo —
   * la condición exacta que hace segura la transferencia. El `append` devuelve
   * `null` y no transfiere nada.
   */
  transferablesOf: (result) => (result instanceof ArrayBuffer ? [result] : []),

  onCancel() {
    // ADR-047 §4: CANCEL descarta el PDFDocument parcial incondicionalmente
    // (ver comentario de `discardState` en assembler.ts).
    state = discardState();
  },

  dispose() {
    state = discardState();
  },
});
