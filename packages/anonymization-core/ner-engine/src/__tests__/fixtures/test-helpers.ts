/**
 * Mocks y builders compartidos por los tests de @anonly/ner-engine.
 *
 * `vi.mock("@huggingface/transformers", ...)` NO vive acá: por el hoisting
 * de Vitest, cada archivo de test debe declarar su propio `vi.mock` en su
 * propio módulo (mismo motivo documentado en
 * ocr-engine/src/__tests__/fixtures/test-helpers.ts). Este archivo solo
 * unifica los helpers de construcción de mocks (Code_Standards.md §10;
 * ADR-021 §5; precedente: mockTesseractWorker en ocr-engine).
 */
import type {
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Serializable,
  Unsubscribe,
  Word,
} from "@anonly/shared";
import type { pipeline, TokenClassificationOutput } from "@huggingface/transformers";
import { vi, type Mock } from "vitest";

import type { NerPageInput } from "../../ner.types.js";

/*
 * ADR-025: @huggingface/transformers v4 no exporta un alias público para el
 * tipo del pipeline de token-classification (a diferencia de
 * @xenova/transformers v2, que exportaba TokenClassificationPipelineType) ni
 * para el elemento individual "raw" (no agrupado) de su resultado — solo
 * TokenClassificationOutput<O>. Se derivan acá, en el único helper de
 * frontera del paquete contra esta librería (Code_Standards.md §10), del
 * único símbolo público relevante (pipeline()) sin cast: `entity: string` es
 * el único miembro de la unión Raw/Grouped donde `entity` tipa `string` en
 * vez de `undefined` — el shape que este motor siempre produce, porque nunca
 * pasa aggregation_strategy.
 */
export type TokenClassificationPipelineType = Awaited<
  ReturnType<typeof pipeline<"token-classification">>
>;
export type TokenClassificationSingle = Extract<
  TokenClassificationOutput[number],
  { entity: string }
>;

export function createMockBus(): IEventBus {
  return {
    on: vi.fn((): Unsubscribe => vi.fn()),
    once: vi.fn((): Unsubscribe => vi.fn()),
    off: vi.fn(),
    emit: vi.fn(),
    emitAsync: vi.fn(() => Promise.resolve()),
  };
}

export function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

export function createMockCache(): ICache {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    size: 0,
    bytes: 0,
  };
}

export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 2,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 2,
      maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
      timeouts: {
        "pdf-parse": 30000,
        "ocr-page": 60000,
        "ner-page": 20000,
        "render-page": 10000,
        "export-page": 30000,
      },
      maxRetries: {
        "pdf-parse": 1,
        "ocr-page": 2,
        "ner-page": 1,
        "render-page": 1,
        "export-page": 1,
      },
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60000,
    },
    pdf: { maxPageCount: 10000 },
    ner: {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
    ...overrides,
  };
}

export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  const abortController = new AbortController();

  return {
    bus: createMockBus(),
    logger: createMockLogger(),
    cache: createMockCache(),
    abortSignal: abortController.signal,
    config: createMockConfig(),
    ...overrides,
  };
}

/**
 * Construye un `Word` sintético. `x` avanza monotónicamente entre llamadas
 * del caller para que el orden de lectura sea estable (mismo criterio que
 * regex-engine/src/__tests__/fixtures/test-helpers.ts).
 */
export function makeWord(text: string, x: number, pageIndex: number, y = 100): Word {
  return {
    text,
    bbox: { x, y, width: Math.max(text.length * 6, 1), height: 12 },
    pageIndex,
    confidence: 1.0,
    source: "pdf",
  };
}

/**
 * Construye `words` a partir de una lista de tokens, con `text` reconstruible
 * como `words.map(w => w.text).join(" ")` (03_Data_Model.md §4).
 */
export function makeWords(tokens: ReadonlyArray<string>, pageIndex = 0): Word[] {
  const words: Word[] = [];
  let x = 10;
  for (const token of tokens) {
    words.push(makeWord(token, x, pageIndex));
    x += token.length * 6 + 10;
  }
  return words;
}

