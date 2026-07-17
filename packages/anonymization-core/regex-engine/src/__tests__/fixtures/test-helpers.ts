/**
 * Mocks y builders compartidos por los tests de @anonly/regex-engine.
 *
 * Regex Engine no depende de ninguna librería externa (§4/§5 del spec: usa
 * `RegExp` nativo), así que a diferencia de pdf-engine/ocr-engine no hace
 * falta ningún cast de frontera (`as unknown as`) contra una librería de
 * terceros — no hay ninguno en este archivo.
 */
import type {
  Document,
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Page,
  Unsubscribe,
  Word,
} from "@anonly/shared";
import { vi } from "vitest";

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
      modelId: "test",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 1,
      enabled: false,
    },
    ocr: { languages: ["spa"], dpi: 300 },
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
 * del caller (ver `makePage`) para que el orden de lectura sea estable.
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
 * Construye una `Page` a partir de una lista de tokens (cada uno, un
 * `Word`). `text` se arma exactamente como especifica 03_Data_Model.md §4:
 * `words.map(w => w.text).join(" ")` — el mismo criterio que usa
 * `regex.engine.ts` para mapear spans de texto de vuelta a `Word[]`.
 */
export function makePage(pageIndex: number, tokens: ReadonlyArray<string>): Page {
  const words: Word[] = [];
  let x = 10;
  for (const token of tokens) {
    words.push(makeWord(token, x, pageIndex));
    x += token.length * 6 + 10;
  }
  return {
    index: pageIndex,
    width: 595,
    height: 842,
    words,
    text: tokens.map((t) => t).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

/** Página sin texto (requiresOCR aún pendiente de fusión OCR). */
export function makeEmptyPage(pageIndex: number): Page {
  return {
    index: pageIndex,
    width: 595,
    height: 842,
    words: [],
    text: "",
    requiresOCR: true,
    ocrCompleted: false,
  };
}

export function makeDocument(id: string, pages: ReadonlyArray<Page>): Document {
  return {
    id,
    name: "test.pdf",
    pageCount: pages.length,
    pages,
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: 0,
  };
}

/** Atajo: documento de una sola página con los tokens dados. */
export function makeSinglePageDocument(id: string, tokens: ReadonlyArray<string>): Document {
  return makeDocument(id, [makePage(0, tokens)]);
}
