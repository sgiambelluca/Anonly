import {
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type Unsubscribe,
  type Word,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ADR-065 §1 (compuerta 1): el motor bajo prueba lee `OPS` real (save,
// restore, transform, paintImageXObject, ...); `importOriginal` lo preserva
// mientras solo `getDocument` queda mockeado.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});

import { PdfEngine, fuseOcrPage } from "../pdf.engine.js";

import {
  createEngineContext,
  createMockPage,
  createMockPdfDocument,
  createValidInput,
  mockGetDocumentResult,
} from "./fixtures/test-helpers.js";

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

    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(pageCount)));

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

    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(pageCount)));

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

    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(pageCount)));

    await engine.init(ctx);
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);

    expect(output.pageCount).toBe(pageCount);
    expect(output.document.pageCount).toBe(pageCount);
    expect(output.document.pages.length).toBe(pageCount);
  });

  it("pages[i].index === i", async () => {
    const docId = "doc-index-invariant";
    const pageCount = 5;

    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(pageCount)));

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

    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument(2, { textless: true })),
    );

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

    const updatedDoc = fuseOcrPage(output.document, 0, ocrWords);

    expect(updatedDoc.pages[0]!.words.length).toBe(2);
    expect(updatedDoc.pages[0]!.words[0]!.text).toBe("OCR");
    expect(updatedDoc.pages[0]!.words[0]!.source).toBe("ocr");
    expect(updatedDoc.pages[0]!.ocrCompleted).toBe(true);
    expect(updatedDoc.pages[1]!.words.length).toBe(0);
    expect(updatedDoc.pages[1]!.ocrCompleted).toBe(false);
  });

  it("fuseOcrPage on non-OCR page throws InvalidInputError", async () => {
    const docId = "doc-fuse-guard";

    // Documento con texto nativo (requiresOCR = false en todas las páginas).
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

    await engine.init(ctx);
    const input = createValidInput(docId);
    const output = await engine.process(input, ctx);
    expect(output.document.pages[0]!.requiresOCR).toBe(false);

    expect(() => fuseOcrPage(output.document, 0, [])).toThrow(InvalidInputError);
  });

  it("dispose releases PDFDocumentProxy", async () => {
    const mockDoc = createMockPdfDocument(1);
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    await engine.init(ctx);
    const input = createValidInput("doc-dispose");
    await engine.process(input, ctx);

    expect(mockDoc.destroy).toHaveBeenCalledTimes(1);

    await engine.dispose();

    expect(engine["initialized"]).toBe(false);
    expect(engine["disposed"]).toBe(true);
  });

  // ADR-065 §4: invariante de PdfEngineOutput — los dos caminos de OCR
  // (página entera vs. región) nunca comparten pageIndex.
  it("ocrRegions and textlessPages are disjoint", async () => {
    const imageRectPdfSpace = { x: 50, y: 50, width: 400, height: 600 };

    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument(2, (i: number) => {
          if (i === 0) {
            // Página 0: textless — va por fuseOcrPage (página entera).
            return {
              getViewport: vi.fn(() => ({ width: 595, height: 842 })),
              getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
              getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
            };
          }
          // Página 1: texto nativo + imagen grande sin texto encima — candidata a región.
          return createMockPage(
            i,
            [{ str: "Header", x: 500, y: 800, width: 50, height: 12 }],
            [imageRectPdfSpace],
          );
        }),
      ),
    );

    await engine.init(ctx);
    const input = createValidInput("doc-disjoint-invariant");
    const output = await engine.process(input, ctx);

    expect(output.textlessPages).toEqual([0]);
    expect(output.ocrRegions.map((r) => r.pageIndex)).toEqual([1]);

    const textlessSet = new Set(output.textlessPages);
    const intersection = output.ocrRegions
      .map((r) => r.pageIndex)
      .filter((pageIndex) => textlessSet.has(pageIndex));
    expect(intersection).toEqual([]);
  });

  it("engine never subscribes to the bus (ADR-014)", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument(2, { textless: true })),
    );

    // Spies nombrados (no referencias de método del bus) para evitar
    // @typescript-eslint/unbound-method en los asserts.
    const onSpy = vi.fn((): Unsubscribe => vi.fn());
    const onceSpy = vi.fn((): Unsubscribe => vi.fn());
    const busCtx = createEngineContext({
      bus: {
        on: onSpy,
        once: onceSpy,
        off: vi.fn(),
        emit: vi.fn(),
        emitAsync: vi.fn(() => Promise.resolve()),
      },
    });

    await engine.init(busCtx);
    const input = createValidInput("doc-no-subscribe");
    await engine.process(input, busCtx);

    expect(onSpy).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
  });
});
