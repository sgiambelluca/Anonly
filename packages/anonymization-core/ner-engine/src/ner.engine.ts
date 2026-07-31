/**
 * `NerEngine` — clase host-side completa (ADR-046 §1, tercer espejo de
 * `RenderEngine`/ADR-043 y `OcrEngine`/ADR-045): loop secuencial por página,
 * retry/timeout por página, partición en batches (ADR-024 §2), mapeo de
 * spans a `Occurrence` (bbox) y emisión de los **seis** eventos. La
 * inferencia en sí (`@huggingface/transformers`) vive en `./worker/kernel.ts`,
 * invocada a través de un puerto interno `NerJobPool` — con pool real, cruza
 * a un Web Worker de SO (`./worker/entry.ts`); sin ella (fallback
 * in-process, ADR-035), invoca el mismo kernel directo.
 *
 * La secuencia por página es una sola ruta de código host-side: spans del
 * kernel → `Occurrence[]` (bbox) → `ENTITY_FOUND × N` → `NER_PAGE_FINISHED`
 * — restaura ADR-013 §6 y elimina por construcción la carrera EVENT/COMPLETED
 * que motivó ADR-046 (mismo problema que ADR-043/ADR-045 ya resolvieron para
 * Render/OCR).
 *
 * El ciclo de vida del modelo (que sí ocurre dentro del kernel) cruza por el
 * canal `PROGRESS` del transporte (`NerKernelProgress`, ADR-046 §4), nunca
 * por eventos de dominio: este motor lo traduce en host a
 * `NER_MODEL_LOADING`/`NER_MODEL_READY` (deduplicado por instancia, flag
 * `modelWarm`) y a `ctx.logger.warn` para los reintentos de carga.
 */
import {
  CancelledError,
  DetectionSource,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type BoundingBox,
  type EngineContext,
  type IEngine,
  type NerKernelProgress,
  type NerKernelSpan,
  type NerPagePayload,
  type Occurrence,
  type Serializable,
  type Word,
  type WordSpan,
} from "@anonly/shared";

import {
  NerModelLoadFailedError,
  NerModelMissingError,
  NerPageFailedError,
  NerTimeoutError,
} from "./ner.errors.js";
import type { NerPageInput, NerPageOutput } from "./ner.types.js";
import { kernelClassify, kernelDispose } from "./worker/kernel.js";

// NER_Engine.md §11: "timeout por página (default 20 s)".
const DEFAULT_TIMEOUT_MS = 20_000;
// NER_Engine.md §11: NER_TIMEOUT/NER_PAGE_FAILED "reintentar 1 vez".
const DEFAULT_MAX_RETRIES = 1;
// ADR-023 §2: modelo multilingüe default (reemplaza el placeholder de ADR-006).
const DEFAULT_MODEL_ID = "Xenova/bert-base-multilingual-cased-ner-hrl";
// 05_Worker_Architecture.md §6.2 ("ner-page, página visible"). Preservado tal
// cual al mover el despacho de por-página a por-batch (ADR-046 §2/§3): es el
// valor que el Orchestrator usaba al despachar la etapa completa.
const DISPATCH_PRIORITY = 80;

interface WordMapping {
  readonly bbox: BoundingBox;
  readonly wordSpan: WordSpan;
}

interface WordChunk {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
  readonly words: ReadonlyArray<Word>;
}

/*
 * Mapea un span de caracteres (absoluto, dentro de Page.text) al rango de
 * Word[] que lo cubre, y calcula el bbox unión de esas palabras. Adaptado
 * (no importado — P-2 prohíbe importar otro motor en código de producción)
 * de regex-engine/src/regex.engine.ts (mapSpanToWords): Page.text se
 * construye igual para ambos motores (words.map(w => w.text).join(" "),
 * 03_Data_Model.md §4), así que el mismo algoritmo de reconstrucción de
 * offsets aplica sin cambios.
 */
