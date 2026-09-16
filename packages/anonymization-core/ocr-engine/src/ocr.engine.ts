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
 *
 * `OcrJobPool.dispatch` devuelve `Promise<unknown>` y su resultado se
 * decodifica con `decodeKernelOcrResult` antes de tocarlo (ADR-055 §2, PR
 * preventivo — este motor nunca tuvo el bug de ADR-055 Contexto §1, que fue
 * exclusivo de `ner-engine`). A diferencia de NER, una forma no reconocida
 * ACÁ se trata como un fallo más de la página en curso (mismo camino que
 * `OcrPageFailedError`: `OCR_PAGE_FAILED` se emite y `processPages` continúa
 * con las demás páginas) en vez de abortar el batch completo. La razón: NER
 * escaló porque su único síntoma era `NER_FINISHED` con `occurrenceCount: 0`
 * — nada distinguía "no había entidades" de "el sobre venía roto". OCR ya
 * emite `OCR_PAGE_FAILED` (evento observable, `Contracts.md` §8) por
 * cualquier fallo de página, con el detalle de la forma recibida embebido en
 * `error.details.reason` (ver comentario de `decodeKernelOcrResult` más
 * abajo) — un sobre roto en OCR nunca se disfraza de resultado sano, así que
 * no hace falta la maquinaria adicional de
 * `NerDispatchEnvelopeError`/`NerDispatchDecodeFailure` (ADR-055 §5 exige que
 * la falla "no se trague en silencio", no que se escale a nivel de
 * documento).
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
  type BoundingBox,
  type EncodedPageImage,
  type EngineContext,
  type IEngine,
  type OcrPagePayload,
  type OcrOrientationPayload,
  type OcrOrientationResult,
  type Word,
} from "@anonly/shared";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "./ocr.errors.js";
import type { OcrImageProducer, OcrPageInput, OcrPageOutput, OcrPageRequest } from "./ocr.types.js";
import type { KernelOcrResult } from "./worker/kernel.js";
import type { OrientationKernel } from "./worker/orientation-kernel.js";

/*
 * ADR-099: el kernel se importa **dinámicamente**.
 *
 * `worker/kernel.js` importa `tesseract.js` a nivel de módulo. Con un import
 * estático acá, esta clase —que el façade instancia siempre, en el arranque—
 * arrastraba Tesseract entero al chunk inicial de la app, incluso para un
 * documento sin una sola página escaneada.
 *
 * La promesa se cachea, así que el módulo se evalúa una sola vez; y
 * `dispose()` no lo carga si nunca hizo falta (ver su uso).
 */
// El tipo del módulo sale de inferir el `import()`, no de anotarlo:
// `typeof import(...)` en posición de tipo lo prohíbe
// `@typescript-eslint/consistent-type-imports`.
function importOcrKernel() {
  return import("./worker/kernel.js");
}

let kernelModule: ReturnType<typeof importOcrKernel> | undefined;

function loadOcrKernel(): ReturnType<typeof importOcrKernel> {
  kernelModule ??= importOcrKernel();
  return kernelModule;
}

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

// ADR-145 §2: estimación SERIALIZADA de cuánto pesa el depósito de palabras
// de una página — no RAM. El tamaño real de un objeto JS no es observable ni
// portable; lo único que un límite por bytes necesita es que la estimación
// crezca con la entrada y nunca sea cero para datos no vacíos. El overhead
// fijo por palabra existe solo para garantizar esa segunda propiedad, no
// para aproximar el costo real de un objeto V8.
const UTF16_BYTES_PER_UNIT = 2; // `text`/`source`: 2 bytes por unidad de código.
const NUMERIC_FIELD_BYTES = 8; // bbox.x/y/width/height, pageIndex, confidence, bbox.rotation.
const WORD_OVERHEAD_BYTES = 32; // fijo, documentado — no una medición de RAM.

/**
 * ADR-145 §2: tamaño serializado estimado del depósito de palabras de una
 * página (`ctx.cache.set("ocr-words:...", words, estimateWordsBytes(words))`).
 * Cero solo para `words.length === 0` (una página sin datos que depositar);
 * cualquier palabra real suma al menos `WORD_OVERHEAD_BYTES`.
 */