/** Construye un `NerPageInput` válido a partir de una lista de tokens de palabra. */
export function makeNerPageInput(
  documentId: string,
  pageIndex: number,
  tokens: ReadonlyArray<string>,
  overrides?: Partial<NerPageInput>,
): NerPageInput {
  const words = makeWords(tokens, pageIndex);
  return {
    documentId,
    pageIndex,
    text: tokens.join(" "),
    words,
    ...overrides,
  };
}

/**
 * Token crudo de token-classification, misma forma real que
 * `TokenClassificationSingle` (@huggingface/transformers v4, derivado más
 * arriba): `entity` es el label BIO crudo ("B-PER", "I-ORG", "O", ...),
 * `word` es el texto decodificado del token (con prefijo "##" para
 * continuaciones de wordpiece de BERT).
 */
export function nerToken(entity: string, word: string, score = 0.95, index = 0): TokenClassificationSingle {
  return { entity, score, index, word };
}

/**
 * Cast de frontera contra @huggingface/transformers — único lugar del
 * paquete donde se permite `as unknown as` (Code_Standards.md §10;
 * precedente `asTesseractWorker` en ocr-engine): `TokenClassificationPipelineType`
 * (derivado del tipo de retorno de `pipeline()`, ADR-025 — la librería no
 * exporta un alias público) expone `tokenizer`/`model` reales que
 * `ner.engine.ts` nunca toca (solo invoca el pipeline como función y
 * `.dispose()`); un mock estructural completo de esos miembros no aporta
 * seguridad real. `ner.engine.ts` solo llama al pipeline con un string único
 * (nunca batched), así que el mock no necesita soportar arrays.
 */
/**
 * `tokenizer` es opcional a propósito: el pipeline real lo expone (ADR-098 §1
 * lo usa para medir el presupuesto de tokens) pero la mayoría de los tests no
 * lo necesita, y su ausencia ejercita el camino "sin tokenizer no se mide y
 * se infiere de una sola pasada" — el comportamiento previo a ADR-098.
 */
export interface MockTokenizer {
  readonly model_max_length: number;
  encode(text: string): ReadonlyArray<number>;
}

/**
 * El tokenizer real de Transformers.js es **invocable** (`tokenizer(textos,
 * opts)`), así que `typeof` da `"function"` y no `"object"`. Un mock que sea
 * un objeto plano no ejercita eso — y de hecho ya escondió un bug: el guard
 * del kernel filtraba por `"object"`, descartaba el tokenizer real y el lote
 * no se partía nunca, con los tests en verde. Se construye callable a
 * propósito.
 */
function asCallableTokenizer(tokenizer: MockTokenizer): MockTokenizer {
  const callable = (): never => {
    throw new Error("El mock del tokenizer no implementa la llamada directa.");
  };
  return Object.assign(callable, tokenizer) as unknown as MockTokenizer;
}

export function mockTokenClassificationPipeline(
  classify: (text: string) => Promise<ReadonlyArray<TokenClassificationSingle>>,
  dispose: () => Promise<void> = () => Promise.resolve(),
  tokenizer?: MockTokenizer,
): TokenClassificationPipelineType {
  const callable = (text: string): Promise<ReadonlyArray<TokenClassificationSingle>> => classify(text);
  const withDispose = Object.assign(
    callable,
    tokenizer === undefined ? { dispose } : { dispose, tokenizer: asCallableTokenizer(tokenizer) },
  );
  return withDispose as unknown as TokenClassificationPipelineType;
}

/**
 * Forma reducida (propia de los tests) de las opciones que ner.engine.ts le
 * pasa a pipeline(): `progress_callback` tipado como función (no como
 * `Function` suelto, la firma real y laxa de PretrainedModelOptions en
 * @huggingface/transformers) para que los tests puedan invocarlo sin un
 * cast adicional. `dtype` reemplaza a `quantized` (ADR-025).
 */
