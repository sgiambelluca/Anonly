import {
  CancelledError,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  EventChannel,
  InvalidInputError,
  type BoundingBox,
  type EngineContext,
  type IEngine,
  type NerConfig,
  type Occurrence,
  type Word,
  type WordSpan,
} from "@anonly/shared";
import { env, pipeline, type TokenClassificationOutput } from "@huggingface/transformers";

import {
  NerModelLoadFailedError,
  NerModelMissingError,
  NerPageFailedError,
  NerTimeoutError,
} from "./ner.errors.js";
import type { NerPageInput, NerPageOutput } from "./ner.types.js";

// NER_Engine.md §11: "timeout por página (default 20 s)".
const DEFAULT_TIMEOUT_MS = 20_000;
// NER_Engine.md §11: NER_TIMEOUT/NER_PAGE_FAILED "reintentar 1 vez".
const DEFAULT_MAX_RETRIES = 1;
// ADR-023 §2: modelo multilingüe default (reemplaza el placeholder de ADR-006).
const DEFAULT_MODEL_ID = "Xenova/bert-base-multilingual-cased-ner-hrl";
// Intento inicial + 1 re-descarga ("re-descargar una vez", spec §11 caso NER_MODEL_LOAD_FAILED).
const MODEL_LOAD_MAX_ATTEMPTS = 2;

/*
 * ADR-025: @huggingface/transformers v4 no exporta un alias público para el
 * tipo del pipeline de token-classification (a diferencia de
 * @xenova/transformers v2, que exportaba TokenClassificationPipelineType) ni
 * para el elemento individual "raw" (no agrupado) de su resultado — solo
 * TokenClassificationOutput<O>, la unión array de spans "raw"/"grouped"
 * parametrizada por las opciones de la llamada. Ambos se derivan del único
 * símbolo público relevante (pipeline()) sin cast: NerClassifier via el tipo
 * de retorno de pipeline() para la task "token-classification";
 * TokenClassificationSingle aislando a nivel de tipos el shape "raw" (el
 * único que produce este motor, que nunca pasa aggregation_strategy) — es el
 * único elemento de la unión cuyo campo `entity` tipa `string` en vez de
 * `undefined`.
 */
type NerClassifier = Awaited<ReturnType<typeof pipeline<"token-classification">>>;
type TokenClassificationSingle = Extract<TokenClassificationOutput[number], { entity: string }>;

/*
 * ADR-018 + ADR-023 §2 + ADR-025: el modelo y el runtime WASM de ONNX se
 * sirven first-party, nunca desde HuggingFace ni CDNs de terceros en
 * runtime. Por defecto, @huggingface/transformers apunta
 * env.backends.onnx.wasm.wasmPaths a jsDelivr
 * (node_modules/@huggingface/transformers/src/backends/onnx.js) — se
 * sobreescribe acá. env.backends.onnx es una copia shallow de env de
 * onnxruntime-web tomada al importar el módulo (no la referencia original),
 * pero su propiedad `wasm` sigue siendo el mismo objeto anidado que usa
 * internamente onnxruntime-web, así que mutar wasmPaths acá sigue
 * propagándose correctamente. env.localModelPath + modelId arman la ruta
 * real que resuelve getModelFile() de la librería (utils/hub.js:
 * pathJoin(env.localModelPath, pathJoin(path_or_repo_id, filename))); por
 * eso el destino real de los assets del modelo en assets.lock.json es
 * apps/react-client/public/models/ner/<modelId>/..., no un directorio plano.
 *
 * env.allowLocalModels default es `false` en entorno browser (`true` en
 * Node — por eso ningún test unit/contract/edge lo detectaba: todos mockean
 * la frontera de @huggingface/transformers, ADR-021 §5, y los que no,
 * corren en Node). Sin setearlo a `true` acá, con allowRemoteModels ya en
 * `false`, pipeline() rechaza sincrónicamente con "Invalid configuration
 * detected: both local and remote models are disabled" — indistinguible en
 * la UI de un modelo realmente ausente/corrupto (mismo NER_MODEL_MISSING).
 * Hallazgo del Escenario 1 E2E (Hito 10 PR10): primera vez que pipeline()
 * corre de verdad, en un browser real.
 */
const NER_LOCAL_MODEL_PATH = "/models/ner/";
const NER_WASM_PATH = "/wasm/onnxruntime/";

// Mapeo de labels del modelo (ADR-023 §2): PER→Person, ORG→Organization,
// LOC→Address (aproximación: "location" no es estrictamente "dirección
// postal"), DATE→Date. Cualquier otro label (incluyendo "O") se ignora.
const LABEL_TO_ENTITY_TYPE: Readonly<Record<string, EntityType>> = {
  PER: EntityType.Person,
  ORG: EntityType.Organization,
  LOC: EntityType.Address,
  DATE: EntityType.Date,
};