export function estimateWordsBytes(words: ReadonlyArray<Word>): number {
  let total = 0;
  for (const word of words) {
    total += WORD_OVERHEAD_BYTES;
    total += word.text.length * UTF16_BYTES_PER_UNIT;
    total += word.source.length * UTF16_BYTES_PER_UNIT;
    // bbox.x, bbox.y, bbox.width, bbox.height, pageIndex, confidence.
    total += 6 * NUMERIC_FIELD_BYTES;
    if (word.bbox.rotation !== undefined) total += NUMERIC_FIELD_BYTES;
  }
  return total;
}

// ─── Puerto interno de despacho (ADR-045 §2, espejo exacto de
// RenderJobPool/RenderDispatchParams en render-engine/src/render.engine.ts).
// No exportado desde index.ts — detalle de wiring interno, mismo criterio
// que RenderJobPool. ───

// `dispatch` deja de ser genérico y devuelve `Promise<unknown>` (ADR-055 §2):
// el parámetro de tipo `<T>` que tenía antes era una afirmación que el
// compilador no podía verificar — del otro lado de `run()` puede haber
// cruzado un `postMessage` real. Con `unknown`, el compilador obliga a pasar
// por `decodeKernelOcrResult` (más abajo) antes de desestructurar
// `words`/`confidence`: no hay otra forma de escribir el consumidor.
interface OcrDispatchParams {
  readonly run: () => Promise<unknown>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
  /** ADR-079 §2: buffers de `payload` que el pool transfiere en vez de clonar. */
  readonly transferList?: ReadonlyArray<Transferable>;
}

interface OcrJobPool {
  dispatch(params: OcrDispatchParams): Promise<unknown>;
  /**
   * ADR-157 §1bis: termina los workers vivos del pool sin disponerlo — el
   * pool sigue usable, el próximo `dispatch` lo reconstruye perezoso
   * (ADR-080). Espejo exacto de `WorkerPool.releaseIdleWorkers()`, mismo
   * nombre y misma guarda (no hace nada si el pool no está ocioso).
   */
  releaseIdleWorkers(): void;
}

type OcrOrientationPool = OcrJobPool;

/**
 * Fallback in-process trivial: sin `OcrPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (el único loop de retry es el de
 * `processPage`). Es el comportamiento de este motor antes de ADR-045
 * (ADR-035 §1) — el que los tests existentes de este paquete ya esperan
 * (`new OcrEngine()` sin argumento). El resultado de `run()` (el
 * `KernelOcrResult` pelado que produce `kernelRecognize`) pasa igual por
 * `decodeKernelOcrResult` en el call site — es la prueba de paridad entre los
 * dos caminos (ADR-055 §2): a diferencia de NER, acá el camino remoto y el
 * in-process producen exactamente la misma forma (`worker/entry.ts` postea
 * `result` pelado, sin sobre, ver su comentario de cabecera).
 */
const IMMEDIATE_POOL: OcrJobPool = {
  dispatch: (params: OcrDispatchParams): Promise<unknown> => params.run(),
  // Sin pool real no hay ningún `WorkerLike` que terminar — no-op inocuo.
  releaseIdleWorkers: (): void => undefined,
};

