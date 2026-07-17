/**
 * Mocks y builders compartidos por los tests de @anonly/export-engine.
 *
 * `vi.mock("pdf-lib", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo
 * (mismo motivo documentado en render-engine/src/__tests__/fixtures/test-helpers.ts
 * y pdf-engine/src/__tests__/fixtures/test-helpers.ts). Este archivo solo
 * unifica los helpers de construcción de mocks (Code_Standards.md §10;
 * ADR-021 §5; precedente: `mockGetDocumentResult` en pdf-engine/render-engine).
 *
 * Los tests security/* usan `pdf-lib` REAL (no este mock) — ver
 * tests/security/security.test.ts.
 */
import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Document,
  type DocumentMetadata,
  type EngineConfig,
  type EngineContext,
  type EntityGroup,
  type ExportOptions,
  type ICache,
  type IEventBus,
  type ILogger,
  type Page,
  type Replacement,
  type Unsubscribe,
} from "@anonly/shared";
import type { PDFDocument } from "pdf-lib";
import { vi } from "vitest";

import type {
  EncodedPageImage,
  ExportEngineInput,
  RenderPageProvider,
} from "../../export.types.js";

// ─── Cast de frontera pdf-lib (Code_Standards.md §10) ───

export interface MockPdfPage {
  readonly width: number;
  readonly height: number;
  readonly drawImage: ReturnType<typeof vi.fn>;
}

export interface MockPdfLibDocumentOptions {
  readonly saveBytes?: Uint8Array;
  readonly saveError?: Error;
  /** Cuántos intentos de save() fallan antes de resolver (0 = nunca falla). */
  readonly saveFailTimes?: number;
  readonly embedError?: Error;
  /** Cuántos intentos de embedJpg/embedPng fallan antes de resolver (0 = nunca falla). */
  readonly embedFailTimes?: number;
  readonly drawImageError?: Error;
  /** Cuántos intentos de drawImage fallan (lanzan síncrono) antes de resolver (0 = nunca falla). */
  readonly drawImageFailTimes?: number;
}

const PDF_HEADER_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const MOCK_SAVE_BASE_OVERHEAD = 200;

/**
 * Mock estructural de `PDFDocument` (pdf-lib). Expone `pages` para que los
 * tests inspeccionen qué se dibujó, sin castear por su cuenta — solo
 * `asPdfDocument` cruza la frontera de tipos.
 *
 * `save()` (sin `saveBytes` explícito) devuelve un buffer cuyo tamaño es
 * `overhead + suma(bytes embebidos)`: permite que los tests de tamaño (DPI
 * 300 vs 150, PNG vs JPEG — spec §14) controlen el tamaño de
 * `EncodedPageImage.bytes` que entregan vía el `RenderPageProvider` mockeado
 * y observen que `ExportEngineOutput.sizeBytes` escala en consecuencia, sin
 * depender de un códec de imagen real (fuera de alcance de Export: el
 * tamaño real de una imagen a 300 vs 150 DPI lo determina el
 * `RenderPageProvider`, no este motor — Export solo empaqueta los bytes que
 * recibe).
 *
 * Métodos extra (`addJavaScript`, `getForm`, `copyPages`, `embedPdf`,
 * `attach`) son spies sin comportamiento: `export.engine.ts` nunca los llama
 * (checklist §15.10, spec §13 casos 8-10); los tests unit los usan para
 * verificarlo explícitamente.
 */
export function createMockPdfLibDocument(options?: MockPdfLibDocumentOptions): Record<string, unknown> {
  const pages: MockPdfPage[] = [];
  let saveAttempts = 0;
  let embedAttempts = 0;
  let embeddedBytesTotal = 0;
  let drawImageAttempts = 0;
  const saveFailTimes = options?.saveFailTimes ?? 0;
  const embedFailTimes = options?.embedFailTimes ?? 0;
  const drawImageFailTimes = options?.drawImageFailTimes ?? 0;

  function embed(bytes: ArrayBuffer | Uint8Array | string): Promise<{ width: number; height: number }> {
    embedAttempts++;
    if (embedAttempts <= embedFailTimes) {
      return Promise.reject(options?.embedError ?? new Error("embed failed"));
    }
    embeddedBytesTotal += typeof bytes === "string" ? bytes.length : bytes.byteLength;
    return Promise.resolve({ width: 100, height: 100 });
  }

  return {
    addPage: vi.fn((size: [number, number]) => {
      const page: MockPdfPage = {
        width: size[0],
        height: size[1],
        drawImage: vi.fn(() => {
          drawImageAttempts++;
          if (drawImageAttempts <= drawImageFailTimes) {
            throw options?.drawImageError ?? new Error("drawImage failed");
          }
        }),
      };
      pages.push(page);
      return page;
    }),
    removePage: vi.fn((index: number) => {
      pages.splice(index, 1);
    }),
    getPageCount: vi.fn(() => pages.length),
    embedJpg: vi.fn((bytes: ArrayBuffer | Uint8Array | string) => embed(bytes)),
    embedPng: vi.fn((bytes: ArrayBuffer | Uint8Array | string) => embed(bytes)),
    addJavaScript: vi.fn(),
    getForm: vi.fn(),
    copyPages: vi.fn(),
    embedPdf: vi.fn(),
    attach: vi.fn(),
    setProducer: vi.fn(),
    setCreator: vi.fn(),
    setCreationDate: vi.fn(),
    setTitle: vi.fn(),
    save: vi.fn(() => {
      saveAttempts++;
      if (saveAttempts <= saveFailTimes) {
        return Promise.reject(options?.saveError ?? new Error("save failed"));
      }
      if (options?.saveBytes) return Promise.resolve(options.saveBytes);
      const result = new Uint8Array(PDF_HEADER_BYTES.length + MOCK_SAVE_BASE_OVERHEAD + embeddedBytesTotal);
      result.set(PDF_HEADER_BYTES, 0);
      return Promise.resolve(result);
    }),
    pages,
  };
}

