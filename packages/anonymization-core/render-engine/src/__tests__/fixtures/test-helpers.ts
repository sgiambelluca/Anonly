/**
 * Mocks y builders compartidos por los tests de @anonly/render-engine.
 *
 * `vi.mock("pdfjs-dist", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo
 * (mismo motivo documentado en pdf-engine/src/__tests__/fixtures/test-helpers.ts
 * y ocr-engine/src/__tests__/fixtures/test-helpers.ts). Este archivo solo
 * unifica los helpers de construcción de mocks (Code_Standards.md §10;
 * ADR-021 §5; precedente: `mockGetDocumentResult` en pdf-engine).
 */
import { createEventBus } from "@anonly/event-system";
import {
  AnnotationKind,
  ReplacementMode,
  type Annotation,
  type EngineConfig,
  type EngineContext,
  type ICache,
  type IEventBus,
  type ILogger,
  type Replacement,
  type Unsubscribe,
} from "@anonly/shared";
import type { getDocument } from "pdfjs-dist";
import { vi } from "vitest";

import type { RenderPageInput } from "../../render.types.js";

/**
 * Cast de frontera contra pdfjs-dist — permitido solo en helpers de test
 * (Code_Standards.md §10; ADR-019 nota 2026-07-09; precedente
 * `mockGetDocumentResult`/`asLoadingTask` en pdf-engine): `getDocument()`
 * devuelve un `PDFDocumentLoadingTask`, una clase con decenas de miembros que
 * un mock estructural no puede satisfacer honestamente. Los tests construyen
 * el mock vía `mockGetDocumentResult`/`mockGetDocumentFailure` y nunca
 * castean por su cuenta.
 */
function asLoadingTask(promise: Promise<unknown>): ReturnType<typeof getDocument> {
  return { promise } as unknown as ReturnType<typeof getDocument>;
}

export function mockGetDocumentResult(doc: Record<string, unknown>): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.resolve(doc));
}

export function mockGetDocumentFailure(error: Error): ReturnType<typeof getDocument> {
  return asLoadingTask(Promise.reject(error));
}

// ─── Mock de PDFDocumentProxy / PDFPageProxy ───

export interface MockPageOptions {
  readonly width?: number;
  readonly height?: number;
  readonly renderError?: Error;
  readonly renderNeverResolves?: boolean;
}

export function createMockPage(options?: MockPageOptions): Record<string, unknown> {
  const width = options?.width ?? 595;
  const height = options?.height ?? 842;

  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    render: vi.fn(() => {
      if (options?.renderNeverResolves === true) {
        return { promise: new Promise<void>(() => undefined) };
      }
      if (options?.renderError) {
        return { promise: Promise.reject(options.renderError) };
      }
      return { promise: Promise.resolve() };
    }),
  };
}

export type PageFactory = (pageIndex: number) => Record<string, unknown>;

export interface MockPdfDocumentOptions {
  readonly pageCount?: number;
  readonly pageFactory?: PageFactory;
  readonly getPageError?: Error;
}

export function createMockPdfDocument(options?: MockPdfDocumentOptions): Record<string, unknown> {
  const pageCount = options?.pageCount ?? 3;
  const factory = options?.pageFactory ?? ((): Record<string, unknown> => createMockPage());
  const destroy = vi.fn(() => Promise.resolve());

  return {
    numPages: pageCount,
    getPage: vi.fn((pageNumber: number) => {
      if (options?.getPageError) return Promise.reject(options.getPageError);
      return Promise.resolve(factory(pageNumber - 1));
    }),
    destroy,
  };
}

// ─── Stub de OffscreenCanvas / contexto 2D (registra qué se dibujó) ───

export interface DrawCall {
  readonly op: "fillRect" | "strokeRect" | "fillText" | "drawImage" | "getImageData" | "putImageData";
  readonly args: ReadonlyArray<unknown>;
  readonly fillStyle?: string;
  readonly strokeStyle?: string;
  readonly font?: string;
}

class StubCanvasRenderingContext2D {
  readonly calls: DrawCall[] = [];
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: "fillRect", args: [x, y, w, h], fillStyle: String(this.fillStyle) });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ op: "strokeRect", args: [x, y, w, h], strokeStyle: String(this.strokeStyle) });
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({
      op: "fillText",
      args: [text, x, y],
      fillStyle: String(this.fillStyle),
      font: this.font,
    });
  }

  drawImage(...args: unknown[]): void {
    this.calls.push({ op: "drawImage", args });
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    this.calls.push({ op: "getImageData", args: [x, y, w, h] });
    return {
      data: new Uint8ClampedArray(Math.max(w, 0) * Math.max(h, 0) * 4),
      width: w,
      height: h,
      colorSpace: "srgb",
    };
  }

  putImageData(imageData: ImageData, x: number, y: number): void {
    this.calls.push({ op: "putImageData", args: [imageData, x, y] });
  }
}

export interface CreatedCanvas {
  readonly width: number;
  readonly height: number;
  readonly calls: ReadonlyArray<DrawCall>;
}