function createImmediateOrientationPool(): OcrOrientationPool {
  interface PendingOrientation {
    readonly params: OcrDispatchParams;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason: unknown) => void;
    readonly onAbort: () => void;
  }
  const pending: PendingOrientation[] = [];
  let running = false;

  const pump = (): void => {
    if (running) return;
    const next = pending.shift();
    if (next === undefined) return;
    running = true;
    void next.params
      .run()
      .then(next.resolve, next.reject)
      .finally(() => {
        next.params.signal.removeEventListener("abort", next.onAbort);
        running = false;
        pump();
      });
  };

  return {
    dispatch: (params: OcrDispatchParams): Promise<unknown> => {
      if (params.signal.aborted) return Promise.reject(new CancelledError("ocr-orient"));
      return new Promise<unknown>((resolve, reject) => {
        const entry: PendingOrientation = {
          params,
          resolve,
          reject,
          onAbort: (): void => {
            const index = pending.indexOf(entry);
            if (index >= 0) {
              pending.splice(index, 1);
              reject(new CancelledError("ocr-orient"));
            }
          },
        };
        pending.push(entry);
        params.signal.addEventListener("abort", entry.onAbort, { once: true });
        pump();
      });
    },
    releaseIdleWorkers: (): void => undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Presupuesto de bytes en vivo (ADR-143 §3/§6) ───

// 05_Worker_Architecture.md §6.3 usa el mismo intervalo para
// `WorkerPool.waitForCapacity`; se reutiliza acá por el mismo motivo
// (consistencia, riesgo bajo) — no es una medición, es el paso de polling.
const BUDGET_POLL_INTERVAL_MS = 10;

/**
 * ADR-143 §3: reserva atómica de bytes RGBA "en vivo" antes de rasterizar,
 * con espera cancelable (§6: "la espera por presupuesto se despierta con la
 * señal, no hay espera no cancelable"). El caller filtra antes cualquier
 * `bytes > limitBytes` (§4, "una página que no entra falla, no se encoge") —
 * `reserve` asume que la cantidad pedida cabe sola y solo espera turno frente
 * a las demás reservas vivas.
 */
class LiveImageBudget {
  private usedBytes = 0;

  constructor(private readonly limitBytes: number) {}

  async reserve(bytes: number, documentId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new CancelledError(documentId);
      if (this.usedBytes + bytes <= this.limitBytes) {
        this.usedBytes += bytes;
        return;
      }
      await this.waitForChangeOrAbort(signal);
    }
  }

  release(bytes: number): void {
    this.usedBytes -= bytes;
  }

  private waitForChangeOrAbort(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, BUDGET_POLL_INTERVAL_MS);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// ─── Decoder del sobre `COMPLETED.result` (ADR-055 §2-§4) ───
//
// `OcrJobPool.dispatch` devuelve `Promise<unknown>`: no hay forma de
// desestructurar `words`/`confidence` sin pasar por acá primero. A diferencia
// de NER, `worker/entry.ts:96` postea `result` pelado —el `KernelOcrResult`
// que produce `kernelRecognize` tal cual, sin sobre adicional (ver su
// comentario "ADR-042: COMPLETED.result es unknown a nivel de transporte —
// compila directo, sin cast")— y el camino in-process invoca el mismo
// `kernelRecognize`: una sola forma legítima, no una unión. Ante cualquier
// otra forma **lanza** `InvalidInputError` (ADR-055 §3): devolver
// `[]`/`undefined`/un default en silencio es exactamente el modo de falla que
// este decoder cierra — el que dejó a NER sin detectar ninguna entidad en
// producción durante semanas (ADR-055, Contexto §1).

const WORD_SOURCE_VALUES: ReadonlySet<string> = new Set(["pdf", "ocr"]);

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!isRecord(value)) return false;
  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

function isWord(value: unknown): value is Word {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === "string" &&
    isBoundingBox(value.bbox) &&
    typeof value.pageIndex === "number" &&
    typeof value.confidence === "number" &&
    typeof value.source === "string" &&
    WORD_SOURCE_VALUES.has(value.source)
  );
}

function isWordArray(value: unknown): value is ReadonlyArray<Word> {
  return Array.isArray(value) && value.every(isWord);
}

function isKernelOcrResult(value: unknown): value is KernelOcrResult {
  return isRecord(value) && isWordArray(value.words) && typeof value.confidence === "number";
}

/**
 * Detalle legible de una forma no reconocida, para el `details` de
 * `InvalidInputError` — nunca el contenido del documento (Code_Standards.md
 * §9: "Nunca loguear contenido del documento"), solo la forma del valor.
 */
function describeDispatchResultShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isRecord(value)) return `object(keys=[${Object.keys(value).join(", ")}])`;
  return typeof value;
}

/**
 * Decodifica el `Promise<unknown>` que resuelve `OcrJobPool.dispatch`
 * (ADR-055 §2): la única forma válida es `KernelOcrResult`
 * (`{ words: Word[]; confidence: number }`), idéntica en el camino remoto y
 * en el in-process (ver comentario de `IMMEDIATE_POOL` más arriba). Cualquier
 * otra forma lanza `InvalidInputError` (ADR-055 §3) en vez de devolver un
 * default en silencio.
 */