function mapSpanToWords(
  words: ReadonlyArray<Word>,
  startIndex: number,
  endIndexExclusive: number,
): WordMapping | null {
  let offset = 0;
  let firstWordIndex = -1;
  let lastWordIndex = -1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const wordStart = offset;
    const wordEnd = wordStart + word.text.length;

    if (wordEnd > startIndex && wordStart < endIndexExclusive) {
      if (firstWordIndex === -1) firstWordIndex = i;
      lastWordIndex = i;
    }

    offset = wordEnd + 1; // +1 por el separador " " que usa Page.text.
  }

  if (firstWordIndex === -1 || lastWordIndex === -1) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = firstWordIndex; i <= lastWordIndex; i++) {
    const word = words[i];
    if (!word) continue;
    minX = Math.min(minX, word.bbox.x);
    minY = Math.min(minY, word.bbox.y);
    maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
    maxY = Math.max(maxY, word.bbox.y + word.bbox.height);
  }

  return {
    bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    wordSpan: { startIndex: firstWordIndex, endIndexExclusive: lastWordIndex + 1 },
  };
}

/*
 * Partición de `words` en lotes para los checkpoints de cancelación "entre
 * batches de inferencia" (spec §12/§15.6, NerConfig.batchSize). ADR-024 §2
 * ratifica NerConfig.batchSize como cantidad de PALABRAS por lote (no una
 * cuenta real de tokens de wordpiece). Desde ADR-046 §3, cada lote es
 * además un despacho independiente al kernel (un `NerPagePayload` por
 * batch); esta función sigue siendo host-side porque necesita las `Word[]`
 * de la página, que el kernel nunca ve. Offsets calculados igual que
 * Page.text = words.map(w => w.text).join(" ").
 */
function computeWordChunks(
  words: ReadonlyArray<Word>,
  batchSize: number,
): ReadonlyArray<WordChunk> {
  const chunks: WordChunk[] = [];
  let offset = 0;
  for (let i = 0; i < words.length; i += batchSize) {
    const chunkWords = words.slice(i, i + batchSize);
    const startIndex = offset;
    for (const word of chunkWords) {
      offset += word.text.length + 1;
    }
    // -1: el separador final no pertenece al chunk (pertenece al límite con
    // el próximo, o no existe si es el último chunk de la página — slice()
    // clampea automáticamente en ese caso, sin necesidad de un caso especial).
    chunks.push({ startIndex, endIndexExclusive: offset - 1, words: chunkWords });
  }
  return chunks;
}

// ─── Puerto interno de despacho (ADR-046 §2, espejo exacto de
// OcrJobPool/OcrDispatchParams en ocr-engine/src/ocr.engine.ts). No
// exportado desde index.ts — detalle de wiring interno, mismo criterio que
// OcrJobPool/RenderJobPool. ───

interface NerDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
  /** Ciclo de vida del modelo reportado por un worker remoto, enrutado por `WorkerPool` (ADR-046 §4). En fallback in-process, el `run()` ya lo pasa directo al kernel. */
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

interface NerJobPool {
  dispatch<T>(params: NerDispatchParams<T>): Promise<T>;
}

/**
 * Fallback in-process trivial: sin `NerPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (el único loop de retry es el de
 * `processPage`). Es el comportamiento de este motor antes de ADR-046
 * (ADR-035 §1) — el que los tests existentes de este paquete ya esperan
 * (`new NerEngine()` sin argumento).
 */
const IMMEDIATE_POOL: NerJobPool = {
  dispatch: <T>(params: NerDispatchParams<T>): Promise<T> => params.run(),
};

/**
 * Normaliza un error emergente del despacho a la subclase concreta que
 * corresponde por `code` (ADR-046 §2, espejo de `normalizeTimeout` de
 * ocr-engine/ADR-045 §2, con **dos** códigos en vez de uno): un error local
 * (fallback in-process, lanzado por `worker/kernel.ts`) ya es la instancia
 * concreta. Uno que cruzó un worker remoto llega deserializado
 * (`EngineError.deserialize`, `Contracts.md` §4) como instancia genérica con
 * el `code` correcto, que NO es `instanceof NerTimeoutError` ni
 * `instanceof NerModelMissingError` — sin esta normalización, la política de
 * reintentos (`NER_TIMEOUT`) y de aborto (`NER_MODEL_MISSING`) cambiaría de
 * forma según haya pool real o fallback.
 */
