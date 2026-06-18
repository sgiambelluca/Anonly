import { CancelledError, EngineDisposedError, InvalidInputError } from "@anonly/shared";
import type {
  EngineConfig,
  EngineContext,
  ICache,
  IEventBus,
  ILogger,
  Unsubscribe,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { PdfEngine } from "../pdf.engine.js";
import { PdfCorruptedError, PdfInvalidError, PdfPasswordRequiredError } from "../pdf.errors.js";
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

function createValidInput(documentId: string, pwd?: string): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(100).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  if (pwd !== undefined) {
    return { documentId, buffer: combined.buffer, password: pwd };
  }
  return { documentId, buffer: combined.buffer };
}

type MockDocOptions = {
  metadata?: Record<string, unknown>;
  hasForms?: boolean;
  textless?: boolean;
  throwOnGetPage?: boolean;
};

type PageFactory = (pageIndex: number) => Record<string, unknown>;

function createMockPdfDocument(
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
      isEncrypted: false,
      pdfVersion: "1.7",
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
      pages.push({
        getViewport: vi.fn(() => ({ width: 595, height: 842 })),
        getTextContent: vi.fn(() =>
          Promise.resolve({
            items: [{ str: "Word1", transform: [1, 0, 0, 1, 50, 800], width: 30, height: 12 }],
          }),
        ),
      });
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
    isEncrypted: false,
    pdfVersion: "1.7",
  };
}

