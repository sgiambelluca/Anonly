/**
 * Mocks y builders compartidos por los tests de @anonly/ocr-engine.
 *
 * `vi.mock("tesseract.js", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo
 * (mismo motivo documentado en pdf-engine/src/__tests__/fixtures/test-helpers.ts).
 * Este archivo solo unifica los helpers de construcción de mocks
 * (Code_Standards.md §10; ADR-021 §5; precedente: mockGetDocumentResult en
 * pdf-engine).
 */
import type {
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Unsubscribe,
} from "@anonly/shared";
import type { createWorker } from "tesseract.js";
import { vi } from "vitest";

import type { OcrPageInput } from "../../ocr.types.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

/**
 * Cast de frontera contra tesseract.js — ÚNICO lugar del paquete donde se
 * permite `as unknown as` (Code_Standards.md §10; ADR-019 nota 2026-07-09;
 * precedente `asLoadingTask`/`mockGetDocumentResult` en pdf-engine):
 * createWorker() resuelve a un Worker con decenas de miembros (recognize,
 * terminate, setParameters, load, reinitialize, detect, FS, writeText,
 * readText, removeFile, ...) que un mock estructural no puede satisfacer
 * honestamente sin implementarlos todos. `ocr.engine.ts` solo invoca
 * `recognize` y `terminate`; el mock solo provee esos dos. Los tests
 * construyen el worker mockeado vía mockTesseractWorker y nunca castean por
 * su cuenta.
 */
function asTesseractWorker(partial: Record<string, unknown>): TesseractWorker {
  return partial as unknown as TesseractWorker;
}

export type MockRecognizeWord = {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
};

/**
 * Arma la forma `data` que tesseract.js devuelve para
 * `recognize(image, {}, { blocks: true })`: jerarquía Block > Paragraph >
 * Line > Word (ver naptha/tesseract.js docs/api.md). `ocr.engine.ts` la
 * recorre con guards de runtime (no con un cast), así que este builder no
 * necesita ningún cast tampoco.
 */
export function mockRecognizeData(
  words: ReadonlyArray<MockRecognizeWord>,
  pageConfidence?: number,
): Record<string, unknown> {
  const confidence =
    pageConfidence ??
    (words.length > 0 ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0);

  return {
    confidence,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                words: words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** `recognize()` no devuelve ninguna palabra (página en blanco o solo imagen). */
export function mockEmptyRecognizeData(): Record<string, unknown> {
  return { confidence: 0, blocks: [] };
}

export function mockTesseractWorker(
  // `unknown` (no Record<string, unknown>) a propósito: algunos tests de
  // resiliencia (ver unit.test.ts "Malformed tesseract.js response
  // resilience") necesitan simular respuestas de forma inesperada
  // (string, blocks/paragraphs/words con tipos incorrectos) para ejercitar
  // los guards de runtime de ocr.engine.ts. La forma real de recognizeData
  // no está fijada por ningún contrato propio (viene de una librería
  // externa), así que angostarla acá no aporta seguridad de tipos real.
  recognizeData: unknown,
  overrides?: {
    readonly recognize?: ReturnType<typeof vi.fn>;
    readonly terminate?: ReturnType<typeof vi.fn>;
  },
): TesseractWorker {
  const recognize =
    overrides?.recognize ??
    vi.fn(() => Promise.resolve({ jobId: "mock-job", data: recognizeData }));
  const terminate = overrides?.terminate ?? vi.fn(() => Promise.resolve());
  return asTesseractWorker({ recognize, terminate });
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
 * `ImageData` es una interfaz estructural pura (4 campos readonly, sin
 * métodos: data/width/height/colorSpace — ver lib.dom.d.ts). No hace falta
 * ningún cast ni el `ImageData` global real (inexistente en el entorno
 * `node` de Vitest, ver vitest.config.ts `test.environment`): un literal que
 * matchea la forma alcanza.
 */
export function createImageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4),
    width,
    height,
    colorSpace: "srgb",
  };
}

export function createValidOcrPageInput(
  documentId: string,
  pageIndex = 0,
  overrides?: Partial<OcrPageInput>,
): OcrPageInput {
  return {
    documentId,
    pageIndex,
    imageData: createImageData(100, 40),
    dpi: 300,
    languages: ["spa", "eng"],
    ...overrides,
  };
}

/**
 * Stub mínimo de `OffscreenCanvas` para el entorno `node` de Vitest (sin
 * DOM, ver vitest.config.ts `test.environment`). `ocr.engine.ts` construye
 * un `OffscreenCanvas` real para convertir `ImageData` al `ImageLike` que
 * tesseract.js realmente acepta (su `ImageLike` no incluye `ImageData`
 * directamente — ver node_modules/tesseract.js/src/index.d.ts). En un
 * navegador real `OffscreenCanvas` es global nativo; en tests, este stub se
 * instala una sola vez (no pisa un `OffscreenCanvas` real si existiera). No
 * rasteriza de verdad — `putImageData` es un no-op — porque los tests
 * mockean tesseract.js por completo y nunca inspeccionan el contenido de
 * los píxeles.
 */
let stubCanvasContextAvailable = true;

class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(): { putImageData: () => void } | null {
    if (!stubCanvasContextAvailable) return null;
    return { putImageData: () => undefined };
  }
}

/**
 * Simula un entorno sin soporte de contexto 2D (edge case defensivo de
 * `toTesseractImage`, ocr.engine.ts). Referencia el stub por closure — no
 * pasa por `globalThis.OffscreenCanvas` (evita castear contra su tipo
 * ambient real de lib.dom.d.ts, que el stub no implementa por completo).
 * Los tests deben restaurar con `setStubCanvasContextAvailable(true)` en un
 * `finally`.
 */
export function setStubCanvasContextAvailable(available: boolean): void {
  stubCanvasContextAvailable = available;
}

function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;

  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: StubOffscreenCanvas,
    writable: true,
    configurable: true,
  });
}

installOffscreenCanvasStub();
