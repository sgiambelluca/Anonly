/**
 * `OcrEngine` — clase host-side completa (ADR-045 §1, espejo de
 * `RenderEngine`/ADR-043): loop secuencial por página, retry/timeout,
 * depósito en `ctx.cache` y emisión de los cuatro eventos. El reconocimiento
 * en sí (tesseract.js) vive en `./worker/kernel.ts`, invocado a través de un
 * puerto interno `OcrJobPool` — con pool real, cruza a un Web Worker de SO
 * (`./worker/entry.ts`); sin ella (fallback in-process, ADR-035), invoca el
 * mismo kernel directo.
 *
 * La secuencia por página es una sola ruta de código host-side: resultado
 * del kernel → `ctx.cache.set` → `emit OCR_PAGE_FINISHED` — restaura ADR-014
 * §1 literal ("las Word[] las deposita el lado host del OcrPool") y elimina
 * por construcción la carrera EVENT/COMPLETED que motivó ADR-045.
 */
import {
  CancelledError,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type IEngine,
  type OcrPagePayload,
} from "@anonly/shared";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "./ocr.errors.js";
import type { OcrPageInput, OcrPageOutput } from "./ocr.types.js";
import { kernelDispose, kernelRecognize, type KernelOcrResult } from "./worker/kernel.js";

const DEFAULT_LANGUAGES: ReadonlyArray<string> = ["spa", "eng"];
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
// OCR_Engine.md §13 caso 3: "texto muy pequeño (calidad baja): confidence < 0.5".
const LOW_CONFIDENCE_THRESHOLD = 0.5;
// 05_Worker_Architecture.md §6.2 ("ocr-page, página visible" — la
// distinción visible/no-visible, 90/40, nunca se implementó: el Orchestrator
// ya despachaba el batch completo con 90 fijo antes de ADR-045). Preservado
// tal cual al mover el despacho de por-batch a por-página.
const DISPATCH_PRIORITY = 90;

function cacheKey(documentId: string, pageIndex: number): string {
  return `ocr-words:${documentId}:${pageIndex}`;
}

// ─── Puerto interno de despacho (ADR-045 §2, espejo exacto de
// RenderJobPool/RenderDispatchParams en render-engine/src/render.engine.ts).
// No exportado desde index.ts — detalle de wiring interno, mismo criterio
// que RenderJobPool. ───

interface OcrDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

interface OcrJobPool {
  dispatch<T>(params: OcrDispatchParams<T>): Promise<T>;
}

/**
 * Fallback in-process trivial: sin `OcrPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (el único loop de retry es el de
 * `processPage`). Es el comportamiento de este motor antes de ADR-045
 * (ADR-035 §1) — el que los tests existentes de este paquete ya esperan
 * (`new OcrEngine()` sin argumento).
 */
const IMMEDIATE_POOL: OcrJobPool = {
  dispatch: <T>(params: OcrDispatchParams<T>): Promise<T> => params.run(),
};

/**
 * Normaliza cualquier timeout emergente del despacho a `OcrTimeoutError`
 * (ADR-045 §2): un `OcrTimeoutError` local (fallback in-process, lanzado por
 * `kernel.ts#recognizeWithTimeout`) ya lo es. Uno que cruzó un worker remoto
 * llega deserializado (`EngineError.deserialize`, `Contracts.md` §4) como una
 * instancia genérica con el `code` correcto pero que NO es
 * `instanceof OcrTimeoutError` — sin esta normalización, el loop de retry de
 * abajo (`if (!(normalized instanceof OcrTimeoutError)) break;`) trataría un
 * timeout remoto como no-recuperable, cambiando la política de reintentos
 * según haya pool real o fallback.
 */
function normalizeTimeout(
  err: unknown,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): unknown {
  if (err instanceof OcrTimeoutError) return err;
  if (err instanceof EngineError && err.code === EngineErrorCode.OCR_TIMEOUT) {
    return new OcrTimeoutError(documentId, pageIndex, timeoutMs);
  }
  return err;
}

export class OcrEngine implements IEngine {
  readonly id = EngineId.Ocr;

