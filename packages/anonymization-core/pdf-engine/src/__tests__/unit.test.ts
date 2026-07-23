import { InvalidInputError, type EngineContext, type Word } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { PdfEngine, fuseOcrPage } from "../pdf.engine.js";
import { PdfTimeoutError } from "../pdf.errors.js";

import {
  createEngineContext,
  createMockPage,
  createMockPdfDocument,
  createValidInput,
  mockGetDocumentResult,
} from "./fixtures/test-helpers.js";

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
    it("words sorted by y then x", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "Bottom", x: 10, y: 600, width: 40, height: 12 },
              { str: "Top", x: 10, y: 800, width: 30, height: 12 },
              { str: "Middle", x: 10, y: 700, width: 40, height: 12 },
              { str: "TopRight", x: 200, y: 800, width: 50, height: 12 },
            ]),
          ),
        ),
      );

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
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [
              { str: "ZWord", x: 200, y: 800, width: 40, height: 12 },
              { str: "AWord", x: 10, y: 800, width: 40, height: 12 },
              { str: "BWord", x: 100, y: 800, width: 40, height: 12 },
            ]),
          ),
        ),
      );

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
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-textless");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.words.length).toBe(0);
      expect(output.textlessPages).toEqual([0]);
    });

    it("marks page with text content as requiresOCR=false", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(2)));

      await engine.init(ctx);
      const input = createValidInput("doc-text");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(false);
      expect(output.document.pages[0]!.words.length).toBeGreaterThan(0);
      expect(output.textlessPages).toEqual([]);
    });
  });

  describe("TextlessPages sorted asc", () => {
    it("textlessPages sorted asc", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
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
      );

      await engine.init(ctx);
      const input = createValidInput("doc-textless-asc");
      const output = await engine.process(input, ctx);

      expect(output.textlessPages).toEqual([1, 3]);
    });
  });

  describe("Word splitting (ADR-020 §1)", () => {
    it("splits multi-word TextItems into individual words with prorated bboxes", async () => {
      const accentedWord = "Juan Pérez 34.567.891";

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: accentedWord, x: 50, y: 800, width: 210, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-word-split");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words.length).toBe(3);
      expect(words.map((w) => w.text)).toEqual(["Juan", "Pérez", "34.567.891"]);

      // x crece monotónicamente (orden de lectura preservado)
      expect(words[0]!.bbox.x).toBeLessThan(words[1]!.bbox.x);
      expect(words[1]!.bbox.x).toBeLessThan(words[2]!.bbox.x);

      // y/height se conservan idénticos para todos los tokens del mismo TextItem
      expect(words[0]!.bbox.y).toBe(words[1]!.bbox.y);
      expect(words[1]!.bbox.y).toBe(words[2]!.bbox.y);
      expect(words[0]!.bbox.height).toBe(12);

      // Los widths prorrateados suman ≈ el width original (la diferencia es el
      // ancho atribuido a los 2 espacios, que no pertenecen a ningún token).
      const totalWidth = words.reduce((sum, w) => sum + w.bbox.width, 0);
      expect(totalWidth).toBeGreaterThan(150);
      expect(totalWidth).toBeLessThanOrEqual(210);
    });

    it("does not split a single-word TextItem (keeps original bbox, only NFC applies)", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: "SingleWord", x: 50, y: 800, width: 60, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-single-word");
      const output = await engine.process(input, ctx);
      const words = output.document.pages[0]!.words;

      expect(words.length).toBe(1);
      expect(words[0]!.text).toBe("SingleWord");
      expect(words[0]!.bbox.x).toBe(50);
      expect(words[0]!.bbox.width).toBe(60);
    });
  });

  describe("NFC normalization (ADR-020 §2)", () => {
    it("normalizes word text to NFC", async () => {
      // Construidas con escapes Unicode explícitos (fuente 100% ASCII) para
      // no depender de cómo el editor codifique un acento tipeado
      // literalmente:
      // NFD = "P" + "e" + combining acute accent (U+0301) + "rez" (6 chars).
      // NFC = "P" + "é" precompuesta (U+00E9) + "rez" (5 chars).
      const nfdPerez = "Pérez";
      const nfcPerez = "Pérez";
      expect(nfdPerez.length).toBe(6);
      expect(nfcPerez.length).toBe(5);
      expect(nfdPerez).not.toBe(nfcPerez);
      expect(nfdPerez.normalize("NFC")).toBe(nfcPerez);

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () =>
            createMockPage(0, [{ str: nfdPerez, x: 50, y: 800, width: 40, height: 12 }]),
          ),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-nfc");
      const output = await engine.process(input, ctx);
      const page = output.document.pages[0]!;

      expect(page.words[0]!.text).toBe(nfcPerez);
      expect(page.words[0]!.text.length).toBe(5);
      expect(page.text).toContain(nfcPerez);
    });
  });

  describe("Timeout handling (ADR-020 §5)", () => {
    it("throws PdfTimeoutError with documentId when page parse exceeds timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(getDocument).mockReturnValue(
          mockGetDocumentResult({
            numPages: 1,
            getPage: vi.fn(() =>
              Promise.resolve({
                getViewport: vi.fn(() => ({ width: 595, height: 842 })),
                getTextContent: vi.fn(() => new Promise(() => {})),
              }),
            ),
            getMetadata: vi.fn(() => Promise.resolve({ info: {}, metadata: undefined })),
            destroy: vi.fn(),
            _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
          }),
        );

        await engine.init(ctx);
        const input = createValidInput("doc-timeout");
        const resultPromise = engine.process(input, ctx);
        const caught = resultPromise.catch((err: unknown) => err);

        await vi.advanceTimersByTimeAsync(30001);

        const err = await caught;
        expect(err).toBeInstanceOf(PdfTimeoutError);
        if (!(err instanceof PdfTimeoutError)) throw new Error("expected PdfTimeoutError");
        expect(err.details.documentId).toBe("doc-timeout");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("FuseOcrPage logic", () => {
    it("fuseOcrPage updates words and marks ocrCompleted", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-fuse-unit");
      const output = await engine.process(input, ctx);

      expect(output.document.pages[0]!.requiresOCR).toBe(true);
      expect(output.document.pages[0]!.ocrCompleted).toBe(false);

      const ocrWords: Word[] = [
        {
          text: "Hello",
          bbox: { x: 50, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
        {
          text: "World",
          bbox: { x: 90, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
      ];

      const updatedDoc = fuseOcrPage(output.document, 0, ocrWords);

      expect(updatedDoc.pages[0]!.ocrCompleted).toBe(true);
      expect(updatedDoc.pages[0]!.words.length).toBe(2);
      expect(updatedDoc.pages[0]!.words[0]!.text).toBe("Hello");
      expect(updatedDoc.pages[0]!.words[0]!.source).toBe("ocr");
      expect(updatedDoc.pages[0]!.text).toContain("Hello");
    });

    it("fuseOcrPage returns a new Document reference (immutable)", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 842 })),
            getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          })),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-immutable");
      const originalOutput = await engine.process(input, ctx);

      const words: Word[] = [
        {
          text: "New",
          bbox: { x: 10, y: 800, width: 30, height: 12 },
          pageIndex: 0,
          confidence: 0.9,
          source: "ocr",
        },
      ];

      const updatedDoc = fuseOcrPage(originalOutput.document, 0, words);

      expect(updatedDoc).not.toBe(originalOutput.document);
      expect(originalOutput.document.pages[0]!.words.length).toBe(0);
      expect(updatedDoc.pages[0]!.words.length).toBe(1);
    });
  });

  describe("fuseOcrPage — pageIndex fuera de rango (ADR-041, caso 15)", () => {
    it("fuseOcrPage on unknown pageIndex throws InvalidInputError", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(2, { textless: true })),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-range-unit");
      const output = await engine.process(input, ctx);

      expect(() => fuseOcrPage(output.document, 99, [])).toThrow(InvalidInputError);
    });
  });
});