export interface PipelineCallOptions {
  readonly dtype?: string;
  readonly progress_callback?: (event: unknown) => void;
}

type PipelineFactoryMock = Mock<
  (task: string, model?: string, options?: PipelineCallOptions) => Promise<TokenClassificationPipelineType>
>;

/**
 * Segundo (y último) cast de frontera contra @huggingface/transformers,
 * separado de `mockTokenClassificationPipeline` porque resuelve un problema
 * distinto: `pipeline` es genérica sobre `PipelineType` (`<T extends
 * PipelineType>(task: T, ...) => Promise<AllTasks[T]>`). `vi.mocked(pipeline)`
 * tipa el mock contra la unión completa de clases concretas de pipeline
 * (incluyendo miembros internos como `_call`, que ninguna librería mockeada
 * implementa de verdad), no contra `TokenClassificationPipelineType` — el
 * alias estructural que realmente usa `ner.engine.ts`. Los tests siguen
 * declarando su propio `vi.mock("@huggingface/transformers", ...)` (hoisting
 * de Vitest, mismo criterio que ocr-engine); este helper solo tipa el
 * resultado de esa declaración para poder llamar
 * `.mockResolvedValue`/`.mockRejectedValueOnce` sin repetir el cast en cada
 * archivo.
 */
export function asPipelineMock(fn: unknown): PipelineFactoryMock {
  return fn as unknown as PipelineFactoryMock;
}

// ─── Puerto interno NerJobPool (ADR-046 §2) — fake estructural para tests ───
//
// `NerJobPool` no se exporta desde `ner.engine.ts` (detalle de wiring
// interno, mismo criterio que `OcrJobPool` en ocr-engine): esta interfaz
// estructuralmente compatible alcanza sin importarla — TypeScript acepta
// pasar este objeto a `new NerEngine(pool)` por duck typing.

export interface NerPoolDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
  readonly onProgress?: (progress: number, partial?: Serializable) => void;
}

export interface NerDispatchCall {
  readonly payload: unknown;
  readonly maxRetriesOverride: number | undefined;
}

export interface TrackingNerPool {
  readonly dispatch: <T>(params: NerPoolDispatchParams<T>) => Promise<T>;
  readonly calls: NerDispatchCall[];
}

/**
 * Pool estructural mínima (ADR-046 §2, espejo de `createTrackingOcrPool` de
 * ocr-engine) que registra cada dispatch y delega en `params.run()` — usada
 * por los tests que necesitan inspeccionar los parámetros de despacho
 * (`maxRetriesOverride`, `payload`) sin depender de un `WorkerPool` real.
 */
export function createTrackingNerPool(): TrackingNerPool {
  const calls: NerDispatchCall[] = [];
  return {
    calls,
    dispatch: <T>(params: NerPoolDispatchParams<T>): Promise<T> => {
      calls.push({ payload: params.payload, maxRetriesOverride: params.maxRetriesOverride });
      return params.run();
    },
  };
}

/**
 * Pool estructural que **ignora `params.run()`** y resuelve directo con
 * `resolvedValue` (ADR-055 §5 / Code_Standards.md §7 "Test obligatorio por
 * motor"): a diferencia de `createTrackingNerPool` (arriba) y de todos los
 * fakes ad-hoc preexistentes de este paquete — que delegan en `run()`, o sea
 * el camino in-process, y por lo tanto **nunca cruzan el sobre**
 * `COMPLETED.result` — este es el único fake que reproduce lo que un
 * `NerJobPool` real resolvería tras un `postMessage`. Es la pieza que faltaba
 * y por la que el bug de la nota v1.2.1 (`NER_Engine.md`) vivió semanas sin
 * que ningún test lo detectara.
 */
export function createResolvedNerPool(resolvedValue: unknown): {
  readonly dispatch: (params: NerPoolDispatchParams<unknown>) => Promise<unknown>;
} {
  return {
    dispatch: (): Promise<unknown> => Promise.resolve(resolvedValue),
  };
}