/**
 * Cast de frontera contra pdf-lib — permitido solo en este helper
 * (Code_Standards.md §10; precedente `mockGetDocumentResult`/`asLoadingTask`
 * en render-engine/pdf-engine): `PDFDocument` es una clase con decenas de
 * miembros que un mock estructural no puede satisfacer honestamente. Los
 * tests construyen el mock vía `createMockPdfLibDocument` y nunca castean
 * por su cuenta.
 */
export function asPdfDocument(doc: Record<string, unknown>): PDFDocument {
  return doc as unknown as PDFDocument;
}

// ─── Mock de RenderPageProvider ───

export interface MockRenderPageProviderOptions {
  readonly bytes?: ArrayBuffer;
  readonly format?: "png" | "jpeg";
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly error?: Error;
  readonly neverResolves?: boolean;
  readonly perPageImage?: (pageIndex: number) => EncodedPageImage;
}

export function createMockRenderPageProvider(
  options?: MockRenderPageProviderOptions,
): RenderPageProvider {
  const renderFull = vi.fn(
    (pageIndex: number, _replacements: ReadonlyArray<Replacement>, _abortSignal: AbortSignal) => {
      if (options?.neverResolves === true) {
        return new Promise<EncodedPageImage>(() => undefined);
      }
      if (options?.error) {
        return Promise.reject(options.error);
      }
      if (options?.perPageImage) {
        return Promise.resolve(options.perPageImage(pageIndex));
      }
      return Promise.resolve<EncodedPageImage>({
        bytes: options?.bytes ?? new Uint8Array([1, 2, 3, 4]).buffer,
        format: options?.format ?? "jpeg",
        widthPx: options?.widthPx ?? 100,
        heightPx: options?.heightPx ?? 100,
      });
    },
  );
  return { renderFull };
}

// ─── EngineContext / config mocks (mismo patrón que render-engine) ───

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

// ─── Builders de dominio ───

export function createPage(overrides?: Partial<Page>): Page {
  return {
    index: 0,
    width: 595,
    height: 842,
    words: [],
    text: "",
    requiresOCR: false,
    ocrCompleted: false,
    ...overrides,
  };
}

export function createDocumentMetadata(overrides?: Partial<DocumentMetadata>): DocumentMetadata {
  return {
    pdfVersion: "1.7",
    encrypted: false,
    hasForms: false,
    ...overrides,
  };
}

export function createDocument(overrides?: Partial<Document>): Document {
  const base: Document = {
    id: "doc-1",
    name: "test.pdf",
    pageCount: 1,
    pages: [createPage({ index: 0 })],
    metadata: createDocumentMetadata(),
    sourceKind: "text",
    importedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

export function createDocumentWithPageCount(
  pageCount: number,
  pageSize?: { readonly width: number; readonly height: number },
): Document {
  const width = pageSize?.width ?? 100;
  const height = pageSize?.height ?? 100;
  return createDocument({
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => createPage({ index, width, height })),
  });
}

export function createEntityGroup(overrides?: Partial<EntityGroup>): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.DNI,
    canonicalValue: "34.567.891",
    members: [
      {
        occurrenceId: "occ-1",
        pageIndex: 0,
        bbox: { x: 10, y: 20, width: 100, height: 14 },
        source: DetectionSource.Regex,
      },
    ],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[DNI 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createExportOptions(overrides?: Partial<ExportOptions>): ExportOptions {
  return {
    imageFormat: "jpeg",
    jpegQuality: 0.85,
    dpi: 150,
    includeOriginalMetadata: false,
    filename: "anonimizado.pdf",
    ...overrides,
  };
}

export function createExportEngineInput(overrides?: Partial<ExportEngineInput>): ExportEngineInput {
  return {
    documentId: "doc-1",
    document: createDocument(),
    groups: [createEntityGroup()],
    rules: [],
    options: createExportOptions(),
    renderPageProvider: createMockRenderPageProvider(),
    ...overrides,
  };
}
