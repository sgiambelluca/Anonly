import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type IEngine,
  type Word,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "./ocr.errors.js";
import type { OcrPageInput, OcrPageOutput } from "./ocr.types.js";

const DEFAULT_LANGUAGES: ReadonlyArray<string> = ["spa", "eng"];
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
// OCR_Engine.md §13 caso 3: "texto muy pequeño (calidad baja): confidence < 0.5".
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/*
 * ADR-018: assets de Tesseract servidos first-party, nunca desde CDNs de
 * terceros (jsDelivr/GitHub) en runtime. langPath = datos de idioma
 * entrenados (spa.traineddata/eng.traineddata, ~30MB); corePath/workerPath =
 * wasm + script del worker interno de tesseract.js. El mirror real de estos
 * assets (scripts/mirror-assets.ts + assets.lock.json) es un PR aparte
 * (instrucción explícita del humano para este PR: solo los valores de
 * configuración, sin mirror — ver ADR-018 y OCR_Engine.md §15.17).
 */
const TESSERACT_LANG_PATH = "/models/tesseract/";
const TESSERACT_CORE_PATH = "/wasm/tesseract/";
const TESSERACT_WORKER_PATH = "/wasm/tesseract/";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

function cacheKey(documentId: string, pageIndex: number): string {
  return `ocr-words:${documentId}:${pageIndex}`;
}

/*
 * tesseract.js no acepta `ImageData` directamente: su `ImageLike` real
 * (node_modules/tesseract.js/src/index.d.ts) es
 * `string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement |
 * CanvasRenderingContext2D | File | Blob | Buffer | OffscreenCanvas` — sin
 * `ImageData`, a pesar de que varias guías públicas de la librería lo dan
 * por aceptado. `OcrPageInput.imageData: ImageData` es el contrato fijo de
 * OCR_Engine.md §6/§9 (no se puede romper, R-2), así que la conversión vive
 * acá, en la frontera con tesseract.js. `OffscreenCanvas` es global real en
 * todo navegador (el runtime de este motor, ADR-002 "no backend"); los
 * tests mockean tesseract.js completo y no dependen del contenido real de
 * los píxeles, así que instalan un stub mínimo de `OffscreenCanvas` en el
 * entorno `node` de Vitest (ver __tests__/fixtures/test-helpers.ts).
 */
function toTesseractImage(
  imageData: ImageData,
  documentId: string,
  pageIndex: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    // Falla de entorno (sin soporte de contexto 2D), no de Tesseract en sí;
    // se clasifica como fallo de página (misma familia que un error de
    // recognize()), no como OCR_MODEL_MISSING.
    throw new OcrPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas para convertir imageData.",
    );
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/*
 * Copia local del criterio de orden de lectura (OCR_Engine.md §10: "ordenadas
 * por bbox.y asc, luego bbox.x asc"). Mismo criterio que pdf-engine
 * (tolerancia de 1px para "misma línea"), pero NO se importa de
 * @anonly/pdf-engine: P-2 prohíbe que un motor importe a otro en código de
 * producción (la excepción de eslint.config.js para @anonly/*-engine es solo
 * dentro de __tests__). Para OCR la tolerancia es más necesaria que para
 * PDF.js: dos palabras de Tesseract en la misma línea impresa casi nunca
 * comparten el mismo y0 en píxeles exactos (a diferencia de pdf-engine, donde
 * los tokens de un mismo TextItem heredan idéntico y por construcción).
 */
function sortWordsByReadingOrder(words: ReadonlyArray<Word>): Word[] {
  const sorted = [...words];
  sorted.sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 1) return dy;
    return a.bbox.x - b.bbox.x;
  });
  return sorted;
}

// ─── Extracción defensiva del resultado de tesseract.js ───
//
// tesseract.js no tiene un tipo propio publicado en Contracts.md (regla §10:
// "ningún tipo puede referenciar tipos de librerías externas"; wrappers
// propios). En vez de castear el resultado real de recognize() contra un tipo
// local asumido (riesgo real: la forma exacta de Page/Block/Word de
// tesseract.js no está fijada por ningún contrato propio y no se puede
// verificar con certeza total sin acoplarse a una versión concreta), se usan
// guards de runtime sobre `unknown`. Es resiliente a diferencias menores de
// forma entre versiones de la librería, a costa de descartar silenciosamente
// entradas que no matchean la forma esperada (Block > Paragraph > Line > Word,
// ver naptha/tesseract.js docs/api.md — recognize(image, {}, { blocks: true })).

interface ExtractedWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

function toBboxIfValid(value: unknown): ExtractedWord["bbox"] | null {
  if (!isRecord(value)) return null;
  const { x0, y0, x1, y1 } = value;
  if (
    typeof x0 !== "number" ||
    typeof y0 !== "number" ||
    typeof x1 !== "number" ||
    typeof y1 !== "number"
  ) {
    return null;
  }
  return { x0, y0, x1, y1 };
}

function toWordIfValid(value: unknown): ExtractedWord | null {
  if (!isRecord(value)) return null;
  const { text, confidence, bbox } = value;
  const parsedBbox = toBboxIfValid(bbox);
  if (typeof text !== "string" || typeof confidence !== "number" || parsedBbox === null) {
    return null;
  }
  return { text, confidence, bbox: parsedBbox };
}