  private readonly pool: OcrJobPool;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  // "Ningún reconocimiento completado aún" (ADR-045 §4) — reemplaza
  // `this.worker !== null` de antes de ADR-045: misma semántica per-instancia
  // (OCR_STARTED.modelLoading/OCR_FINISHED.modelDownloaded), pero el estado
  // del worker de tesseract ahora vive en el kernel, no en la instancia.
  private modelWarm = false;

  /**
   * `pool` (ADR-045 §2): inyectada por el façade en `createCore`
   * (`create-core.ts`, espejo de `new RenderEngine(renderPool)`). Sin
   * argumento, cae al fallback in-process trivial (`IMMEDIATE_POOL`) — el
   * comportamiento que este motor tenía antes de ADR-045, usado por sus
   * propios tests.
   */
  constructor(pool?: OcrJobPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
  }

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("OCR Engine initialized");
    return Promise.resolve();
  }

  async processPage(input: OcrPageInput, ctx: EngineContext): Promise<OcrPageOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Ocr });
    }

    const { documentId, pageIndex, imageData, languages } = input;

    if (imageData.width <= 0 || imageData.height <= 0) {
      throw new InvalidInputError(
        `imageData inválida en la página ${pageIndex}: width y height deben ser mayores a 0.`,
        { documentId, pageIndex, width: imageData.width, height: imageData.height },
      );
    }

    if (pageIndex < 0) {
      throw new InvalidInputError(`pageIndex inválido: ${pageIndex}. Debe ser >= 0.`, {
        documentId,
        pageIndex,
      });
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const configuredLanguages =
      ctx.config.ocr.languages.length > 0 ? ctx.config.ocr.languages : DEFAULT_LANGUAGES;
    this.assertLanguagesRequestable(languages, configuredLanguages, documentId, pageIndex);

    const timeoutMs = ctx.config.workerPool.timeouts["ocr-page"] ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = ctx.config.workerPool.maxRetries["ocr-page"] ?? DEFAULT_MAX_RETRIES;
    const startedAt = Date.now();

    // El payload transporta la config EFECTIVA (con fallback de default ya
    // resuelto), no `input.languages` crudo: es lo que el kernel debe tener
    // cargado (ADR-045 §3); la restricción per-página ya se validó arriba.
    const payload: OcrPagePayload = {
      documentId,
      pageIndex,
      imageData,
      dpi: input.dpi,
      languages: configuredLanguages,
    };

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }

      try {
        // ADR-045 §2: solo el reconocimiento cruza el puerto.
        // `maxRetriesOverride: 0` — el pool nunca reintenta un `ocr-page`; el
        // único loop de retry es este.
        const result = await this.pool.dispatch<KernelOcrResult>({
          run: () => kernelRecognize(payload, { timeoutMs, abortSignal: ctx.abortSignal }),
          signal: ctx.abortSignal,
          priority: DISPATCH_PRIORITY,
          payload,
          maxRetriesOverride: 0,
        });
        // El despacho no lanzó OcrModelMissingError: el modelo quedó cargado
        // (independientemente de si esta página en particular tuvo éxito).
        this.modelWarm = true;

        const { words, confidence } = result;
        const durationMs = Date.now() - startedAt;

        // Caso 3 (§13): páginas con texto detectado pero de baja calidad. Las
        // páginas genuinamente vacías/sin texto (casos 1-2) no disparan este
        // warning: ahí confidence=0 es el resultado normal, no una señal de
        // calidad baja sobre texto real.
        if (words.length > 0 && confidence < LOW_CONFIDENCE_THRESHOLD) {
          ctx.logger.warn(`OCR con confidence baja en la página ${pageIndex}: ${confidence}`, {
            documentId,
            pageIndex,
            confidence,
          });
        }

        // ADR-045 §1: depósito + emisión, en ese orden, host-side — restaura
        // ADR-014 §1 literal y elimina la carrera EVENT/COMPLETED.
        ctx.cache.set(cacheKey(documentId, pageIndex), words);
        ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
          documentId,
          pageIndex,
          wordCount: words.length,
          confidence,
        });

        return { documentId, pageIndex, words, confidence, durationMs };
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        // No recuperable y no es "esta página falló" — es "el modelo no
        // cargó": se propaga tal cual, sin envolver en OcrPageFailedError
        // (mismo criterio que antes de ADR-045: ensureWorkerLoaded corría
        // fuera del loop de retry).
        if (err instanceof OcrModelMissingError) throw err;
        // Cualquier otro resultado del despacho (éxito de carga, falla de
        // reconocimiento) implica que el modelo sí quedó cargado.
        this.modelWarm = true;

        const normalized = normalizeTimeout(err, documentId, pageIndex, timeoutMs);
        lastError = normalized;
        if (!(normalized instanceof OcrTimeoutError)) break; // no recuperable: no reintentar
        // OcrTimeoutError: recuperable, el for reintenta si quedan intentos.
      }
    }

    const failure = this.toPageFailure(lastError, documentId, pageIndex);
    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, {
      documentId,
      pageIndex,
      error: failure.serialize(),
    });
    throw failure;
  }

  async processPages(
    inputs: ReadonlyArray<OcrPageInput>,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<OcrPageOutput>> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (inputs == null) {
      throw new InvalidInputError("inputs es null o undefined.", { engineId: EngineId.Ocr });
    }

    const documentId = inputs[0]?.documentId ?? "";
    const pagesToProcess = inputs.map((i) => i.pageIndex);
    const modelAlreadyLoaded = this.modelWarm;
    const startedAt = Date.now();

    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_STARTED, {
      documentId,
      pagesToProcess,
      ...(modelAlreadyLoaded ? {} : { modelLoading: true }),
    });

    const outputs: OcrPageOutput[] = [];
    for (const input of inputs) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }
      try {
        // Secuencial a propósito (checklist §15.7: "Hito 3: secuencial en el
        // orden recibido, con checkpoint de cancelación entre páginas"; la
        // priorización por visibilidad y el despacho paralelo al pool son
        // del Orchestrator, Hito 9).
        const output = await this.processPage(input, ctx);
        outputs.push(output);
      } catch (err: unknown) {
        if (err instanceof CancelledError || err instanceof OcrModelMissingError) {
          throw err;
        }
        // OcrPageFailedError: ya emitió OCR_PAGE_FAILED dentro de processPage.
        // Se continúa con las demás páginas (OCR_Engine.md §13 caso 6).
        ctx.logger.warn(
          `OCR de la página ${input.pageIndex} falló; se continúa con las demás páginas.`,
          { documentId: input.documentId, pageIndex: input.pageIndex },
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_FINISHED, {
      documentId,
      durationMs,
      ...(modelAlreadyLoaded ? {} : { modelDownloaded: true }),
    });

    return outputs;
  }

  async dispose(): Promise<void> {
    // ADR-045 §2: no pasa por pool.dispatch (dispose no es la operación del
    // puerto) — libera directo el kernel local. La liberación server-side en
    // un OcrWorker real llega por el mensaje genérico DISPOSE del protocolo.
    await kernelDispose();
    this.modelWarm = false;
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
  }

  private assertLanguagesRequestable(
    languages: ReadonlyArray<string>,
    configuredLanguages: ReadonlyArray<string>,
    documentId: string,
    pageIndex: number,
  ): void {
    const missing = languages.filter((lang) => !configuredLanguages.includes(lang));
    if (languages.length === 0 || missing.length > 0) {
      throw new OcrModelMissingError(
        languages,
        `Idioma(s) no soportado(s) por la configuración para la página ${pageIndex} del documento ${documentId}: ` +
          `[${missing.join(", ")}]. Configurados: [${configuredLanguages.join(", ")}].`,
      );
    }
  }

  private toPageFailure(err: unknown, documentId: string, pageIndex: number): OcrPageFailedError {
    // Evita doble-envoltura si el error ya es un OcrPageFailedError (p. ej.
    // "sin contexto 2D de OffscreenCanvas", lanzado por el kernel).
    if (err instanceof OcrPageFailedError) return err;
    const reason = err instanceof Error ? err.message : String(err);
    return new OcrPageFailedError(documentId, pageIndex, reason);
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Ocr);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Ocr);
    }
  }
}