describe("PdfEngine — edge case tests", () => {
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

  describe("Case 1: Empty buffer", () => {
    it("throws PdfInvalidError on empty buffer", async () => {
      await engine.init(ctx);
      const input: PdfEngineInput = { documentId: "doc-empty-buf", buffer: new ArrayBuffer(0) };

      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
      await expect(engine.process(input, ctx)).rejects.toThrow("Buffer vacío");
    });
  });

  describe("Case 2: Non-PDF buffer (header check)", () => {
    it("throws PdfInvalidError on non-pdf header", async () => {
      await engine.init(ctx);
      const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]).buffer;
      const input: PdfEngineInput = { documentId: "doc-nonpdf", buffer };

      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
      await expect(engine.process(input, ctx)).rejects.toThrow("no comienza con %PDF-");
    });
  });

  describe("Case 3: Null/undefined input", () => {
    it("throws InvalidInputError for null input", async () => {
      await engine.init(ctx);
      await expect(engine.process(null as unknown as PdfEngineInput, ctx)).rejects.toThrow(
        InvalidInputError,
      );
    });

    it("throws InvalidInputError for undefined input", async () => {
      await engine.init(ctx);
      await expect(engine.process(undefined as unknown as PdfEngineInput, ctx)).rejects.toThrow(
        InvalidInputError,
      );
    });
  });

  describe("Case 4: PDF with password", () => {
    it("throws PdfPasswordRequiredError when password is required but not provided", async () => {
      const pwdErr = new Error("Password required");
      pwdErr.name = "PasswordException";
      vi.mocked(getDocument).mockReturnValueOnce({
        promise: Promise.reject(pwdErr),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-pwd-required");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfPasswordRequiredError);
    });

    it("throws PdfPasswordRequiredError on wrong password", async () => {
      const pwdErr = new Error("IncorrectPassword");
      pwdErr.name = "PasswordException";
      vi.mocked(getDocument).mockReturnValueOnce({
        promise: Promise.reject(pwdErr),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-wrong-pwd", "wrong");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfPasswordRequiredError);
    });

    it("parses normally with correct password", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(1)),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-correct-pwd", "test1234");
      const output = await engine.process(input, ctx);
      expect(output.pageCount).toBe(1);
    });
  });

  describe("Case 5: Corrupt header (PdfInvalidError)", () => {
    it("throws PdfInvalidError for corrupt header (no %PDF- starting)", async () => {
      await engine.init(ctx);
      const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x0a]).buffer;
      const input: PdfEngineInput = { documentId: "doc-corrupt-header", buffer };
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
    });
  });

  describe("Case 6: Internal page corruption (PdfCorruptedError)", () => {
    it("throws PdfCorruptedError when pdfjs fails to parse a page", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(3, { throwOnGetPage: true })),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-page-corrupt");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfCorruptedError);
    });

    it("throws PdfCorruptedError when pdfjs throws on getDocument", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.reject(new Error("PDF object reference: unknown type")),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-parse-error");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfCorruptedError);
    });
  });

  describe("Case 7: Metadata does not expose sensitive fields", () => {
    it("extracts non-sensitive metadata (Title, Producer, Creator)", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(1, {
            metadata: {
              Title: "My Document",
              Producer: "LibreOffice",
              Creator: "Jane Doe",
              Author: "Jane Doe (sensitive)",
              Subject: "Confidential (sensitive)",
            },
          }),
        ),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-meta");
      const output = await engine.process(input, ctx);

      expect(output.document.metadata.title).toBe("My Document");
      expect(output.document.metadata.producer).toBe("LibreOffice");
      expect(output.document.metadata.creationTool).toBe("Jane Doe");
      expect(
        (output.document.metadata as unknown as Record<string, unknown>).Author,
      ).toBeUndefined();
    });
  });

  describe("Case 8: hasForms = true for AcroForm PDF", () => {
    it("detects AcroForm in catalog and sets hasForms=true", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(1, { hasForms: true })),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-forms");
      const output = await engine.process(input, ctx);
      expect(output.document.metadata.hasForms).toBe(true);
    });

    it("sets hasForms=false when no AcroForm", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(1)),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-noforms");
      const output = await engine.process(input, ctx);
      expect(output.document.metadata.hasForms).toBe(false);
    });
  });

  describe("Case 9: 0 pages document", () => {
    it("returns cleanly with pageCount=0", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve({
          numPages: 0,
          getPage: vi.fn(),
          getMetadata: vi.fn(() => Promise.resolve({ info: {}, metadata: undefined })),
          destroy: vi.fn(),
          isEncrypted: false,
          pdfVersion: "1.7",
        }),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-zero-pages");
      const output = await engine.process(input, ctx);

      expect(output.pageCount).toBe(0);
      expect(output.document.pages.length).toBe(0);
      expect(output.textlessPages).toEqual([]);
      expect(output.sourceKind).toBe("text");
    });
  });

  describe("Case 10: All textless pages (scanned)", () => {
    it("sourceKind = scanned when all pages are textless", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(2, { textless: true })),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-all-scanned");
      const output = await engine.process(input, ctx);

      expect(output.sourceKind).toBe("scanned");
      expect(output.textlessPages).toEqual([0, 1]);
      expect(output.document.pages[0]!.requiresOCR).toBe(true);
    });
  });

  describe("Case 11: Mixed text/textless pages", () => {
    it("sourceKind = mixed when some pages have text and some don't", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(
          createMockPdfDocument(3, (i: number) => {
            const textless = i === 1;
            return textless
              ? {
                  getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                  getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
                }
              : {
                  getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                  getTextContent: vi.fn(() =>
                    Promise.resolve({
                      items: [
                        { str: "Text", transform: [1, 0, 0, 1, 50, 800], width: 30, height: 12 },
                      ],
                    }),
                  ),
                };
          }),
        ),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input = createValidInput("doc-mixed-kind");
      const output = await engine.process(input, ctx);

      expect(output.sourceKind).toBe("mixed");
    });
  });

  describe("Case 12: process after dispose", () => {
    it("throws EngineDisposedError when process is called after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const input = createValidInput("doc-after-dispose");
      await expect(engine.process(input, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  describe("Case 13: Cancellation during processing", () => {
    it("throws CancelledError when abort is signalled before parsing", async () => {
      const abortController = new AbortController();
      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(ctxWithAbort);
      const input = createValidInput("doc-cancelled");
      await expect(engine.process(input, ctxWithAbort)).rejects.toThrow(CancelledError);
    });

    it("throws CancelledError when abort is signalled during page iteration", async () => {
      let pageCallCount = 0;
      const abortController = new AbortController();

      const mockPage = {
        getViewport: vi.fn(() => ({ width: 595, height: 842 })),
        getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
      };

      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve({
          numPages: 5,
          getPage: vi.fn(() => {
            pageCallCount++;
            if (pageCallCount >= 2) {
              abortController.abort();
            }
            return Promise.resolve(mockPage);
          }),
          getMetadata: vi.fn(() => Promise.resolve({ info: {}, metadata: undefined })),
          destroy: vi.fn(),
          isEncrypted: false,
          pdfVersion: "1.7",
        }),
      } as unknown as ReturnType<typeof getDocument>);

      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });
      await engine.init(ctxWithAbort);
      const input = createValidInput("doc-cancel-mid");
      await expect(engine.process(input, ctxWithAbort)).rejects.toThrow(CancelledError);
    });
  });

  describe("Case 14: Password absent (optional field omitted)", () => {
    it("parses normally when password field is absent", async () => {
      vi.mocked(getDocument).mockReturnValue({
        promise: Promise.resolve(createMockPdfDocument(1)),
      } as unknown as ReturnType<typeof getDocument>);

      await engine.init(ctx);
      const input: PdfEngineInput = {
        documentId: "doc-no-pwd-field",
        buffer: createValidInput("tmp").buffer,
      };
      const output = await engine.process(input, ctx);
      expect(output.pageCount).toBe(1);
    });
  });
});
