/**
 * `NerKernel` — el kernel de inferencia sin estado por documento que ADR-046
 * §1/§3/§5 asigna al NerWorker (espejo de `ocr-engine/src/worker/kernel.ts`,
 * ADR-045). Contiene TODO lo que toca `@huggingface/transformers`:
 * `configureTransformersEnv` (ADR-039), carga perezosa del pipeline con su
 * política de dos intentos, `classifyWithTimeout`, `positionTokens` y
 * `aggregateTokensToSpans`.
 *
 * Este archivo lo importan DOS consumidores (mismo código, dos fronteras):
 * - `ner.engine.ts` (host, in-process fallback): lo invoca directo desde el
 *   `run()` que pasa a `NerJobPool.dispatch` cuando no hay `workerFactory`
 *   real configurada (ADR-035, fallback bit-idéntico).
 * - `worker/entry.ts` (worker real): lo invoca detrás de la mensajería
 *   `postMessage` cuando SÍ hay un Worker de SO real.
 *
 * La clase `NerEngine` (loop por página, partición en batches, retry/timeout,
 * mapeo de spans a `Occurrence`, emisión de eventos) NUNCA importa
 * `@huggingface/transformers` fuera de este archivo — es la única frontera
 * del paquete que lo hace.
 *
 * Estado: el pipeline de Transformers.js cargado para un `(modelId, dtype)`
 * dado, a nivel de módulo. Para el worker real, es "lo que ese worker tiene
 * cargado"; para el fallback in-process, es "el único kernel virtual"
 * (coherente con que en ese modo no hay paralelismo real de todos modos).
 *
 * Ciclo de vida del modelo (ADR-046 §4): reportado por `onProgress` — nunca
 * por eventos de dominio ni por bus/logger (este archivo no tiene ninguno de
 * los dos, por diseño; espejo de la nota de cabecera de OCR). El kernel
 * reintenta la carga una vez (`MODEL_LOAD_MAX_ATTEMPTS`), reportando
 * `model-loading` (progreso de descarga), `model-load-retry` (fallo
 * recuperable, antes del segundo intento) y `model-ready` (éxito). Agotados
 * los intentos, lanza `NerModelMissingError` — cruza tal cual el borde del
 * puerto (ADR-046 §2), sin envolver.
 */
import {
  CancelledError,
  EntityType,
  type NerPagePayload,
  type NerKernelSpan,
  type NerWasmPaths,
  type Serializable,
} from "@anonly/shared";
import { env, pipeline, type TokenClassificationOutput } from "@huggingface/transformers";

import { NerModelMissingError, NerTimeoutError } from "../ner.errors.js";

// Intento inicial + 1 re-descarga ("re-descargar una vez", NER_Engine.md §11
// caso NER_MODEL_LOAD_FAILED / §13 caso 8).
const MODEL_LOAD_MAX_ATTEMPTS = 2;

/*
 * ADR-018 + ADR-023 §2 + ADR-025: el modelo y el runtime WASM de ONNX se
 * sirven first-party, nunca desde HuggingFace ni CDNs de terceros en
 * runtime. Por defecto, @huggingface/transformers apunta
 * env.backends.onnx.wasm.wasmPaths a jsDelivr — se sobreescribe acá.
 * env.localModelPath + modelId arman la ruta real que resuelve
 * getModelFile() de la librería; por eso el destino real de los assets del
 * modelo en assets.lock.json es apps/react-client/public/models/ner/<modelId>/...
 *
 * env.allowLocalModels default es `false` en entorno browser (`true` en
 * Node). Sin setearlo a `true` acá, con allowRemoteModels ya en `false`,
 * pipeline() rechaza sincrónicamente con "Invalid configuration detected:
 * both local and remote models are disabled" — indistinguible en la UI de un
 * modelo realmente ausente/corrupto (mismo NER_MODEL_MISSING). Hallazgo del
 * Escenario 1 E2E (Hito 10 PR10): primera vez que pipeline() corre de
 * verdad, en un browser real.
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
 * único que produce este kernel, que nunca pasa aggregation_strategy) — es
 * el único elemento de la unión cuyo campo `entity` tipa `string` en vez de
 * `undefined`.
 */