function decodeKernelOcrResult(dispatchResult: unknown): KernelOcrResult {
  if (isKernelOcrResult(dispatchResult)) return dispatchResult;
  const receivedShape = describeDispatchResultShape(dispatchResult);
  throw new InvalidInputError(
    "OcrJobPool.dispatch() resolvió con una forma no reconocida: se esperaba " +
      "{ words: Word[], confidence: number } (KernelOcrResult, worker/kernel.ts) " +
      "— misma forma en el camino remoto y en el in-process (ADR-055 §2). " +
      "Devolver un default en silencio está prohibido (ADR-055 §3). " +
      // El texto (no solo `details.receivedShape`) lleva la forma recibida:
      // `toPageFailure` (más abajo) envuelve este error en un
      // `OcrPageFailedError` copiando solo `.message` a `details.reason` —
      // sin esto, `OCR_PAGE_FAILED.error.details.reason` perdería la forma
      // recibida al cruzar esa envoltura.
      `Forma recibida: ${receivedShape}.`,
    { engineId: EngineId.Ocr, receivedShape },
  );
}

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

function normalizeModelMissing(err: unknown): OcrModelMissingError | null {
  if (err instanceof OcrModelMissingError) return err;
  if (!(err instanceof EngineError) || err.code !== EngineErrorCode.OCR_MODEL_MISSING) return null;
  const languagesValue = err.details.languages;
  const languages = Array.isArray(languagesValue)
    ? languagesValue.filter((value): value is string => typeof value === "string")
    : [];
  const reason = typeof err.details.reason === "string" ? err.details.reason : err.message;
  return new OcrModelMissingError(languages, reason);
}

export class OcrEngine implements IEngine {
  readonly id = EngineId.Ocr;