let stubContextAvailable = true;
let createdCanvases: Array<{ width: number; height: number; context: StubCanvasRenderingContext2D }> = [];

// ADR-034 §3: `convertToBlob` es la frontera real de codificación (`encodeImageData`
// en render.engine.ts). El stub no codifica píxeles reales (no hay codec PNG/JPEG
// disponible en el entorno `node` de Vitest, ADR-021 §5): produce un `Blob` real
// y determinista cuyo tamaño refleja `{ type, quality }`, suficiente para que los
// tests verifiquen que `RenderPageOutput.encoded`/`PREVIEW_UPDATED.canvasBlobUrl`
// se construyen con el formato/calidad efectivos, sin depender de un encoder real.
let convertToBlobError: Error | null = null;
let convertToBlobCalls: Array<{ readonly type?: string; readonly quality?: number }> = [];

export function setConvertToBlobError(error: Error | null): void {
  convertToBlobError = error;
}

export function getConvertToBlobCalls(): ReadonlyArray<{ readonly type?: string; readonly quality?: number }> {
  return convertToBlobCalls;
}

export function resetConvertToBlobCalls(): void {
  convertToBlobCalls = [];
}

class StubOffscreenCanvas {
  width: number;
  height: number;
  private readonly context = new StubCanvasRenderingContext2D();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    createdCanvases.push({ width, height, context: this.context });
  }

  getContext(contextId: string): StubCanvasRenderingContext2D | null {
    if (contextId !== "2d" || !stubContextAvailable) return null;
    return this.context;
  }

  convertToBlob(options?: { readonly type?: string; readonly quality?: number }): Promise<Blob> {
    convertToBlobCalls.push({
      ...(options?.type !== undefined ? { type: options.type } : {}),
      ...(options?.quality !== undefined ? { quality: options.quality } : {}),
    });
    if (convertToBlobError !== null) return Promise.reject(convertToBlobError);
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, this.width & 0xff, this.height & 0xff]);
    return Promise.resolve(new Blob([bytes], { type: options?.type ?? "image/png" }));
  }
}

/** Simula un entorno sin `OffscreenCanvas` (spec §13 caso 14). Restaurar con `installOffscreenCanvasStub()`. */
export function removeOffscreenCanvasStub(): void {
  Reflect.deleteProperty(globalThis, "OffscreenCanvas");
}

/** Simula un entorno sin soporte de contexto 2D. Restaurar con `setStubCanvasContextAvailable(true)`. */
export function setStubCanvasContextAvailable(available: boolean): void {
  stubContextAvailable = available;
}

export function getCreatedCanvases(): ReadonlyArray<CreatedCanvas> {
  return createdCanvases.map((c) => ({ width: c.width, height: c.height, calls: c.context.calls }));
}

export function resetCreatedCanvases(): void {
  createdCanvases = [];
}

export function installOffscreenCanvasStub(): void {
  if (typeof globalThis.OffscreenCanvas !== "undefined") return;
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: StubOffscreenCanvas,
    writable: true,
    configurable: true,
  });
}

installOffscreenCanvasStub();

// ─── EngineContext / config mocks (mismo patrón que pdf-engine/ocr-engine) ───

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
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
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
 * `RenderEngine` no solo emite eventos: también los CONSUME (`RENDER_REQUESTED`,
 * `GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED`, ver render.engine.ts `init()`).
 * El bus mockeado (`createMockBus`) no dispara handlers registrados con `on()`
 * (es un stub). Para ejercitar esa ruta de consumo, este helper usa el
 * `EventBus` REAL de `@anonly/event-system` (permitido en `__tests__`,
 * excepción explícita de P-2) — mismo patrón y misma justificación que
 * grouping-engine/src/__tests__/fixtures/test-helpers.ts.
 */
export function createEngineContextWithRealBus(overrides?: Partial<EngineContext>): EngineContext {
  const abortController = new AbortController();
  const logger = createMockLogger();

  return {
    bus: createEventBus({ logger }),
    logger,
    cache: createMockCache(),
    abortSignal: abortController.signal,
    config: createMockConfig(),
    ...overrides,
  };
}

// ─── Builders de dominio ───

export function createValidBuffer(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

export function makeReplacement(overrides?: Partial<Replacement>): Replacement {
  return {
    groupId: "group-1",
    occurrenceId: "occ-1",
    pageIndex: 0,
    bbox: { x: 10, y: 20, width: 100, height: 14 },
    originalValue: "34.567.891",
    replacementValue: "[DNI 01]",
    mode: ReplacementMode.Placeholder,
    ...overrides,
  };
}

export function makeAnnotation(overrides?: Partial<Annotation>): Annotation {
  return {
    id: "ann-1",
    groupId: "group-1",
    pageIndex: 0,
    bbox: { x: 10, y: 20, width: 100, height: 14 },
    kind: AnnotationKind.Highlight,
    ...overrides,
  };
}

export function createRenderPageInput(overrides?: Partial<RenderPageInput>): RenderPageInput {
  return {
    documentId: "doc-1",
    pageIndex: 0,
    kind: "original",
    mode: "preview",
    ...overrides,
  };
}
