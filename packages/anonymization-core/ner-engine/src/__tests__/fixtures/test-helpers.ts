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
export function mockTokenClassificationPipeline(
  classify: (text: string) => Promise<ReadonlyArray<TokenClassificationSingle>>,
  dispose: () => Promise<void> = () => Promise.resolve(),
): TokenClassificationPipelineType {
  const callable = (text: string): Promise<ReadonlyArray<TokenClassificationSingle>> => classify(text);
  const withDispose = Object.assign(callable, { dispose });
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
