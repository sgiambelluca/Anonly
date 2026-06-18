import {
  type EngineConfig,
  type EngineContext,
  type ICache,
  type IEventBus,
  type ILogger,
  type Unsubscribe,
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

function buildSnapshotInput(): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(200).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  return { documentId: "snapshot-doc", buffer: combined.buffer };
}

function createSnapshotPdfDocument(): Record<string, unknown> {
  return {
    numPages: 3,
    getPage: vi.fn((pageNum: number) => {
      const pages: Record<string, unknown>[] = [
        {
          getViewport: vi.fn(() => ({ width: 595, height: 842 })),
          getTextContent: vi.fn(() =>
            Promise.resolve({
              items: [
                { str: "First", transform: [1, 0, 0, 1, 50, 800], width: 30, height: 12 },
                { str: "Page", transform: [1, 0, 0, 1, 85, 800], width: 30, height: 12 },
              ],
            }),
          ),
        },
        {
          getViewport: vi.fn(() => ({ width: 612, height: 792 })),
          getTextContent: vi.fn(() =>
            Promise.resolve({
              items: [
                { str: "Second", transform: [1, 0, 0, 1, 50, 750], width: 40, height: 12 },
                { str: "Page", transform: [1, 0, 0, 1, 100, 750], width: 30, height: 12 },
                { str: "Content", transform: [1, 0, 0, 1, 140, 750], width: 50, height: 12 },
              ],
            }),
          ),
        },
        {
          getViewport: vi.fn(() => ({ width: 595, height: 842 })),
          getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
        },
      ];
      return Promise.resolve(pages[pageNum - 1]);
    }),
    getMetadata: vi.fn(() =>
      Promise.resolve({
        info: { Title: "Snapshot Doc", Producer: "Test", Creator: "TestRunner" },
        metadata: undefined,
      }),
    ),
    getViewport: vi.fn(),
    destroy: vi.fn(),
    isEncrypted: false,
    pdfVersion: "1.7",
  };
}

describe("PdfEngine — snapshot", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567_890_000);
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("DocumentModel snapshot is stable for a known PDF structure", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(createSnapshotPdfDocument()),
    } as unknown as ReturnType<typeof getDocument>);

    await engine.init(ctx);
    const input = buildSnapshotInput();
    const output = await engine.process(input, ctx);

    expect(output).toMatchSnapshot();
  });
});
