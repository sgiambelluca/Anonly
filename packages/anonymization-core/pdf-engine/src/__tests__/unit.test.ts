import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type {
  EngineContext,
  ILogger,
  ICache,
  EngineConfig,
  IEventBus,
  Unsubscribe,
  Word,
} from "@anonly/shared";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

import { getDocument } from "pdfjs-dist";

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
    ner: { modelId: "test", quantization: "q8", confidenceThreshold: 0.7, batchSize: 1, enabled: false },
    ocr: { languages: ["spa"], dpi: 300, pageTimeoutMs: 60000 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
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

  return {
    documentId,
    buffer: combined.buffer,
  };
}

function createMockPage(
  pageIndex: number,
  textItems?: ReadonlyArray<{ str: string; x: number; y: number; width: number; height: number }>,
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

function createMockPdfDocument(
  pageCount: number,
  pageFactory?: (pageIndex: number) => Record<string, unknown>,
): Record<string, unknown> {
  const pages: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push(pageFactory ? pageFactory(i) : createMockPage(i));
  }

  return {
    numPages: pageCount,
    getPage: vi.fn((pageNum: number) => Promise.resolve(pages[pageNum - 1])),
    getMetadata: vi.fn(() => Promise.resolve({ info: { Title: "Test" }, metadata: null })),
    destroy: vi.fn(),
    isEncrypted: false,
    pdfVersion: "1.7",
  };
}

describe("PdfEngine — unit tests", () => {
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

  describe("Word sorting (reading order)", () => {
    it("sorts words by y asc then x asc", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "Bottom", x: 10, y: 600, width: 40, height: 12 },
              { str: "Top", x: 10, y: 800, width: 30, height: 12 },
              { str: "Middle", x: 10, y: 700, width: 40, height: 12 },
              { str: "TopRight", x: 200, y: 800, width: 50, height: 12 },
            ]),
          ),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-sort");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words[0]!.text).toBe("Top");
      expect(words[1]!.text).toBe("TopRight");
      expect(words[2]!.text).toBe("Middle");
      expect(words[3]!.text).toBe("Bottom");
    });

    it("on same y line, sorts by x asc", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "ZWord", x: 200, y: 800, width: 40, height: 12 },
              { str: "AWord", x: 10, y: 800, width: 40, height: 12 },
              { str: "BWord", x: 100, y: 800, width: 40, height: 12 },
            ]),
          ),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-same-y");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words[0]!.text).toBe("AWord");
      expect(words[1]!.text).toBe("BWord");
      expect(words[2]!.text).toBe("ZWord");
    });
  });

  describe("Textless pages detection", () => {
    it("marks page with empty text content as requiresOCR=true", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-textless");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.words.length).toBe(0);
      expect(output.textlessPages).toEqual([0]);
    });

    it("marks page with text content as requiresOCR=false", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(2)),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-text");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(false);
      expect(output.document.pages[0]!.words.length).toBeGreaterThan(0);
      expect(output.textlessPages).toEqual([]);
    });
  });

  describe("TextlessPages sorted asc", () => {
    it("returns textlessPages in ascending order", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(4, (i: number) => {
            const textless = i === 1 || i === 3;
            return textless
              ? {
                  getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                  getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
                }
              : createMockPage(i);
          }),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-textless-asc");
      const output = await engine.process(input, ctx);

      expect(output.textlessPages).toEqual([1, 3]);
    });
  });

  describe("SourceKind detection", () => {
    it("sourceKind = text when no textless pages", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(3)),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-text-kind");
      const output = await engine.process(input, ctx);
      expect(output.sourceKind).toBe("text");
    });

    it("sourceKind = scanned when all pages are textless", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(2, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-scanned");
      const output = await engine.process(input, ctx);
      expect(output.sourceKind).toBe("scanned");
    });

    it("sourceKind = mixed when some pages are textless", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(3, (i: number) => {
            const textless = i === 1;
            return textless
              ? {
                  getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                  getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
                }
              : createMockPage(i);
          }),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-mixed");
      const output = await engine.process(input, ctx);
      expect(output.sourceKind).toBe("mixed");
    });
  });

  describe("FuseOcrPage logic", () => {
    it("fuseOcrPage updates words and marks ocrCompleted", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-fuse-unit");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.ocrCompleted).toBe(false);

      const ocrWords: Word[] = [
        { text: "Hello", bbox: { x: 50, y: 800, width: 30, height: 12 }, pageIndex: 0, confidence: 0.9, source: "ocr" },
        { text: "World", bbox: { x: 90, y: 800, width: 30, height: 12 }, pageIndex: 0, confidence: 0.9, source: "ocr" },
      ];

      const updatedDoc = await engine.fuseOcrPage("doc-fuse-unit", 0, ocrWords);

      expect(updatedDoc.pages[0]!.ocrCompleted).toBe(true);
      expect(updatedDoc.pages[0]!.words.length).toBe(2);
      expect(updatedDoc.pages[0]!.words[0]!.text).toBe("Hello");
      expect(updatedDoc.pages[0]!.words[0]!.source).toBe("ocr");
      expect(updatedDoc.pages[0]!.text).toContain("Hello");
    });

    it("fuseOcrPage returns a new Document reference (immutable)", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      });

      await engine.init(ctx);
      const input = createValidInput("doc-immutable");
      const originalOutput = await engine.process(input, ctx);

      const words: Word[] = [
        { text: "New", bbox: { x: 10, y: 800, width: 30, height: 12 }, pageIndex: 0, confidence: 0.9, source: "ocr" },
      ];

      const updatedDoc = await engine.fuseOcrPage("doc-immutable", 0, words);

      expect(updatedDoc).not.toBe(originalOutput.document);
      expect(originalOutput.document.pages[0]!.words.length).toBe(0);
      expect(updatedDoc.pages[0]!.words.length).toBe(1);
    });
  });
});
