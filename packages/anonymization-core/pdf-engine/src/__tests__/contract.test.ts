import {
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineConfig,
  type EngineContext,
  type ICache,
  type IEventBus,
  type ILogger,
  type Unsubscribe,
  type Word,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { PdfEngine } from "../pdf.engine.js";
import type { PdfEngineInput } from "../pdf.types.js";

function createMockBus(): IEventBus {
  return {
    on: vi.fn((): Unsubscribe => vi.fn()),
    once: vi.fn((): Unsubscribe => vi.fn()),
    off: vi.fn(),
    emit: vi.fn(),
    emitAsync: vi.fn(() => Promise.resolve()),
  };
}

function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockCache(): ICache {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    size: 0,
    bytes: 0,
  };
}

function createMockConfig(): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 2,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 2,
      maxQueuePerPool: 32,
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
    ocr: { languages: ["spa"], dpi: 300, pageTimeoutMs: 60000 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
  };
}

function createMockPage(pageIndex: number): Record<string, unknown> {
  return {
    getViewport: vi.fn(() => ({ width: 595, height: 842 })),
    getTextContent: vi.fn(() =>
      Promise.resolve({
        items: [
          { str: `Page${pageIndex}Word1`, transform: [1, 0, 0, 1, 50, 800], width: 50, height: 12 },
          {
            str: `Page${pageIndex}Word2`,
            transform: [1, 0, 0, 1, 110, 800],
            width: 50,
            height: 12,
          },
        ],
      }),
    ),
  };
}

function createMockPdfDocument(
  pageCount: number,
  options?: { textless?: boolean; metadata?: Record<string, unknown>; hasForms?: boolean },
): Record<string, unknown> {
  const pages: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (options?.textless) {
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
    getPage: vi.fn((pageNum: number) => Promise.resolve(pages[pageNum - 1])),
    getMetadata: vi.fn(() =>
      Promise.resolve({
        info: {
          ...(options?.metadata ?? { Title: "Test Doc" }),
          IsAcroFormPresent: options?.hasForms === true,
        },
        metadata: undefined,
      }),
    ),
    destroy: vi.fn(),
    isEncrypted: false,
    pdfVersion: "1.7",
  };
}

function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
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

function createValidInput(documentId: string): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(100).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  return { documentId, buffer: combined.buffer };
}

describe("PdfEngine — contract tests", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Pdf);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("process() before init() throws EngineNotInitializedError", async () => {
    const input = createValidInput("doc-1");
    await expect(engine.process(input, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("process() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    const input = createValidInput("doc-1");
    await expect(engine.process(input, ctx)).rejects.toThrow(EngineDisposedError);
  });

  it("emits PAGE_PARSED for each page", async () => {
    const docId = "doc-parse-test";
    const pageCount = 3;

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(pageCount)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);
    expect(busEmitSpy).toHaveBeenCalledTimes(pageCount + 1);
    for (let i = 0; i < pageCount; i++) {
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Pdf,
        EngineEvents.PAGE_PARSED,
        expect.objectContaining({
          documentId: docId,
          pageIndex: i,
          wordCount: 2,
          requiresOCR: false,
        }),
      );
    }
    expect(output.pageCount).toBe(pageCount);
  });

  it("emits DOCUMENT_PARSED after all pages", async () => {
    const docId = "doc-parse-test-2";
    const pageCount = 2;

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(pageCount)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const input = createValidInput(docId);
    await engine.process(input, ctx);
    expect(busEmitSpy).toHaveBeenCalledWith(
      EventChannel.Pdf,
      EngineEvents.DOCUMENT_PARSED,
      expect.objectContaining({
        documentId: docId,
        pageCount,
        textlessPages: [],
        sourceKind: "text",
      }),
    );
  });

  it("output has pageCount === pages.length", async () => {
    const docId = "doc-invariant";
    const pageCount = 4;

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(pageCount)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);

    expect(output.pageCount).toBe(pageCount);
    expect(output.document.pageCount).toBe(pageCount);
    expect(output.document.pages.length).toBe(pageCount);
  });

  it("pages[i].index === i for all i", async () => {
    const docId = "doc-index-invariant";
    const pageCount = 5;

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(pageCount)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);

    for (let i = 0; i < pageCount; i++) {
      const page = output.document.pages[i];
      expect(page).toBeDefined();
      expect(page!.index).toBe(i);
    }
  });

  it("fuseOcrPage merges words correctly", async () => {
    const docId = "doc-fuse";

    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(2, { textless: true })),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);

    expect(output.textlessPages).toContain(0);
    expect(output.textlessPages).toContain(1);

    const ocrWords: Word[] = [
      {
        text: "OCR",
        bbox: { x: 50, y: 800, width: 30, height: 12 },
        pageIndex: 0,
        confidence: 0.85,
        source: "ocr",
      },
      {
        text: "Word",
        bbox: { x: 90, y: 800, width: 30, height: 12 },
        pageIndex: 0,
        confidence: 0.85,
        source: "ocr",
      },
    ];

    const updatedDoc = await engine.fuseOcrPage(docId, 0, ocrWords);

    expect(updatedDoc.pages[0]!.words.length).toBe(2);
    expect(updatedDoc.pages[0]!.words[0]!.text).toBe("OCR");
    expect(updatedDoc.pages[0]!.words[0]!.source).toBe("ocr");
    expect(updatedDoc.pages[0]!.ocrCompleted).toBe(true);
    expect(updatedDoc.pages[1]!.words.length).toBe(0);
    expect(updatedDoc.pages[1]!.ocrCompleted).toBe(false);
  });

  it("dispose releases resources and clears documents", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(1)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = createValidInput("doc-dispose");
    await engine.process(input, ctx);

    expect(engine["documents"].size).toBe(1);

    await engine.dispose();

    expect(engine["documents"].size).toBe(0);
    expect(engine["initialized"]).toBe(false);
    expect(engine["disposed"]).toBe(true);
  });

  it("fuseOcrPage on unknown documentId throws InvalidInputError", async () => {
    await engine.init(ctx);
    await expect(engine.fuseOcrPage("unknown-doc", 0, [])).rejects.toThrow(InvalidInputError);
  });

  it("fuseOcrPage with out-of-range pageIndex throws InvalidInputError", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createMockPdfDocument(2)),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = createValidInput("doc-range");
    await engine.process(input, ctx);

    await expect(engine.fuseOcrPage("doc-range", 99, [])).rejects.toThrow(InvalidInputError);
  });
});