  private readonly pool: OcrJobPool;
  private readonly orientationPool: OcrOrientationPool;
  private readonly hasInjectedRecognitionPool: boolean;
  private orientationKernel: OrientationKernel | null = null;
  private orientationKernelPromise: Promise<OrientationKernel> | null = null;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  private activeProcessPages = 0;
  private activeProcessSessions = 0;
  private activeProcessBranches = 0;
  private activeDrainResolvers: Array<() => void> = [];
  private cleanupPromise: Promise<void> | null = null;
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
  constructor(pool?: OcrJobPool, orientationPool?: OcrOrientationPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
    this.hasInjectedRecognitionPool = pool !== undefined;
    this.orientationPool = orientationPool ?? createImmediateOrientationPool();
  }

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("OCR Engine initialized");
    return Promise.resolve();
  }

  async processPage(input: OcrPageInput, ctx: EngineContext): Promise<OcrPageOutput> {
    this.activeProcessPages += 1;
    try {
      await this.awaitCleanup();
      return await this.processPageInternal(input, ctx);
    } finally {
      this.activeProcessPages -= 1;
      this.resolveActiveDrains();
    }
  }

  private async processPageInternal(
    input: OcrPageInput,
    ctx: EngineContext,
  ): Promise<OcrPageOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Ocr });
    }

    const { documentId, pageIndex, image, languages, dpi } = input;

    // ADR-064 §4: `dpi` es el divisor de la conversión px→pt del kernel
    // (OCR_Engine.md §10). Antes del ADR el valor no se leía y un 0 era
    // inocuo; ahora es una división por cero.
    if (!Number.isFinite(dpi) || dpi <= 0) {
      throw new InvalidInputError(
        `dpi inválido en la página ${pageIndex}: ${dpi}. Debe ser finito y mayor a 0.`,
        { documentId, pageIndex, dpi },
      );
    }

    // ADR-158 §2: la validación de dimensiones pasa a leer el EncodedPageImage
    // (widthPx/heightPx, ya conocidos sin decodificar) en vez de ImageData.
    if (image.widthPx <= 0 || image.heightPx <= 0) {
      throw new InvalidInputError(
        `image inválida en la página ${pageIndex}: widthPx y heightPx deben ser mayores a 0.`,
        { documentId, pageIndex, widthPx: image.widthPx, heightPx: image.heightPx },
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
    const orientationTimeoutMs = ctx.config.workerPool.timeouts["ocr-orient"] ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = ctx.config.workerPool.maxRetries["ocr-page"] ?? DEFAULT_MAX_RETRIES;
    const startedAt = Date.now();

    // El payload transporta la config EFECTIVA (con fallback de default ya
    // resuelto), no `input.languages` crudo: es lo que el kernel debe tener
    // cargado (ADR-045 §3); la restricción per-página ya se validó arriba.
    const basePayload = {
      documentId,
      pageIndex,
      image,
      dpi: input.dpi,
      languages: configuredLanguages,
    } satisfies Omit<OcrPagePayload, "orientation">;

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }

      try {
        const orientationPayload: OcrOrientationPayload = {
          documentId,
          pageIndex,
          image,
          languages: configuredLanguages,
          timeoutMs: orientationTimeoutMs,
        };
        const orientationResult = await this.orientationPool.dispatch({
          run: async () => this.runOrientation(orientationPayload, ctx.abortSignal),
          signal: ctx.abortSignal,
          priority: DISPATCH_PRIORITY,
          payload: orientationPayload,
          maxRetriesOverride: 0,
        });
        const orientation = this.decodeOrientationResult(orientationResult);
        const payload: OcrPagePayload = { ...basePayload, orientation };
        // ADR-045 §2: solo el reconocimiento cruza el puerto.
        // `maxRetriesOverride: 0` — el pool nunca reintenta un `ocr-page`; el
        // único loop de retry es este.
        const dispatchResult = await this.pool.dispatch({
          run: async () =>
            (await loadOcrKernel()).kernelRecognize(payload, {
              timeoutMs,
              abortSignal: ctx.abortSignal,
            }),
          signal: ctx.abortSignal,
          priority: DISPATCH_PRIORITY,
          payload,
          maxRetriesOverride: 0,
          // SIN `transferList`, a propósito (ADR-079 §1, fila corregida;
          // ADR-158 §5: el criterio no cambia con el payload codificado).
          //
          // `image.bytes` (PNG, ADR-158 §2) pesa unos pocos MB por página —
          // mucho menos que el `ImageData` crudo de antes (~35 MB a 300 dpi),
          // pero transferirlo seguiría siendo un error por la misma razón de
          // fondo: el emisor no es solo el host — **es este loop**. `payload`
          // se construye una vez arriba y se re-despacha en cada intento, así
          // que el primer transfer deja el `ArrayBuffer` detachado
          // (`byteLength` 0) y el segundo lanza `DataCloneError: Cannot
          // transfer object of unsupported type`. O sea que transferir acá
          // MATA el reintento — justo el que `normalizeTimeout` existe para
          // habilitar.
          //
          // Copiar el buffer para conservar una fuente de reintento cuesta
          // ahora unos pocos MB en vez de decenas: se clona, como antes, pero
          // más barato.
        });
        // ADR-055 §2: `dispatchResult` es `unknown` — decodeKernelOcrResult es
        // el único paso permitido antes de desestructurar `words`/`confidence`
        // (nunca un cast a ciegas). Una forma no reconocida lanza acá mismo y
        // cae en el catch de abajo, que la trata como cualquier otro fallo no
        // recuperable de ESTA página (ver comentario de cabecera sobre por qué
        // no se escala a nivel de `processPages`, a diferencia de NER).
        const result = decodeKernelOcrResult(dispatchResult);
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
        // ADR-014 §1 literal y elimina la carrera EVENT/COMPLETED. ADR-145
        // §2/§4: el tercer argumento no cambia ese orden, solo hace que la
        // entrada cuente contra el límite de bytes de la LRU en vez de
        // contar como 0 (el agujero de contabilidad que ADR-145 cierra).
        ctx.cache.set(cacheKey(documentId, pageIndex), words, estimateWordsBytes(words));
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
        const modelMissing = normalizeModelMissing(err);
        if (modelMissing !== null) throw modelMissing;
        // Cualquier otro resultado del despacho (éxito de carga, falla de
        // reconocimiento) implica que el modelo sí quedó cargado.
        this.modelWarm = true;

        const normalized = normalizeTimeout(
          err,
          documentId,
          pageIndex,
          err instanceof EngineError && err.code === EngineErrorCode.OCR_TIMEOUT
            ? orientationTimeoutMs
            : timeoutMs,
        );
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

  /**
   * ADR-143 §1: entrada nueva — descriptores livianos, sin imagen. Pide cada
   * `ImageData` recién cuando un consumidor tiene lugar (§3), en vez de que
   * el caller materialice todo el set por adelantado (`processPages` de
   * abajo, que ahora es el caso particular "la imagen ya está en memoria").
   *
   * Una sesión lógica (§2): `OCR_STARTED`/`OCR_FINISHED` se emiten una vez
   * acá, nunca por minilote. Por página se conserva la secuencia exacta de
   * ADR-045 (`processPage`, sin tocar).
   */
  async processSession(
    requests: ReadonlyArray<OcrPageRequest>,
    produce: OcrImageProducer,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<OcrPageOutput>> {
    this.activeProcessSessions += 1;
    try {
      await this.awaitCleanup();
      return await this.processSessionInternal(requests, produce, ctx);
    } finally {
      this.activeProcessSessions -= 1;
      this.resolveActiveDrains();
    }
  }

  private async processSessionInternal(
    requests: ReadonlyArray<OcrPageRequest>,
    produce: OcrImageProducer,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<OcrPageOutput>> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (requests == null) {
      throw new InvalidInputError("requests es null o undefined.", { engineId: EngineId.Ocr });
    }

    const documentId = requests[0]?.documentId ?? "";
    const pagesToProcess = requests.map((r) => r.pageIndex);
    const modelAlreadyLoaded = this.modelWarm;
    const startedAt = Date.now();

    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_STARTED, {
      documentId,
      pagesToProcess,
      ...(modelAlreadyLoaded ? {} : { modelLoading: true }),
    });

    /*
     * ADR-101/ADR-143 §3: hasta `ocrPoolSize` descriptores en vuelo a la vez,
     * cada uno con a lo sumo una imagen viva. El límite sale de `ocrPoolSize`,
     * que ya se adapta al equipo (`config.ts`: 1 en `lowResource`, 2 si no).
     */
    const budget = new LiveImageBudget(ctx.config.ocr.maxLiveImageBytes);
    const configuredPoolSize = ctx.config.workerPool.ocrPoolSize;
    const concurrency =
      this.hasInjectedRecognitionPool && configuredPoolSize === 2
        ? Math.min(3, requests.length)
        : Math.min(configuredPoolSize, requests.length);
    // Por índice, no por orden de llegada: con varios descriptores en vuelo
    // terminan desordenados, y `outputs` tiene que respetar el orden recibido.
    const slots: (OcrPageOutput | undefined)[] = new Array<OcrPageOutput | undefined>(
      requests.length,
    );
    let nextIndex = 0;

    const drainQueue = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const request = requests[index];
        if (request === undefined) return;
        // ADR-143 §6: al abortar, se deja de pedir descriptores nuevos.
        if (ctx.abortSignal.aborted) {
          throw new CancelledError(documentId);
        }
        slots[index] = await this.processOneRequest(request, produce, budget, ctx);
      }
    };

    const runBranch = async (): Promise<void> => {
      this.activeProcessBranches += 1;
      try {
        await drainQueue();
      } finally {
        this.activeProcessBranches -= 1;
        this.resolveActiveDrains();
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runBranch()));
    const outputs: OcrPageOutput[] = slots.filter(
      (output): output is OcrPageOutput => output !== undefined,
    );

    const durationMs = Date.now() - startedAt;
    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_FINISHED, {
      documentId,
      durationMs,
      ...(modelAlreadyLoaded ? {} : { modelDownloaded: true }),
    });

    return outputs;
  }

  /**
   * Un descriptor de `processSession`, de punta a punta: presupuesto →
   * producir → `processPage`. Nunca lanza salvo `CancelledError` u
   * `OcrModelMissingError` (mismo criterio que el `drainQueue` de antes de
   * ADR-143): cualquier otro fallo ya emitió `OCR_PAGE_FAILED` y devuelve
   * `undefined` para que la sesión siga con las demás páginas.
   */
  private async processOneRequest(
    request: OcrPageRequest,
    produce: OcrImageProducer,
    budget: LiveImageBudget,
    ctx: EngineContext,
  ): Promise<OcrPageOutput | undefined> {
    // ADR-143 §4: una página que no entra por sí sola falla, no se encoge.
    if (request.estimatedBytes > ctx.config.ocr.maxLiveImageBytes) {
      this.reportPageFailure(
        ctx,
        request.documentId,
        request.pageIndex,
        new OcrPageFailedError(
          request.documentId,
          request.pageIndex,
          `La imagen estimada (${request.estimatedBytes} bytes) supera ocr.maxLiveImageBytes ` +
            `(${ctx.config.ocr.maxLiveImageBytes} bytes) por sí sola; no se reduce el DPI ni se ` +
            "recorta en silencio (ADR-143 §4).",
        ),
      );
      return undefined;
    }

    // ADR-143 §3/§5: reserva antes de producir, se libera cuando la página se
    // asienta (éxito, fallo definitivo o cancelación) — nunca antes.
    await budget.reserve(request.estimatedBytes, request.documentId, ctx.abortSignal);
    try {
      let image: EncodedPageImage;
      try {
        image = await produce(request, ctx.abortSignal);
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        // ADR-143 §4: un fallo del productor (Render) recibe el mismo
        // tratamiento que un fallo de página — OCR no reintenta la
        // producción, el retry del pool de Render ya corrió.
        this.reportPageFailure(
          ctx,
          request.documentId,
          request.pageIndex,
          this.toProducerFailure(err, request),
        );
        return undefined;
      }

      const input: OcrPageInput = {
        documentId: request.documentId,
        pageIndex: request.pageIndex,
        image,
        dpi: request.dpi,
        languages: request.languages,
      };
      try {
        return await this.processPage(input, ctx);
      } catch (err: unknown) {
        if (err instanceof CancelledError || err instanceof OcrModelMissingError) {
          throw err;
        }
        // OcrPageFailedError: ya emitió OCR_PAGE_FAILED dentro de processPage.
        // Se continúa con las demás páginas (OCR_Engine.md §13 caso 6).
        ctx.logger.warn(
          `OCR de la página ${request.pageIndex} falló; se continúa con las demás páginas.`,
          { documentId: request.documentId, pageIndex: request.pageIndex },
        );
        return undefined;
      }
    } finally {
      budget.release(request.estimatedBytes);
    }
  }

  /** Emite `OCR_PAGE_FAILED` y avisa por log — para los dos fallos que `processPage` nunca ve (§4). */
  private reportPageFailure(
    ctx: EngineContext,
    documentId: string,
    pageIndex: number,
    failure: OcrPageFailedError,
  ): void {
    ctx.bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, {
      documentId,
      pageIndex,
      error: failure.serialize(),
    });
    ctx.logger.warn(`OCR de la página ${pageIndex} falló; se continúa con las demás páginas.`, {
      documentId,
      pageIndex,
    });
  }

  /** ADR-143 §4: "con el `code` del error original en `details`". */
  private toProducerFailure(err: unknown, request: OcrPageRequest): OcrPageFailedError {
    const reason = err instanceof Error ? err.message : String(err);
    const originalCode = err instanceof EngineError ? err.code : undefined;
    return new OcrPageFailedError(
      request.documentId,
      request.pageIndex,
      `Falló la producción de la imagen (Render): ${reason}`,
      originalCode === undefined ? undefined : { originalCode },
    );
  }

  /**
   * ADR-143 §1: se conserva con su firma y semántica actuales — lo usan los
   * tests de contrato y cualquier caller que ya tenga las imágenes en
   * memoria. Ahora es el caso particular de `processSession` cuyo productor
   * devuelve la imagen que ya recibió, con `estimatedBytes: 0` porque no hay
   * nada que reservar: la imagen ya está viva pase lo que pase (§3 gobierna
   * lo que se produce bajo demanda, no lo que el caller ya materializó).
   * Ningún consumidor existente cambia.
   */
  async processPages(
    inputs: ReadonlyArray<OcrPageInput>,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<OcrPageOutput>> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (inputs == null) {
      throw new InvalidInputError("inputs es null o undefined.", { engineId: EngineId.Ocr });
    }

    // Map por identidad del objeto `request` (no por documentId/pageIndex):
    // `processSession` siempre invoca `produce` con el MISMO objeto que
    // recibió en `requests`, así que no hace falta una clave compuesta ni
    // hay riesgo de colisión si dos inputs compartieran documentId/pageIndex.
    const imageByRequest = new Map<OcrPageRequest, EncodedPageImage>();
    const requests: OcrPageRequest[] = inputs.map((input) => {
      const request: OcrPageRequest = {
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        dpi: input.dpi,
        languages: input.languages,
        estimatedBytes: 0,
      };
      imageByRequest.set(request, input.image);
      return request;
    });

    const produce: OcrImageProducer = (request) => {
      const image = imageByRequest.get(request);
      // Invariante interna: `processSession` reenvía el mismo objeto que le
      // entregamos en `requests`, así que el Map siempre resuelve.
      if (image === undefined) {
        throw new InvalidInputError(
          "processSession invocó produce() con un OcrPageRequest desconocido.",
          { engineId: EngineId.Ocr, documentId: request.documentId, pageIndex: request.pageIndex },
        );
      }
      return Promise.resolve(image);
    };

    return this.processSession(requests, produce, ctx);
  }

  /**
   * ADR-157 §1bis: da de baja los workers vivos del `OcrPool` sin disponer
   * el motor — no terminal, a diferencia de `dispose()`. El único caller es
   * `Orchestrator.runOcrStage`, al terminar la etapa: retener Tesseract
   * (~300 MB) durante toda la detección posterior (NER) no se justifica
   * cuando OCR ya no tiene trabajo, y el idle-dispose de ADR-080 (60 s)
   * llega tarde para este pool — transcurre justo durante esa detección.
   *
   * Delega en `this.pool.releaseIdleWorkers()`, que trae su propia guarda
   * (`WorkerPool`, ADR-080): no hace nada si el pool no está ocioso —
   * `terminate()` no dispara `error`, así que matar un worker con un job en
   * vuelo dejaría esa promesa colgada para siempre. El pool sigue usable
   * después: el próximo `processPage`/`processSession` (p. ej. un
   * `reanalyze` que cambie `ocr.languages`) lo reconstruye perezoso,
   * pagando la recarga del modelo como costo declarado.
   */
  releaseIdleWorkers(): void {
    if (
      this.activeProcessPages !== 0 ||
      this.activeProcessSessions !== 0 ||
      this.activeProcessBranches !== 0
    )
      return;
    const cleanup = async (): Promise<void> => {
      this.pool.releaseIdleWorkers();
      this.orientationPool.releaseIdleWorkers();
      const kernel = this.orientationKernel;
      this.orientationKernel = null;
      this.orientationKernelPromise = null;
      if (kernel !== null) await kernel.dispose();
      if (kernelModule !== undefined) await (await kernelModule).kernelDispose();
      this.modelWarm = false;
    };
    const pending = this.cleanupPromise === null ? cleanup() : this.cleanupPromise.then(cleanup);
    this.cleanupPromise = pending.catch(() => undefined);
    void pending.catch(() => undefined);
  }

  private async awaitCleanup(): Promise<void> {
    if (this.cleanupPromise !== null) {
      await this.cleanupPromise;
      this.cleanupPromise = null;
    }
  }

  private waitForNoActivePages(): Promise<void> {
    if (
      this.activeProcessPages === 0 &&
      this.activeProcessSessions === 0 &&
      this.activeProcessBranches === 0
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.activeDrainResolvers.push(resolve));
  }

  private resolveActiveDrains(): void {
    if (
      this.activeProcessPages !== 0 ||
      this.activeProcessSessions !== 0 ||
      this.activeProcessBranches !== 0
    )
      return;
    const resolvers = this.activeDrainResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.waitForNoActivePages();
    await this.awaitCleanup();
    this.pool.releaseIdleWorkers();
    this.orientationPool.releaseIdleWorkers();
    // ADR-045 §2: no pasa por pool.dispatch (dispose no es la operación del
    // puerto) — libera directo el kernel local. La liberación server-side en
    // un OcrWorker real llega por el mensaje genérico DISPOSE del protocolo.
    // Si el kernel nunca se cargó no hay nada que liberar — y cargarlo para
    // liberarlo anularía el punto de ADR-099.
    if (kernelModule !== undefined) await (await kernelModule).kernelDispose();
    if (this.orientationKernelPromise !== null) {
      await this.orientationKernelPromise.catch(() => undefined);
    }
    if (this.orientationKernel !== null) await this.orientationKernel.dispose();
    this.orientationKernel = null;
    this.orientationKernelPromise = null;
    this.modelWarm = false;
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
  }

  private async runOrientation(
    payload: OcrOrientationPayload,
    signal: AbortSignal,
  ): Promise<OcrOrientationResult> {
    if (this.orientationKernelPromise === null) {
      this.orientationKernelPromise = import("./worker/orientation-kernel.js").then((module) =>
        module.createOrientationKernel(),
      );
    }
    this.orientationKernel = await this.orientationKernelPromise;
    return this.orientationKernel.detect(payload, signal);
  }

  private decodeOrientationResult(value: unknown): OcrOrientationResult["orientation"] {
    if (typeof value !== "object" || value === null || !("orientation" in value)) {
      throw new InvalidInputError("Resultado de orientación inválido.", {
        engineId: EngineId.Ocr,
      });
    }
    const orientation = (value as { readonly orientation: unknown }).orientation;
    if (orientation !== 0 && orientation !== 90 && orientation !== 180 && orientation !== 270) {
      throw new InvalidInputError("Ángulo de orientación inválido.", {
        engineId: EngineId.Ocr,
        orientation,
      });
    }
    return orientation;
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