interface WordMapping {
  readonly bbox: BoundingBox;
  readonly wordSpan: WordSpan;
}

interface WordChunk {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
  readonly words: ReadonlyArray<Word>;
}

interface NerSpan {
  readonly entityType: EntityType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly confidence: number;
  // Relativo al texto sobre el que se ejecutó la inferencia (chunk-local en
  // aggregateTokensToSpans; página-absoluto una vez sumado chunk.startIndex
  // en runInferenceInBatches — misma forma, distinto marco de referencia).
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

interface PositionedToken {
  readonly entity: string;
  readonly score: number;
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

interface OpenSpan {
  readonly label: string;
  startIndex: number;
  endIndexExclusive: number;
  scores: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTokenClassificationSingle(value: unknown): value is TokenClassificationSingle {
  if (!isRecord(value)) return false;
  const { entity, score, index, word } = value;
  return (
    typeof entity === "string" &&
    typeof score === "number" &&
    typeof index === "number" &&
    typeof word === "string"
  );
}

// @huggingface/transformers v4 tipa el resultado de un pipeline de
// token-classification como `TokenClassificationOutput<O> | TokenClassificationOutput<O>[]`
// (la unión existe porque la misma función acepta texto único o batched).
// Este motor siempre invoca con un string único (nunca un array), así que en
// runtime la forma real siempre es la plana — pero se valida con un guard de
// runtime (no un cast) para no asumir ciegamente la forma, mismo criterio
// defensivo que ocr-engine usa con la respuesta de tesseract.js.
function isTokenClassificationOutput(
  value: unknown,
): value is ReadonlyArray<TokenClassificationSingle> {
  return Array.isArray(value) && value.every(isTokenClassificationSingle);
}

function stripContinuationMarker(word: string): string {
  return word.startsWith("##") ? word.slice(2) : word;
}

function normalizeNerValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[.,;:!?()"'«»]+|[.,;:!?()"'«»]+$/g, "");
}

/**
 * `wasmPaths` inyectado por config (ADR-039, `NerConfig.wasmPaths`,
 * `Contracts.md` §6, caso límite 16 del spec): si está definido se asigna
 * **tal cual** a `env.backends.onnx.wasm.wasmPaths` y nunca se pisa con el
 * default — la app (única capa con bundler) lo resuelve vía `?url` e inyecta
 * URLs reales porque `onnxruntime-web` hace un `import()` dinámico ESM de su
 * glue `.mjs`, que Vite rechaza si el archivo vive en `public/`. Ausente →
 * se mantiene `NER_WASM_PATH`, el comportamiento previo a ADR-039.
 */
function configureTransformersEnv(nerConfig: NerConfig): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = NER_LOCAL_MODEL_PATH;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = nerConfig.wasmPaths ?? NER_WASM_PATH;
  }
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
 * cuenta real de tokens de wordpiece): este motor corre inline sin un
 * tokenizer real disponible fuera de la llamada mockeada a Transformers.js
 * (ADR-021 §5), y `words` (Word[] de Page.words, ya provisto por
 * NerPageInput para el mapeo de bbox) es la única granularidad de entrada
 * disponible sin tokenizar. Preserva el mecanismo exigido por el spec
 * (checkpoint de ctx.abortSignal entre cada llamada a la librería, una
 * llamada por lote); reevaluable a tokens exactos cuando la inferencia pase
 * a workers con tokenizer real (Hito 9, ADR-024 §2). Offsets calculados
 * igual que Page.text = words.map(w => w.text).join(" ").
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

/*
 * Reconstruye offsets de caracteres para cada token dentro de chunkText.
 * @huggingface/transformers v4 sigue sin exponer start/end reales para
 * token-classification (el campo es opcional en el tipo público, pero la
 * implementación real de TokenClassificationPipeline._call nunca lo puebla —
 * "TODO: Add support for start and end" en su código fuente): solo entrega
 * `word` (el token decodificado, con prefijo "##" para continuaciones de
 * wordpiece en modelos BERT). Se ubica cada token en el texto con un cursor
 * que solo avanza (garantiza orden y evita coincidencias espurias hacia
 * atrás); un token que no se puede ubicar se descarta de forma defensiva.
 * Nunca se loguea el contenido de los tokens (Code_Standards.md §9: nunca
 * loguear contenido del documento).
 */
function positionTokens(
  tokens: ReadonlyArray<TokenClassificationSingle>,
  chunkText: string,
): ReadonlyArray<PositionedToken> {
  const positioned: PositionedToken[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const cleaned = stripContinuationMarker(token.word);
    if (cleaned.length === 0) continue;
    const foundAt = chunkText.indexOf(cleaned, cursor);
    if (foundAt === -1) continue;
    positioned.push({
      entity: token.entity,
      score: token.score,
      startIndex: foundAt,
      endIndexExclusive: foundAt + cleaned.length,
    });
    cursor = foundAt + cleaned.length;
  }
  return positioned;
}

/*
 * Agrega tokens BIO (B-PER/I-PER/B-ORG/... ) en spans de entidad completos
 * (equivalente simplificado a aggregation_strategy="simple", que
 * @huggingface/transformers v4 sí soporta de forma nativa — a diferencia de
 * @xenova/transformers v2 — pero que este motor no usa: reimplementa su
 * propia agregación para no cambiar de comportamiento en esta migración,
 * ADR-025). Un "B-" siempre abre un span nuevo; un "I-" continúa el span
 * abierto solo si coincide el tipo; cualquier otra cosa (label no soportado,
 * "O", o un "I-" de tipo distinto al abierto) cierra el span en curso.
 * confidence es el promedio de los scores de los tokens que componen el
 * span.
 */
function aggregateTokensToSpans(
  tokens: ReadonlyArray<TokenClassificationSingle>,
  chunkText: string,
): ReadonlyArray<NerSpan> {
  const positioned = positionTokens(tokens, chunkText);
  const spans: NerSpan[] = [];
  let open: OpenSpan | null = null;

  const flush = (): void => {
    if (open === null) return;
    const entityType = LABEL_TO_ENTITY_TYPE[open.label];
    if (entityType !== undefined) {
      const value = chunkText.slice(open.startIndex, open.endIndexExclusive);
      const confidence = open.scores.reduce((sum, s) => sum + s, 0) / open.scores.length;
      spans.push({
        entityType,
        value,
        normalizedValue: normalizeNerValue(value),
        confidence: Math.max(0, Math.min(1, confidence)),
        startIndex: open.startIndex,
        endIndexExclusive: open.endIndexExclusive,
      });
    }
    open = null;
  };

  for (const token of positioned) {
    const isBegin = token.entity.startsWith("B-");
    const isInside = token.entity.startsWith("I-");
    const label = isBegin || isInside ? token.entity.slice(2) : null;

    if (label === null || !(label in LABEL_TO_ENTITY_TYPE)) {
      flush();
      continue;
    }

    if (isBegin || open === null || open.label !== label) {
      flush();
      open = {
        label,
        startIndex: token.startIndex,
        endIndexExclusive: token.endIndexExclusive,
        scores: [token.score],
      };
    } else {
      open.endIndexExclusive = token.endIndexExclusive;
      open.scores.push(token.score);
    }
  }
  flush();

  return spans;
}

export class NerEngine implements IEngine {
  readonly id = EngineId.Ner;

