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
import type { EngineConfig, EngineContext, Serializable, Word } from "@anonly/shared";
import { createEngineContext as sharedCreateEngineContext, createMockConfig as sharedCreateMockConfig } from "@anonly/test-utils";
import type { pipeline, TokenClassificationOutput } from "@huggingface/transformers";
import { type Mock } from "vitest";

import type { NerPageInput } from "../../ner.types.js";

/*
 * ADR-129: los dobles genéricos viven en `@anonly/test-utils`. Se re-exportan
 * acá para que cada suite siga importando de un solo lugar.
 */
export {
  createMockBus,
  createMockCache,
  createMockLogger,
} from "@anonly/test-utils";

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

/**
 * Opciones con las que el kernel invoca al pipeline. Solo `ignore_labels`
 * (ADR-111 §1); `aggregation_strategy` no se pasa nunca.
 */
export interface TokenClassificationCallOptions {
  readonly ignore_labels?: ReadonlyArray<string>;
}

export function mockTokenClassificationPipeline(
  classify: (
    text: string,
    options?: TokenClassificationCallOptions,
  ) => Promise<ReadonlyArray<TokenClassificationSingle>>,
  dispose: () => Promise<void> = () => Promise.resolve(),
  tokenizer?: MockTokenizer,
): TokenClassificationPipelineType {
  const callable = (
    text: string,
    options?: TokenClassificationCallOptions,
  ): Promise<ReadonlyArray<TokenClassificationSingle>> => classify(text, options);
  const withDispose = Object.assign(
    callable,
    tokenizer === undefined ? { dispose } : { dispose, tokenizer: asCallableTokenizer(tokenizer) },
  );
  return withDispose as unknown as TokenClassificationPipelineType;
}

/**
 * Doble **fiel** del pipeline en lo que a `ignore_labels` respecta:
 * `TokenClassificationPipeline._call` de @huggingface/transformers v4 default
 * a `['O']` y **descarta** todo token cuyo label esté en la lista
 * (`if (ignore_labels.includes(entity)) continue;`).
 *
 * `mockTokenClassificationPipeline` a secas devuelve lo que se le pide, así
 * que un test escrito con él no puede notar si el kernel dejó de pedir todos
 * los tokens. Este helper sí: se le pasa la secuencia **completa** (con sus
 * `O`) y filtra como filtraría la librería. Es lo que hace que los tests de
 * ADR-111 §1 fallen si se le saca el `ignore_labels: []` al kernel.
 */
export function mockPipelineHonouringIgnoreLabels(
  tokens: ReadonlyArray<TokenClassificationSingle>,
): TokenClassificationPipelineType {
  return mockTokenClassificationPipeline((_text, options) => {
    const ignored = options?.ignore_labels ?? ["O"];
    return Promise.resolve(tokens.filter((t) => !ignored.includes(t.entity)));
  });
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

/*
 * ADR-129: el `workerPool` —idéntico en los seis motores— sale del doble
 * compartido; acá quedan **solo** los campos que este motor necesita distintos,
 * con los mismos valores que tenía su copia propia.
 */
export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return sharedCreateMockConfig({
    ner: {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    ...overrides,
  });
}

/*
 * El `EngineContext` compartido arma su config internamente, así que hay que
 * pasarle la de este motor: si no, `ctx.config` sale con los defaults genéricos
 * y no con los que sus tests necesitan (ADR-129).
 */
export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  return sharedCreateEngineContext({ config: createMockConfig(), ...overrides });
}