function normalizeNerError(
  err: unknown,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): unknown {
  if (err instanceof NerTimeoutError || err instanceof NerModelMissingError) return err;
  if (!(err instanceof EngineError)) return err;
  if (err.code === EngineErrorCode.NER_TIMEOUT) {
    return new NerTimeoutError(documentId, pageIndex, timeoutMs);
  }
  if (err.code === EngineErrorCode.NER_MODEL_MISSING) {
    const modelId =
      typeof err.details.modelId === "string" ? err.details.modelId : DEFAULT_MODEL_ID;
    const reason = typeof err.details.reason === "string" ? err.details.reason : err.message;
    return new NerModelMissingError(modelId, reason);
  }
  return err;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Guarda de runtime que angosta `Serializable` (el tipo de `PROGRESS.partial`
 * a nivel de transporte, `04_Event_System.md` §2.2) a `NerKernelProgress`
 * (`03_Data_Model.md` §18). Pasa por `isRecord` (parámetro `unknown`, no
 * `Serializable`): TS no narrowea correctamente `Array.isArray` contra un
 * `ReadonlyArray<Serializable>` recursivo dentro de la propia unión de
 * `Serializable` — angostar primero a `Record<string, unknown>` lo evita sin
 * cast. Sin cast tampoco para las comparaciones: `value.phase` en un
 * `Record<string, unknown>` tipa `unknown`, comparable contra un literal.
 */
function isNerKernelProgress(value: Serializable | undefined): value is NerKernelProgress {
  if (!isRecord(value)) return false;
  return (
    value.phase === "model-loading" ||
    value.phase === "model-ready" ||
    value.phase === "model-load-retry"
  );
}

export class NerEngine implements IEngine {
  readonly id = EngineId.Ner;

  private readonly pool: NerJobPool;

  private ctx: EngineContext | null = null;
  private modelId: string | null = null;
  private initialized = false;
  private disposed = false;
  // "Ningún model-ready reportado aún para esta instancia" (ADR-046 §4) —
  // reemplaza `this.classifier !== null` de antes de ADR-046: misma
  // semántica per-instancia (NerStarted.modelLoading/isModelReady()), pero
  // el pipeline de Transformers.js ahora vive en el kernel, no en la
  // instancia. Deduplica NER_MODEL_READY: con nerPoolSize > 1, cada worker
  // carga su propio modelo y reportaría un model-ready propio que no es un
  // cambio de estado observable (spec §13 caso 17).
  private modelWarm = false;

  /**
   * `pool` (ADR-046 §2): inyectada por el façade en `createCore`
   * (`create-core.ts`, espejo de `new OcrEngine(ocrPool)`/`new
   * RenderEngine(renderPool)`). Sin argumento, cae al fallback in-process
   * trivial (`IMMEDIATE_POOL`) — el comportamiento que este motor tenía
   * antes de ADR-046, usado por sus propios tests.
   */
  constructor(pool?: NerJobPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
  }

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.modelId = ctx.config.ner.modelId;
    this.modelWarm = false;
    this.initialized = true;
    this.disposed = false;
    // Caso 11 (§13) / principio "Lazy loading" (§2): init NO carga el
    // modelo. Solo se carga en el primer processPage/processPages real,
    // dentro del kernel, cuando ner.enabled === true y hay texto.
    ctx.logger.info("NER Engine initialized");
    return Promise.resolve();
  }

  isModelReady(): boolean {
    return this.modelWarm;
  }

  getModelId(): string {
    return this.modelId ?? DEFAULT_MODEL_ID;
  }

  async processPage(input: NerPageInput, ctx: EngineContext): Promise<NerPageOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Ner });
    }

    const { documentId, pageIndex, text, words } = input;

    if (pageIndex < 0) {
      throw new InvalidInputError(`pageIndex inválido: ${pageIndex}. Debe ser >= 0.`, {
        documentId,
        pageIndex,
      });
    }

    const startedAt = Date.now();

    // Caso 11 (§13): NER desactivado — sin carga de modelo, occurrences=[].
    if (!ctx.config.ner.enabled) {
      return this.finishEmptyPage(documentId, pageIndex, startedAt, ctx);
    }

    // Caso 1 (§13): texto vacío.
    if (text.length === 0) {
      return this.finishEmptyPage(documentId, pageIndex, startedAt, ctx);
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const timeoutMs = ctx.config.workerPool.timeouts["ner-page"] ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = ctx.config.workerPool.maxRetries["ner-page"] ?? DEFAULT_MAX_RETRIES;
    const batchSize = Math.max(1, ctx.config.ner.batchSize);

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }

      try {
        const spans = await this.runInferenceInBatches(input, batchSize, timeoutMs, ctx);
        const occurrences = spans.map((span) => this.buildOccurrence(span, words, pageIndex));

        for (const occurrence of occurrences) {
          ctx.bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, { documentId, occurrence });
        }

        const durationMs = Date.now() - startedAt;
        ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_PAGE_FINISHED, {
          documentId,
          pageIndex,
          occurrenceCount: occurrences.length,
        });

        return { documentId, pageIndex, occurrences, durationMs };
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        // ADR-046 §2: normaliza antes de bifurcar (un error remoto llega
        // deserializado, sin pasar el instanceof de abajo).
        const normalized = normalizeNerError(err, documentId, pageIndex, timeoutMs);
        // No recuperable y no es "esta página falló" — es "el modelo no
        // cargó": se propaga tal cual, sin envolver en NerPageFailedError
        // (mismo criterio que antes de ADR-046: ensureModelLoaded corría
        // fuera del loop de retry).
        if (normalized instanceof NerModelMissingError) throw normalized;
        lastError = normalized;
        if (!(normalized instanceof NerTimeoutError)) break; // no recuperable: no reintentar
        // NerTimeoutError: recuperable, el for reintenta si quedan intentos.
      }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new NerPageFailedError(documentId, pageIndex, reason);
  }

  async processPages(
    inputs: ReadonlyArray<NerPageInput>,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<NerPageOutput>> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (inputs == null) {
      throw new InvalidInputError("inputs es null o undefined.", { engineId: EngineId.Ner });
    }

    const documentId = inputs[0]?.documentId ?? "";
    const modelId = ctx.config.ner.modelId;
    const modelAlreadyLoaded = this.modelWarm;
    const startedAt = Date.now();

    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_STARTED, {
      documentId,
      pageCount: inputs.length,
      modelId,
      ...(modelAlreadyLoaded ? {} : { modelLoading: true }),
    });

    const outputs: NerPageOutput[] = [];
    let occurrenceCount = 0;

    for (const input of inputs) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }
      try {
        // Secuencial a propósito (mismo criterio que ocr-engine.processPages,
        // ADR-021: la priorización por visibilidad y el despacho paralelo al
        // pool son del Orchestrator, Hito 9). El modelo se carga una sola
        // vez y se reutiliza entre páginas (spec §12) porque el kernel lo
        // retiene por (modelId, dtype).
        const output = await this.processPage(input, ctx);
        outputs.push(output);
        occurrenceCount += output.occurrences.length;
      } catch (err: unknown) {
        if (err instanceof CancelledError || err instanceof NerModelMissingError) {
          throw err;
        }
        // NerPageFailedError (u otro fallo de página): sin evento dedicado
        // (NER_Engine.md §7 no define NER_PAGE_FAILED, a diferencia de
        // OCR_PAGE_FAILED). Se descartan las ocurrencias NER de esa página
        // (las de Regex se mantienen) y se continúa con las demás (spec §11).
        ctx.logger.warn(
          `NER de la página ${input.pageIndex} falló; se descartan sus ocurrencias y se continúa.`,
          { documentId: input.documentId, pageIndex: input.pageIndex },
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId,
      occurrenceCount,
      durationMs,
    });

    return outputs;
  }

  async dispose(): Promise<void> {
    // ADR-046 §2: no pasa por pool.dispatch (dispose no es la operación del
    // puerto) — libera directo el kernel local. La liberación server-side en
    // un NerWorker real llega por el mensaje genérico DISPOSE del protocolo.
    await kernelDispose();
    this.modelWarm = false;
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
  }

  private finishEmptyPage(
    documentId: string,
    pageIndex: number,
    startedAt: number,
    ctx: EngineContext,
  ): NerPageOutput {
    const durationMs = Date.now() - startedAt;
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_PAGE_FINISHED, {
      documentId,
      pageIndex,
      occurrenceCount: 0,
    });
    return { documentId, pageIndex, occurrences: [], durationMs };
  }

  private buildOccurrence(
    span: NerKernelSpan,
    words: ReadonlyArray<Word>,
    pageIndex: number,
  ): Occurrence {
    const wordMapping = mapSpanToWords(words, span.startIndex, span.endIndexExclusive);
    const base = {
      id: crypto.randomUUID(),
      value: span.value,
      normalizedValue: span.normalizedValue,
      bbox: wordMapping?.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
      pageIndex,
      source: DetectionSource.NER,
      confidence: span.confidence,
      entityType: span.entityType,
    };
    // exactOptionalPropertyTypes: wordSpan solo se incluye si se pudo mapear
    // (nunca se asigna explícitamente `undefined`) — mismo patrón que
    // regex-engine/src/regex.engine.ts (buildOccurrence).
    return wordMapping ? { ...base, wordSpan: wordMapping.wordSpan } : base;
  }

  /**
   * Un despacho por batch (ADR-046 §2/§3): particiona la página en
   * `computeWordChunks`, y por cada chunk no-blanco despacha **solo la
   * inferencia** por el puerto — `maxRetriesOverride: 0`, el único loop de
   * retry es el de `processPage` (arriba). Los spans que devuelve el kernel
   * traen offsets relativos al batch; acá se suma `chunk.startIndex` para
   * volverlos absolutos dentro de la página (mismo mapeo que antes de
   * ADR-046, cuando la clasificación ocurría in-process).
   */
  private async runInferenceInBatches(
    input: NerPageInput,
    batchSize: number,
    timeoutMs: number,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<NerKernelSpan>> {
    const chunks = computeWordChunks(input.words, batchSize);
    const spans: NerKernelSpan[] = [];

    for (const chunk of chunks) {
      // Checkpoint de cancelación entre batches de inferencia (spec §12).
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }
      const chunkText = input.text.slice(chunk.startIndex, chunk.endIndexExclusive);
      if (chunkText.trim().length === 0) continue;

      const payload: NerPagePayload = {
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        text: chunkText,
        modelId: ctx.config.ner.modelId,
        quantization: ctx.config.ner.quantization,
        ...(ctx.config.ner.wasmPaths !== undefined ? { wasmPaths: ctx.config.ner.wasmPaths } : {}),
      };

      const onProgress = (progress: number, partial?: Serializable): void =>
        this.handleKernelProgress(progress, partial, ctx);

      const kernelSpans = await this.pool.dispatch<ReadonlyArray<NerKernelSpan>>({
        run: () => kernelClassify(payload, { timeoutMs, abortSignal: ctx.abortSignal, onProgress }),
        signal: ctx.abortSignal,
        priority: DISPATCH_PRIORITY,
        payload,
        maxRetriesOverride: 0,
        onProgress,
      });

      for (const span of kernelSpans) {
        spans.push({
          ...span,
          startIndex: span.startIndex + chunk.startIndex,
          endIndexExclusive: span.endIndexExclusive + chunk.startIndex,
        });
      }
    }

    return spans;
  }

  /**
   * Traduce el ciclo de vida del modelo reportado por el kernel (ADR-046
   * §4) a eventos de dominio / logging, en host. `model-loading` →
   * `NER_MODEL_LOADING`; `model-ready` → `NER_MODEL_READY` **una sola vez
   * por instancia** (dedup vía `modelWarm`, spec §13 caso 17);
   * `model-load-retry` → `ctx.logger.warn` con el mensaje de
   * `NerModelLoadFailedError` (sin puente `LOG` en el worker).
   */
  private handleKernelProgress(
    progress: number,
    partial: Serializable | undefined,
    ctx: EngineContext,
  ): void {
    if (!isNerKernelProgress(partial)) return;

    if (partial.phase === "model-loading") {
      ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, {
        modelId: partial.modelId,
        progress,
      });
      return;
    }

    if (partial.phase === "model-ready") {
      if (this.modelWarm) return; // dedup: ya emitido para esta instancia (caso 17).
      this.modelWarm = true;
      ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_READY, { modelId: partial.modelId });
      return;
    }

    // "model-load-retry"
    const warning = new NerModelLoadFailedError(partial.modelId, partial.reason);
    ctx.logger.warn(warning.message, { modelId: partial.modelId });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Ner);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Ner);
    }
  }
}
