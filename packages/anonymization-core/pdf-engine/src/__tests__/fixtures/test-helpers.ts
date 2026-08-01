/**
 * Mocks y builders compartidos por los tests de @anonly/pdf-engine.
 *
 * `vi.mock("pdfjs-dist", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo. Este
 * archivo solo unifica los helpers de construcción de mocks (ADR-020, Fase 3).
 */
import type {
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Unsubscribe,
} from "@anonly/shared";
import type { getDocument } from "pdfjs-dist";
import { vi } from "vitest";

import type { PdfEngineInput } from "../../pdf.types.js";

/**
 * Cast de frontera contra pdfjs-dist — ÚNICO lugar del paquete donde se
 * permite `as unknown as` (Code_Standards.md §10; ADR-019, nota 2026-07-09):
 * getDocument() devuelve un PDFDocumentLoadingTask, una clase con decenas de
 * miembros que un mock estructural no puede satisfacer honestamente. Los tests
 * construyen el mock vía mockGetDocumentResult / mockGetDocumentFailure y
 * nunca castean por su cuenta.
 */
function asLoadingTask(promise: Promise<unknown>): ReturnType<typeof getDocument> {
  return { promise } as unknown as ReturnType<typeof getDocument>;
}

export function mockGetDocumentResult(
  doc: Record<string, unknown>,
): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.resolve(doc));
}

export function mockGetDocumentFailure(error: Error): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.reject(error));
}

/**
 * Forma mínima que `unit.test.ts` necesita leer del objeto de opciones que
 * `PdfEngine.process()` pasa a `getDocument()` (ADR-053 §5, §7). No es
 * `DocumentInitParameters` completo: esa interfaz no la exporta pdfjs-dist
 * desde su entrypoint público (mismo motivo documentado en
 * render-engine/src/__tests__/fixtures/test-helpers.ts, ADR-053 Contexto §6).
 * `disableFontFace` se incluye para poder assertar su AUSENCIA (§5: esta ruta
 * no rasteriza, así que nunca debe pasarse).
 */
export interface CapturedGetDocumentOptions {
  readonly data?: unknown;
  readonly password?: string;
  readonly disableFontFace?: boolean;
  readonly useWorkerFetch?: boolean;
  readonly cMapUrl?: string;
  readonly cMapPacked?: boolean;
  readonly standardFontDataUrl?: string;
  readonly CMapReaderFactory?: unknown;
  readonly StandardFontDataFactory?: unknown;
}

/**
 * Cast de frontera contra pdfjs-dist, concentrado acá (Code_Standards.md
 * §10; mismo criterio que `asLoadingTask` arriba): el primer argumento de
 * `getDocument()` es la unión `string | URL | TypedArray | ArrayBuffer |
 * DocumentInitParameters`. `PdfEngine.process()` SIEMPRE llama con la forma
 * objeto — nunca con una URL o un buffer pelado, las otras variantes de esa
 * unión — así que el narrowing es seguro.
 */
export function capturedGetDocumentOptions(arg: unknown): CapturedGetDocumentOptions {
  return arg as unknown as CapturedGetDocumentOptions;
}

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

export function createMockConfig(): EngineConfig {
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

export function createValidInput(documentId: string, password?: string): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(100).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  if (password !== undefined) {
    return { documentId, buffer: combined.buffer, password };
  }
  return { documentId, buffer: combined.buffer };
}

export type MockTextItem = {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function createMockPage(
  pageIndex: number,
  textItems?: ReadonlyArray<MockTextItem>,
): Record<string, unknown> {
  const items = textItems ?? [
    { str: `Page${pageIndex}Word1`, x: 50, y: 800, width: 50, height: 12 },
    { str: `Page${pageIndex}Word2`, x: 110, y: 800, width: 50, height: 12 },
  ];

  return {
    getViewport: vi.fn(() => ({ width: 595, height: 842 })),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: items.map((item) => ({
          str: item.str,
          transform: [1, 0, 0, 1, item.x, item.y],
          width: item.width,
          height: item.height,
        })),
      }),
    ),
  };
}

export type MockDocOptions = {
  readonly metadata?: Record<string, unknown>;
  readonly hasForms?: boolean;
  readonly textless?: boolean;
  readonly throwOnGetPage?: boolean;
};

export type PageFactory = (pageIndex: number) => Record<string, unknown>;

export function createMockPdfDocument(
  pageCount: number,
  options?: MockDocOptions | PageFactory,
): Record<string, unknown> {
  const isFactory = typeof options === "function";

  if (isFactory) {
    const factory = options;
    const pages: Record<string, unknown>[] = [];
    for (let i = 0; i < pageCount; i++) {
      pages.push(factory(i));
    }
    return {
      numPages: pageCount,
      getPage: vi.fn((pageNum: number) => Promise.resolve(pages[pageNum - 1])),
      getMetadata: vi.fn(() => Promise.resolve({ info: { Title: "Test" }, metadata: undefined })),
      destroy: vi.fn(),
      _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
    };
  }

  const pages: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (options?.throwOnGetPage) {
      pages.push({});
    } else if (options?.textless) {
      pages.push({
        getViewport: vi.fn(() => ({ width: 595, height: 842 })),
        getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
      });
    } else {
      pages.push(createMockPage(i));
    }
  }

  return {
    numPages: pageCount,
    getPage: vi.fn((pageNum: number) => {
      if (options?.throwOnGetPage) {
        return Promise.reject(new Error(`Error al obtener página ${pageNum}`));
      }
      return Promise.resolve(pages[pageNum - 1]);
    }),
    getMetadata: vi.fn(() =>
      Promise.resolve({
        info: {
          ...(options?.metadata ?? { Title: "Test", Producer: "TestApp" }),
          IsAcroFormPresent: options?.hasForms === true,
        },
        metadata: undefined,
      }),
    ),
    destroy: vi.fn(),
    _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
  };
}
