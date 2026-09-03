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
 * **El ciclo de vida del entry-point lo aporta `startWorkerEntry`**
 * (`@anonly/shared`, ADR-128): el `Map` de `AbortController` por `signalId`, el
 * guard de `jobType`, el mapeo de errores que cruzan la frontera, la limpieza
 * y el `READY` eager. Acá queda solo lo propio de OCR.
 *
 * - Sin bus/logger puente: el kernel no emite eventos observables ni loguea
 *   nada (los motores los emiten siempre en host, ADR-013 §6) — no hay nada
 *   que reenviar por `EVENT`/`LOG` desde acá. Mismo criterio que
 *   `render-engine/src/worker/entry.ts`.
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

import { type OcrPagePayload, startWorkerEntry } from "@anonly/shared";

import { kernelDispose, kernelRecognize } from "./kernel.js";

// Default de Contracts.md §6 (WorkerPoolConfig.timeouts["ocr-page"]) — único
// campo que el kernel necesita de EngineConfig (ver nota de cabecera).
let ocrPageTimeoutMs = 60_000;

interface LocalConfigShape {
  readonly workerPool?: { readonly timeouts?: { readonly "ocr-page"?: number } };
}

startWorkerEntry({
  workerId: "ocr",
  jobType: "ocr-page",
  capabilities: { maxPageBatchSize: 8 },

  applyConfig(config) {
    // Cast de frontera de transporte (ADR-019): INIT.config es unknown a este
    // nivel; el entry-point de cada motor lo afina a los campos que necesita.
    const candidate = config as LocalConfigShape | null | undefined;
    const timeout = candidate?.workerPool?.timeouts?.["ocr-page"];
    if (timeout !== undefined) ocrPageTimeoutMs = timeout;
  },

  run(payload, ctx) {
    // Cast de frontera de transporte (ADR-019): RUN.payload es unknown a este
    // nivel; el entry-point lo afina a OcrPagePayload (03_Data_Model.md §18).
    return kernelRecognize(payload as OcrPagePayload, {
      timeoutMs: ocrPageTimeoutMs,
      abortSignal: ctx.abortSignal,
    });
  },

  dispose() {
    void kernelDispose();
  },
});
