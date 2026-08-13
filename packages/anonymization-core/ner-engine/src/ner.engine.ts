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
  EntityType,
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

  // ADR-066 §6: `rotation` viaja por la cadena `Word → Occurrence →
  // Replacement` dentro del bbox, pero la unión de arriba construye un bbox
  // NUEVO a partir de escalares — sin esto el campo se cae en silencio y el
  // pintado rotado de §7 nunca se activa. Se propaga solo si TODAS las
  // palabras del span coinciden en el ángulo (en la práctica comparten uno:
  // desde ADR-067 los tokens de un run rotado llegan contiguos y en orden, que
  // es justamente lo que hace que NER pueda reconocer una entidad ahí). Si
  // discrepan, la envolvente de dos direcciones de avance no tiene un ángulo
  // que la describa y queda ausente (≡ 0). Mismo criterio que el
  // `mapSpanToWords` de regex-engine, del que esta función es adaptación.
  let rotation: BoundingBox["rotation"];
  let rotationAgrees = true;

  for (let i = firstWordIndex; i <= lastWordIndex; i++) {
    const word = words[i];
    if (!word) continue;
    minX = Math.min(minX, word.bbox.x);
    minY = Math.min(minY, word.bbox.y);
    maxX = Math.max(maxX, word.bbox.x + word.bbox.width);
    maxY = Math.max(maxY, word.bbox.y + word.bbox.height);

    if (i === firstWordIndex) rotation = word.bbox.rotation;
    else if (word.bbox.rotation !== rotation) rotationAgrees = false;
  }

  const bbox: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    // exactOptionalPropertyTypes: spread condicional, nunca `rotation: undefined`.
    ...(rotationAgrees && rotation !== undefined ? { rotation } : {}),
  };

  return {
    bbox,
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

// `dispatch` deja de ser genérico y devuelve `Promise<unknown>` (ADR-055 §2,
// nota v1.2.1 de NER_Engine.md): el parámetro de tipo `<T>` que tenía antes
// era una afirmación que el compilador no podía verificar — del otro lado de
// `run()` puede haber cruzado un `postMessage` real. Con `unknown`, el
// compilador obliga a pasar por `decodeKernelSpans` (más abajo) antes de
// iterar el resultado: no hay otra forma de escribir el consumidor.
interface NerDispatchParams {
  readonly run: () => Promise<unknown>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
  /** Ciclo de vida del modelo reportado por un worker remoto, enrutado por `WorkerPool` (ADR-046 §4). En fallback in-process, el `run()` ya lo pasa directo al kernel. */
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

interface NerJobPool {
  dispatch(params: NerDispatchParams): Promise<unknown>;
}

/**
 * Fallback in-process trivial: sin `NerPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (el único loop de retry es el de
 * `processPage`). Es el comportamiento de este motor antes de ADR-046
 * (ADR-035 §1) — el que los tests existentes de este paquete ya esperan
 * (`new NerEngine()` sin argumento). El resultado de `run()` (el array
 * pelado que produce `kernelClassify`) pasa igual por `decodeKernelSpans`
 * en el call site — es la prueba de paridad entre los dos caminos (ADR-055 §2).
 */
const IMMEDIATE_POOL: NerJobPool = {
  dispatch: (params: NerDispatchParams): Promise<unknown> => params.run(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Decoder del sobre `COMPLETED.result` (ADR-055 §2-§4, nota v1.2.1 de
// NER_Engine.md) ───
//
// `NerJobPool.dispatch` devuelve `Promise<unknown>`: no hay forma de iterar
// ni desestructurar ese resultado sin pasar por acá primero. Acepta las dos
// formas legítimas que puede resolver un despacho de este motor —
// `{ spans: [...] }` (el sobre que postea `worker/entry.ts:104` en el camino
// remoto, ADR-046 §1) y `[...]` (el array pelado que produce `kernelClassify`
// en el camino in-process) — y ante cualquier otra forma **lanza**
// `InvalidInputError` (ADR-055 §3): devolver `[]`/`undefined`/un default en
// silencio es exactamente el modo de falla que este decoder cierra — el que
// dejó a NER sin detectar ninguna entidad en producción durante semanas.

const NER_ENTITY_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(EntityType));

function isNerKernelSpan(value: unknown): value is NerKernelSpan {
  if (!isRecord(value)) return false;
  return (
    typeof value.entityType === "string" &&
    NER_ENTITY_TYPE_VALUES.has(value.entityType) &&
    typeof value.value === "string" &&
    typeof value.normalizedValue === "string" &&
    typeof value.confidence === "number" &&
    typeof value.startIndex === "number" &&
    typeof value.endIndexExclusive === "number"
  );
}

function isNerKernelSpanArray(value: unknown): value is ReadonlyArray<NerKernelSpan> {
  return Array.isArray(value) && value.every(isNerKernelSpan);
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
 * Decodifica el `Promise<unknown>` que resuelve `NerJobPool.dispatch`
 * (ADR-055 §2): el sobre remoto `{ spans }` y el array pelado in-process son
 * las dos únicas formas válidas; cualquier otra lanza `InvalidInputError`
 * (ADR-055 §3) en vez de devolver un default en silencio.
 */
function decodeKernelSpans(dispatchResult: unknown): ReadonlyArray<NerKernelSpan> {
  if (isNerKernelSpanArray(dispatchResult)) return dispatchResult;
  if (isRecord(dispatchResult) && isNerKernelSpanArray(dispatchResult.spans)) {
    return dispatchResult.spans;
  }
  throw new InvalidInputError(
    "NerJobPool.dispatch() resolvió con una forma no reconocida: se esperaba " +
      "{ spans: NerKernelSpan[] } (sobre remoto, ADR-046 §1) o NerKernelSpan[] " +
      "(camino in-process). Devolver un default en silencio está prohibido " +
      "(ADR-055 §3).",
    { engineId: EngineId.Ner, receivedShape: describeDispatchResultShape(dispatchResult) },
  );
}

/**
 * Subclase de `InvalidInputError` reservada para UNA causa específica: el
 * sobre `COMPLETED.result` no matchea ninguna forma reconocida
 * (`decodeKernelSpans`). No agrega un `EngineErrorCode` nuevo — sigue siendo
 * `INVALID_INPUT` (ADR-055 §3: "InvalidInputError si no hay una específica")
 * y sigue siendo `instanceof InvalidInputError` para cualquier caller externo
 * (incluye los tests de sobre de `NER_Engine.md` §14, que assertan
 * `InvalidInputError` genérico) — existe únicamente para que `processPages`
 * pueda distinguir "el sobre está roto, esto es sistémico" de cualquier otro
 * `InvalidInputError` genérico que `processPage` también puede lanzar (los
 * guards de `input == null`/`pageIndex < 0`, arriba, que son un problema de
 * ESA página nada más y tienen que seguir tratándose como fallo tolerable de
 * página, spec §11 — ver el catch de `processPages` más abajo). No exportada
 * desde `index.ts` (detalle de wiring interno).
 */
class NerDispatchEnvelopeError extends InvalidInputError {}

/**
 * Señal de control interna — extiende `Error` (exigido por
 * `@typescript-eslint/only-throw-error`, que aplica a cualquier `throw`, no
 * solo a los del Core) pero **no** es un `EngineError`: nunca cruza un
 * `postMessage`, nunca se serializa/deserializa. Code_Standards.md §7/
 * ADR-049 prohíben `instanceof <SubclaseConcreta>` de `EngineError` en
 * código que pueda recibir un error cruzado, porque la identidad de
 * subclase no sobrevive a `EngineError.deserialize`; esa restricción no
 * aplica acá porque esta clase nunca pasa por ese mecanismo.
 *
 * Se construye ÚNICAMENTE en el `catch` síncrono que envuelve la llamada a
 * `decodeKernelSpans` en `runInferenceInBatches`, inmediatamente después de
 * que `await this.pool.dispatch(...)` ya resolvió (no rechazó): en ese
 * punto exacto, por construcción del código —no por un chequeo de tipo en
 * runtime—, `decodeErr` es 100% local, nunca algo que cruzó la frontera. El
 * catch compartido de `processPage` (que sí puede recibir un `err`
 * deserializado, porque también envuelve el `await` del propio
 * `pool.dispatch(...)`) identifica este caso con `instanceof
 * NerDispatchDecodeFailure` — seguro en cualquier catch, cruzado o no,
 * precisamente porque nunca es lo que llega deserializado — y desenvuelve
 * `decodeError` (un `NerDispatchEnvelopeError`, definida arriba) antes de
 * relanzarlo, para que `processPage()` conserve su contrato público de
 * lanzar siempre una subclase de `EngineError` (Code_Standards.md §7). El
 * nombre del campo evita `cause`, que `Error` ya tipa de forma nativa
 * (ES2022) con tipo `unknown`.
 */
class NerDispatchDecodeFailure extends Error {
  readonly decodeError: NerDispatchEnvelopeError;

  constructor(decodeError: NerDispatchEnvelopeError) {
    super(decodeError.message);
    this.name = "NerDispatchDecodeFailure";
    this.decodeError = decodeError;
  }
}

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
        // ADR-055 §3 / Code_Standards.md §7 (ADR-049): `NerDispatchDecodeFailure`
        // (definida arriba) es la única forma segura de identificar acá una
        // falla de decodificación — este catch SÍ puede recibir un `err`
        // deserializado (el `await this.pool.dispatch(...)` de
        // `runInferenceInBatches` puede rechazar con un error cruzado), así
        // que un `instanceof InvalidInputError` directo estaría prohibido.
        // Se desenvuelve `decodeError` (un `NerDispatchEnvelopeError`, ver su
        // definición arriba) y se propaga tal cual, sin envolver en
        // NerPageFailedError — un dispatch con forma no reconocida no es
        // "esta página falló", es "el resultado del despacho no se pudo
        // decodificar" (mismo criterio sistémico que NerModelMissingError,
        // abajo): ni este loop de retry ni el warn+continue de
        // `processPages` lo tragan en silencio ("que falle ruidosamente es
        // el punto").
        if (err instanceof NerDispatchDecodeFailure) throw err.decodeError;
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
        // ADR-055 §3/§5: `processPage` puede lanzar `InvalidInputError` por
        // DOS motivos distintos, y solo uno de los dos es sistémico. Los
        // guards de `input == null`/`pageIndex < 0` (arriba, antes del loop
        // de retry) lanzan `InvalidInputError` genérico — un problema de ESA
        // página nada más, spec §9/§11: cae en el warn+continue de abajo,
        // igual que cualquier otro fallo de página. Una falla de
        // decodificación del sobre (`decodeKernelSpans`, vía
        // `NerDispatchDecodeFailure`) llega en cambio como
        // `NerDispatchEnvelopeError` — una subclase de `InvalidInputError`
        // reservada para esa causa (ver su definición más arriba) — y ES
        // sistémica (si el sobre no matchea, TODAS las páginas van a fallar
        // igual): mismo criterio que `NerModelMissingError`, aborta
        // `processPages` entero en vez de descartar la página y continuar.
        // Chequear el `InvalidInputError` genérico acá abortaría el
        // documento completo ante un `pageIndex` inválido de una sola
        // página, que no es lo que pide el spec. Que un sobre roto falle
        // ruidosamente es el punto — lo contrario es exactamente el modo de
        // falla que reprodujo el bug original (nota v1.2.1, NER_Engine.md).
        if (
          err instanceof CancelledError ||
          err instanceof NerModelMissingError ||
          err instanceof NerDispatchEnvelopeError
        ) {
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

      const dispatchResult = await this.pool.dispatch({
        run: () => kernelClassify(payload, { timeoutMs, abortSignal: ctx.abortSignal, onProgress }),
        signal: ctx.abortSignal,
        priority: DISPATCH_PRIORITY,
        payload,
        maxRetriesOverride: 0,
        onProgress,
      });
      // ADR-055 §2: `dispatchResult` es `unknown` — decodeKernelSpans es el
      // único paso permitido antes de iterarlo (nunca un cast a ciegas).
      let kernelSpans: ReadonlyArray<NerKernelSpan>;
      try {
        kernelSpans = decodeKernelSpans(dispatchResult);
      } catch (decodeErr: unknown) {
        // `decodeKernelSpans` es síncrona y `dispatchResult` ya resolvió (la
        // línea de arriba ya esperó el `await`): este catch, a diferencia
        // del de `processPage`, NO puede por construcción recibir un error
        // que cruzó un `postMessage` — envolver acá (y no más arriba) es lo
        // que permite identificar la falla de decodificación sin un
        // `instanceof InvalidInputError` en código que sí está expuesto a
        // errores deserializados (Code_Standards.md §7/ADR-049).
        //
        // Se reconstruye SIEMPRE como `NerDispatchEnvelopeError` (nunca se
        // reusa `decodeErr` tal cual, aun si ya es `InvalidInputError`): es
        // la marca que `processPages` necesita más abajo para distinguir
        // "el sobre está roto" (sistémico) de cualquier otro
        // `InvalidInputError` genérico que `processPage` también puede
        // lanzar (los guards de `input == null`/`pageIndex < 0`, que son un
        // problema de una sola página y deben seguir siendo tolerables).
        const envelopeError =
          decodeErr instanceof InvalidInputError
            ? new NerDispatchEnvelopeError(decodeErr.message, { ...decodeErr.details })
            : new NerDispatchEnvelopeError(
                `decodeKernelSpans lanzó un valor inesperado: ${String(decodeErr)}`,
                { engineId: EngineId.Ner },
              );
        throw new NerDispatchDecodeFailure(envelopeError);
      }

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
