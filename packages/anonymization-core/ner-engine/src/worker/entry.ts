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
 *
 * **El ciclo de vida del entry-point lo aporta `startWorkerEntry`**
 * (`@anonly/shared`, ADR-128): el `Map` de `AbortController` por `signalId`, el
 * guard de `jobType`, el mapeo de errores que cruzan la frontera, la limpieza
 * y el `READY` eager. El `PROGRESS` sale por `ctx.progress`, que es el mismo
 * mensaje con el `jobId` ya puesto.
 */

import { type NerPagePayload, startWorkerEntry } from "@anonly/shared";

import { kernelClassify, kernelDispose } from "./kernel.js";

// Default de Contracts.md §6 (WorkerPoolConfig.timeouts["ner-page"]) — único
// campo que el kernel necesita de EngineConfig (ver nota de cabecera).
let nerPageTimeoutMs = 20_000;

interface LocalConfigShape {
  readonly workerPool?: { readonly timeouts?: { readonly "ner-page"?: number } };
}

startWorkerEntry({
  workerId: "ner",
  jobType: "ner-page",
  capabilities: { maxPageBatchSize: 8 },

  applyConfig(config) {
    // Cast de frontera de transporte (ADR-019): INIT.config es unknown a este
    // nivel; el entry-point de cada motor lo afina a los campos que necesita.
    const candidate = config as LocalConfigShape | null | undefined;
    const timeout = candidate?.workerPool?.timeouts?.["ner-page"];
    if (timeout !== undefined) nerPageTimeoutMs = timeout;
  },

  async run(payload, ctx) {
    // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a este
    // nivel; el entry-point lo afina a NerPagePayload (03_Data_Model.md §18).
    const spans = await kernelClassify(payload as NerPagePayload, {
      timeoutMs: nerPageTimeoutMs,
      abortSignal: ctx.abortSignal,
      // ADR-046 §4: reenvía el ciclo de vida del modelo tal cual, sin
      // traducirlo — la traducción a eventos de dominio ocurre en host.
      onProgress: ctx.progress,
    });
    // ADR-046 §1: COMPLETED { spans } — sin bbox/wordSpan/id, el mapeo a
    // Occurrence lo hace el host, que es quien tiene las Word[] de la página.
    return { spans };
  },

  dispose() {
    void kernelDispose();
  },
});