type NerClassifier = Awaited<ReturnType<typeof pipeline<"token-classification">>>;
type TokenClassificationSingle = Extract<TokenClassificationOutput[number], { entity: string }>;

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
// Este kernel siempre invoca con un string único (nunca un array), así que en
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

/*
 * ADR-088 §2 — el modelo default es *cased* y sobre texto todo en mayúsculas
 * devuelve CERO tokens etiquetados: medido, sobre
 * "JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ" no reconoce nada, y la misma línea
 * en Title Case devuelve PER con 0,999. Los sellos, carátulas y membretes de
 * un expediente están sistemáticamente en caja alta, así que es un punto
 * ciego, no un caso de borde.
 *
 * Una **corrida en caja alta** son ≥2 palabras consecutivas que tienen letras,
 * no tienen ninguna minúscula y no tienen un punto seguido de letra. Las tres
 * condiciones están medidas:
 *
 * - El mínimo de dos palabras deja "DNI 34.567.891" intacto (el número no
 *   tiene letras, así que "DNI" queda sola y una palabra no es corrida).
 * - El guard del punto deja "Empresa S.A., CUIT 20-12345678-9" intacto: sin
 *   él, "S.A.," y "CUIT" forman corrida, se transforman en "S.a., Cuit" y la
 *   confianza de la organización del cuerpo cae de 0,995 a 0,792.
 *
 * La transformación preserva la longitud carácter a carácter — cualquier
 * palabra cuyo mapeo de caja la cambie se deja intacta, y el resultado entero
 * se descarta si aun así la longitud no coincide. De eso depende que los
 * offsets de los spans valgan sobre el texto original.
 */
const HAS_LETTER_RE = /\p{L}/u;
const DOT_BEFORE_LETTER_RE = /\.\p{L}/u;

function belongsToUppercaseRun(word: string): boolean {
  return (
    HAS_LETTER_RE.test(word) &&
    word === word.toUpperCase() &&
    word !== word.toLowerCase() &&
    !DOT_BEFORE_LETTER_RE.test(word)
  );
}

function toTitleCase(word: string): string {
  const firstLetter = HAS_LETTER_RE.exec(word);
  if (firstLetter === null) return word;
  const cut = firstLetter.index + firstLetter[0].length;
  const titled = word.slice(0, cut) + word.slice(cut).toLowerCase();
  return titled.length === word.length ? titled : word;
}

function titleCaseUppercaseRuns(text: string): string {
  const words = text.split(" ");
  let changed = false;
  let i = 0;

  while (i < words.length) {
    if (!belongsToUppercaseRun(words[i] ?? "")) {
      i += 1;
      continue;
    }
    let runEnd = i + 1;
    while (runEnd < words.length && belongsToUppercaseRun(words[runEnd] ?? "")) {
      runEnd += 1;
    }
    if (runEnd - i >= 2) {
      for (let k = i; k < runEnd; k++) {
        const word = words[k];
        if (word === undefined) continue;
        const titled = toTitleCase(word);
        if (titled !== word) {
          words[k] = titled;
          changed = true;
        }
      }
    }
    i = runEnd;
  }

  if (!changed) return text;
  const transformed = words.join(" ");
  return transformed.length === text.length ? transformed : text;
}

function normalizeNerValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[.,;:!?()"'«»]+|[.,;:!?()"'«»]+$/g, "");
}

/**
 * `wasmPaths` inyectado por config (ADR-039, viaja en el payload desde
 * ADR-046 §5): si está definido se asigna **tal cual** a
 * `env.backends.onnx.wasm.wasmPaths` y nunca se pisa con el default; ausente
 * → se mantiene `NER_WASM_PATH`, el comportamiento previo a ADR-039.
 */
function configureTransformersEnv(wasmPaths: string | NerWasmPaths | undefined): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = NER_LOCAL_MODEL_PATH;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmPaths ?? NER_WASM_PATH;
  }
}