  private ctx: EngineContext | null = null;
  private classifier: NerClassifier | null = null;
  private modelId: string | null = null;
  private initialized = false;
  private disposed = false;

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.modelId = ctx.config.ner.modelId;
    this.classifier = null;
    this.initialized = true;
    this.disposed = false;
    // Caso 11 (§13) / principio "Lazy loading" (§2): init NO carga el
    // modelo. Solo se carga en el primer processPage/processPages real,
    // cuando ner.enabled === true y hay texto (ver ensureModelLoaded,
    // invocado desde processPage). Precedente idéntico: OCR Engine
    // (ensureWorkerLoaded se invoca desde processPage, no desde init —
    // ADR-021, mismo conflicto ya resuelto para OCR).
    ctx.logger.info("NER Engine initialized");
    return Promise.resolve();
  }

  isModelReady(): boolean {
    return this.classifier !== null;
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

    await this.ensureModelLoaded(ctx);

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
        if (err instanceof CancelledError || err instanceof NerModelMissingError) throw err;
        lastError = err;
        if (!(err instanceof NerTimeoutError)) break; // no recuperable: no reintentar
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
    const modelAlreadyLoaded = this.classifier !== null;
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
        // pool son del Orchestrator, Hito 9). ensureModelLoaded (dentro de
        // processPage) es idempotente: el modelo se carga una sola vez y se
        // reutiliza entre páginas (spec §12).
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
    if (this.classifier !== null) {
      const classifier = this.classifier;
      this.classifier = null;
      try {
        // Libera la sesión de ONNX y la memoria temporal del pipeline
        // (checklist §15.9). NO descarga el modelo cacheado: los archivos ya
        // persistidos en Cache Storage por Transformers.js (ADR-021 §6)
        // permanecen, así que una recarga posterior no vuelve a descargar.
        await classifier.dispose();
      } catch {
        // best-effort: liberar igual el estado interno aunque dispose() falle.
      }
    }
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
    span: NerSpan,
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

  private async runInferenceInBatches(
    input: NerPageInput,
    batchSize: number,
    timeoutMs: number,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<NerSpan>> {
    const chunks = computeWordChunks(input.words, batchSize);
    const spans: NerSpan[] = [];

    for (const chunk of chunks) {
      // Checkpoint de cancelación entre batches de inferencia (spec §12/§15.6).
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }
      const chunkText = input.text.slice(chunk.startIndex, chunk.endIndexExclusive);
      if (chunkText.trim().length === 0) continue;

      const rawTokens = await this.classifyWithTimeout(
        chunkText,
        input.documentId,
        input.pageIndex,
        timeoutMs,
        ctx.abortSignal,
      );
      const aggregated = aggregateTokensToSpans(rawTokens, chunkText);
      for (const span of aggregated) {
        spans.push({
          ...span,
          startIndex: span.startIndex + chunk.startIndex,
          endIndexExclusive: span.endIndexExclusive + chunk.startIndex,
        });
      }
    }

    return spans;
  }

  private async ensureModelLoaded(ctx: EngineContext): Promise<void> {
    if (this.classifier !== null) return;

    const modelId = ctx.config.ner.modelId;
    configureTransformersEnv(ctx.config.ner);

    // ADR-025: @huggingface/transformers v4 reemplaza `quantized: boolean`
    // por `dtype` (elige el sufijo del archivo .onnx a cargar — DataType
    // "q8" mapea a model_quantized.onnx, mismo archivo que `quantized: true`
    // resolvía en v2). "q8" (default, ADR-023) es el único nivel con mirror
    // first-party en assets.lock.json para este hito; "q4"/"f32" degradan a
    // `dtype: "fp32"` (model.onnx sin cuantizar) con esta versión pinneada
    // de la librería — mismo criterio de degradación que v2 aplicaba con
    // `quantized: false`.
    const dtype = ctx.config.ner.quantization === "q8" ? "q8" : "fp32";

    const onProgress = (raw: unknown): void => {
      if (!isRecord(raw)) return;
      const { status, progress } = raw;
      if (status !== "progress" || typeof progress !== "number") return;
      ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, {
        modelId,
        progress: Math.max(0, Math.min(1, progress / 100)),
      });
    };

    let lastReason = "modelo no disponible";
    for (let attempt = 0; attempt < MODEL_LOAD_MAX_ATTEMPTS; attempt++) {
      try {
        this.classifier = await pipeline("token-classification", modelId, {
          dtype,
          progress_callback: onProgress,
        });
        this.modelId = modelId;
        ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_READY, { modelId });
        return;
      } catch (err: unknown) {
        lastReason = err instanceof Error ? err.message : String(err);
        // Caso 8 (§13): "Modelo corrupto en cache: NER_MODEL_LOAD_FAILED →
        // re-descargar → si persiste, NER_MODEL_MISSING." No se puede
        // distinguir de forma confiable "nunca disponible" de "corrupto,
        // recuperable con un reintento" a partir de un error genérico de la
        // librería — se aplica la misma política de reintento a toda falla
        // de pipeline(): la instancia de NerModelLoadFailedError documenta
        // el intento fallido (recuperable) antes de reintentar.
        const loadFailed = new NerModelLoadFailedError(modelId, lastReason);
        ctx.logger.warn(loadFailed.message, { modelId, attempt });
      }
    }

    throw new NerModelMissingError(modelId, lastReason);
  }

  private async classifyWithTimeout(
    text: string,
    documentId: string,
    pageIndex: number,
    timeoutMs: number,
    abortSignal: AbortSignal,
  ): Promise<ReadonlyArray<TokenClassificationSingle>> {
    if (this.classifier === null) {
      throw new NerModelMissingError(
        this.modelId ?? DEFAULT_MODEL_ID,
        "El clasificador NER no está inicializado.",
      );
    }
    const classifier = this.classifier;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new NerTimeoutError(documentId, pageIndex, timeoutMs));
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
      // Llamada opaca a la librería externa (mockeada en tests, ADR-021 §5):
      // mismo patrón de Promise.race contra timeout + AbortSignal que
      // ocr-engine (recognizeWithTimeout) y pdf-engine (parsePageTextWithTimeout)
      // usan para envolver una computación WASM que no se puede preemptar
      // desde JS sin un Worker real (Hito 9). SLA estricto < 200ms: Hito 9/11
      // (ADR-021 §1).
      const result = await Promise.race([classifier(text), timeoutPromise, abortPromise]);
      return isTokenClassificationOutput(result) ? result : [];
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
    }
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