function extractTesseractWords(data: unknown): ReadonlyArray<ExtractedWord> {
  const words: ExtractedWord[] = [];
  if (!isRecord(data) || !isUnknownArray(data.blocks)) return words;

  for (const block of data.blocks) {
    if (!isRecord(block) || !isUnknownArray(block.paragraphs)) continue;
    for (const paragraph of block.paragraphs) {
      if (!isRecord(paragraph) || !isUnknownArray(paragraph.lines)) continue;
      for (const line of paragraph.lines) {
        if (!isRecord(line) || !isUnknownArray(line.words)) continue;
        for (const wordValue of line.words) {
          const word = toWordIfValid(wordValue);
          if (word !== null) words.push(word);
        }
      }
    }
  }
  return words;
}

function extractPageConfidence(data: unknown): number {
  if (isRecord(data) && typeof data.confidence === "number") {
    return data.confidence;
  }
  return 0;
}

function toWords(data: unknown, pageIndex: number): Word[] {
  const tesseractWords = extractTesseractWords(data);
  const words: Word[] = tesseractWords.map((w) => ({
    text: w.text.normalize("NFC"),
    bbox: {
      x: w.bbox.x0,
      y: w.bbox.y0,
      width: w.bbox.x1 - w.bbox.x0,
      height: w.bbox.y1 - w.bbox.y0,
    },
    pageIndex,
    confidence: clampConfidence(w.confidence / 100),
    source: "ocr" as const,
  }));
  return sortWordsByReadingOrder(words);
}

export class OcrEngine implements IEngine {
  readonly id = EngineId.Ocr;

  private ctx: EngineContext | null = null;
  private worker: TesseractWorker | null = null;
  private loadedLanguages: ReadonlySet<string> = new Set();
  private initialized = false;
  private disposed = false;

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

    await this.ensureWorkerLoaded(ctx);
    this.assertLanguagesLoaded(languages, documentId, pageIndex);

    const timeoutMs = ctx.config.workerPool.timeouts["ocr-page"] ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = ctx.config.workerPool.maxRetries["ocr-page"] ?? DEFAULT_MAX_RETRIES;
    const startedAt = Date.now();

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }

      try {
        const data = await this.recognizeWithTimeout(
          imageData,
          documentId,
          pageIndex,
          timeoutMs,
          ctx.abortSignal,
        );
        const words = toWords(data, pageIndex);
        const confidence = clampConfidence(extractPageConfidence(data) / 100);
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
        lastError = err;
        if (!(err instanceof OcrTimeoutError)) break; // no recuperable: no reintentar
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
    const modelAlreadyLoaded = this.worker !== null;
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
    if (this.worker !== null) {
      const worker = this.worker;
      this.worker = null;
      try {
        await worker.terminate();
      } catch {
        // best-effort: liberar igual el estado interno aunque terminate() falle.
      }
    }
    this.loadedLanguages = new Set();
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
  }

  private async ensureWorkerLoaded(ctx: EngineContext): Promise<void> {
    if (this.worker !== null) return;

    const configuredLanguages =
      ctx.config.ocr.languages.length > 0 ? ctx.config.ocr.languages : DEFAULT_LANGUAGES;

    let worker: TesseractWorker;
    try {
      worker = await createWorker([...configuredLanguages], undefined, {
        langPath: TESSERACT_LANG_PATH,
        corePath: TESSERACT_CORE_PATH,
        workerPath: TESSERACT_WORKER_PATH,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new OcrModelMissingError(configuredLanguages, reason);
    }

    this.worker = worker;
    this.loadedLanguages = new Set(configuredLanguages);
  }

  private assertLanguagesLoaded(
    languages: ReadonlyArray<string>,
    documentId: string,
    pageIndex: number,
  ): void {
    const missing = languages.filter((lang) => !this.loadedLanguages.has(lang));
    if (languages.length === 0 || missing.length > 0) {
      throw new OcrModelMissingError(
        languages,
        `Idioma(s) no cargado(s) en el modelo para la página ${pageIndex} del documento ${documentId}: ` +
          `[${missing.join(", ")}]. Cargados: [${[...this.loadedLanguages].join(", ")}].`,
      );
    }
  }

  private async recognizeWithTimeout(
    imageData: ImageData,
    documentId: string,
    pageIndex: number,
    timeoutMs: number,
    abortSignal: AbortSignal,
  ): Promise<unknown> {
    if (this.worker === null) {
      throw new OcrModelMissingError([], "El worker de Tesseract no está inicializado.");
    }
    const worker = this.worker;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new OcrTimeoutError(documentId, pageIndex, timeoutMs));
      }, timeoutMs);
    });

    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (abortSignal.aborted) {
        reject(new CancelledError(documentId));
        return;
      }
      onAbort = (): void => reject(new CancelledError(documentId));
      abortSignal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      // El callback de progreso de Tesseract (`logger`, configurado en
      // ensureWorkerLoaded a nivel de worker) es el checkpoint documentado en
      // el checklist §15.6; tesseract.js no expone una API pública de
      // cancelación por-job (a diferencia de un WorkerPool real, Hito 9), así
      // que el mecanismo real de "dejar de esperar" es este Promise.race
      // contra el AbortSignal — mismo patrón que el timeout de pdf-engine
      // (parsePageTextWithTimeout): la computación WASM en curso no se
      // interrumpe, el caller simplemente deja de esperarla. SLA estricto
      // < 200ms: Hito 9/11 (ADR-021 §1).
      const result = await Promise.race([
        worker.recognize(toTesseractImage(imageData, documentId, pageIndex), {}, { blocks: true }),
        timeoutPromise,
        abortPromise,
      ]);
      return result.data;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
    }
  }

  private toPageFailure(err: unknown, documentId: string, pageIndex: number): OcrPageFailedError {
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