/*
 * Reconstruye offsets de caracteres para cada token dentro de chunkText.
 * @huggingface/transformers v4 sigue sin exponer start/end reales para
 * token-classification: solo entrega `word` (el token decodificado, con
 * prefijo "##" para continuaciones de wordpiece en modelos BERT). Se ubica
 * cada token en el texto con un cursor que solo avanza (garantiza orden y
 * evita coincidencias espurias hacia atrás); un token que no se puede ubicar
 * se descarta de forma defensiva. Nunca se loguea el contenido de los
 * tokens (Code_Standards.md §9: nunca loguear contenido del documento) — este
 * archivo no tiene logger de todos modos.
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
 * Agrega tokens BIO (B-PER/I-PER/B-ORG/...) en spans de entidad completos
 * (equivalente simplificado a aggregation_strategy="simple"). Un "B-"
 * siempre abre un span nuevo; un "I-" continúa el span abierto solo si
 * coincide el tipo; cualquier otra cosa (label no soportado, "O", o un "I-"
 * de tipo distinto al abierto) cierra el span en curso. `confidence` es el
 * promedio de los scores de los tokens que componen el span. Offsets
 * relativos al texto del batch (`NerKernelSpan`, ADR-046 §1) — el motor
 * host-side suma el offset del chunk dentro de la página.
 *
 * ADR-088 §2: los tokens se ubican contra `inferenceText` (el texto que vio
 * el modelo) y los `value` se cortan de `chunkText` (el texto como está
 * impreso). Las dos cadenas tienen la misma longitud, así que un offset vale
 * en las dos; separarlas es lo que hace que el `canonicalValue` del grupo
 * diga `PERITO CARLOS LOPEZ` y no `Perito Carlos Lopez`.
 */
function aggregateTokensToSpans(
  tokens: ReadonlyArray<TokenClassificationSingle>,
  inferenceText: string,
  chunkText: string,
): ReadonlyArray<NerKernelSpan> {
  const positioned = positionTokens(tokens, inferenceText);
  const spans: NerKernelSpan[] = [];
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

// ─── Estado del kernel (a nivel de módulo, ADR-046 §1) ───

let classifier: NerClassifier | null = null;
let loadedModelKey: string | null = null;

function resolveDtype(quantization: NerPagePayload["quantization"]): "q8" | "fp32" {
  // ADR-025: @huggingface/transformers v4 reemplaza `quantized: boolean` por
  // `dtype` (elige el sufijo del archivo .onnx a cargar). "q8" (default,
  // ADR-023) es el único nivel con mirror first-party en assets.lock.json
  // para este hito; "q4"/"f32" degradan a `dtype: "fp32"` (model.onnx sin
  // cuantizar) — mismo criterio de degradación que la impl. previa a ADR-046.
  return quantization === "q8" ? "q8" : "fp32";
}

/**
 * Garantiza que el pipeline de Transformers.js esté cargado para
 * `(modelId, dtype)`. Si ya está cargado con esa misma clave, no-op. Si está
 * cargado con una clave distinta, libera la instancia vigente (best-effort) y
 * carga una nueva — espejo de `ensureWorkerLoaded` en ocr-engine (recarga en
 * cambio de idiomas), aplicado acá al cambio de `(modelId, dtype)`
 * (NER_Engine.md §12: "el kernel retiene su pipeline y solo lo re-crea si
 * cambia (modelId, dtype)").
 *
 * Reporta el ciclo de vida vía `onProgress` (ADR-046 §4): `model-loading` con
 * el progreso de descarga ∈ [0,1], `model-load-retry` tras un intento
 * fallido (antes de reintentar) y `model-ready` al terminar con éxito. Tras
 * agotar `MODEL_LOAD_MAX_ATTEMPTS`, lanza `NerModelMissingError`.
 */
async function ensureClassifierLoaded(
  modelId: string,
  quantization: NerPagePayload["quantization"],
  wasmPaths: string | NerWasmPaths | undefined,
  onProgress: ((progress: number, partial?: Serializable) => void) | undefined,
): Promise<void> {
  const dtype = resolveDtype(quantization);
  const key = `${modelId}:${dtype}`;
  if (classifier !== null && loadedModelKey === key) return;

  if (classifier !== null) {
    const previous = classifier;
    classifier = null;
    loadedModelKey = null;
    try {
      await previous.dispose();
    } catch {
      // best-effort: seguir cargando la instancia nueva igual.
    }
  }

  configureTransformersEnv(wasmPaths);

  const progressHandler = (raw: unknown): void => {
    if (!isRecord(raw)) return;
    const { status, progress } = raw;
    if (status !== "progress" || typeof progress !== "number") return;
    onProgress?.(Math.max(0, Math.min(1, progress / 100)), {
      phase: "model-loading",
      modelId,
    });
  };

  let lastReason = "modelo no disponible";
  for (let attempt = 0; attempt < MODEL_LOAD_MAX_ATTEMPTS; attempt++) {
    try {
      classifier = await pipeline("token-classification", modelId, {
        dtype,
        progress_callback: progressHandler,
      });
      loadedModelKey = key;
      onProgress?.(1, { phase: "model-ready", modelId });
      return;
    } catch (err: unknown) {
      lastReason = err instanceof Error ? err.message : String(err);
      // Caso 8 (§13): "Modelo corrupto en cache: NER_MODEL_LOAD_FAILED →
      // re-descargar → si persiste, NER_MODEL_MISSING." Solo se reporta
      // `model-load-retry` cuando de verdad hay un reintento subsiguiente
      // (no en el último intento fallido, que va directo a
      // NerModelMissingError sin nada más que reintentar). No cruza como
      // error (ADR-046 §4): el host lo traduce a `ctx.logger.warn` con el
      // mensaje de `NerModelLoadFailedError`.
      if (attempt < MODEL_LOAD_MAX_ATTEMPTS - 1) {
        onProgress?.(0, { phase: "model-load-retry", modelId, reason: lastReason });
      }
    }
  }

  throw new NerModelMissingError(modelId, lastReason);
}

async function classifyWithTimeout(
  text: string,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
  abortSignal: AbortSignal,
  modelId: string,
): Promise<ReadonlyArray<TokenClassificationSingle>> {
  if (classifier === null) {
    throw new NerModelMissingError(modelId, "El clasificador NER no está inicializado.");
  }
  const activeClassifier = classifier;

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
    // ocr-engine (recognizeWithTimeout) usa para envolver una computación
    // WASM que no se puede preemptar desde JS sin un Worker real.
    const result = await Promise.race([activeClassifier(text), timeoutPromise, abortPromise]);
    return isTokenClassificationOutput(result) ? result : [];
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
  }
}

export interface KernelClassifyOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

/**
 * Clasifica el texto de UN BATCH (ADR-046 §3): carga el modelo si hace falta
 * (perezoso, clave `(modelId, dtype)`), tokeniza + infiere con timeout/abort
 * racing, y agrega los tokens BIO en spans de entidad. Offsets relativos al
 * texto del batch — el mapeo a `Occurrence` (bbox) es host-side
 * (`ner.engine.ts`), que es quien tiene las `Word[]` de la página.
 */
export async function kernelClassify(
  payload: NerPagePayload,
  opts: KernelClassifyOptions,
): Promise<ReadonlyArray<NerKernelSpan>> {
  const { documentId, pageIndex, text, modelId, quantization, wasmPaths } = payload;

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  await ensureClassifierLoaded(modelId, quantization, wasmPaths, opts.onProgress);

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  // ADR-088 §2: se infiere sobre el texto con las corridas en caja alta
  // pasadas a Title Case, y los valores se cortan del texto original.
  const inferenceText = titleCaseUppercaseRuns(text);

  const rawTokens = await classifyWithTimeout(
    inferenceText,
    documentId,
    pageIndex,
    opts.timeoutMs,
    opts.abortSignal,
    modelId,
  );
  return aggregateTokensToSpans(rawTokens, inferenceText, text);
}

/**
 * Libera la instancia del pipeline cargada por este kernel. Invocado DIRECTO
 * (sin pasar por `NerJobPool.dispatch`, ver `ner.engine.ts#dispose`) porque
 * `dispose()` no es la operación del puerto (ADR-046 §2, mismo criterio que
 * `kernelDispose` de ocr-engine, ADR-045); para el modo worker real, la
 * liberación server-side llega por el mensaje genérico `DISPOSE` del
 * protocolo, manejado en `worker/entry.ts`. Resiliente a que `dispose()`
 * rechace (best-effort, mismo criterio que ocr-engine mantiene).
 */
export async function kernelDispose(): Promise<void> {
  if (classifier !== null) {
    const current = classifier;
    classifier = null;
    loadedModelKey = null;
    try {
      await current.dispose();
    } catch {
      // best-effort: liberar igual el estado interno aunque dispose() falle.
    }
  }
}
