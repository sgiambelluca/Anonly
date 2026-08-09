import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  type EngineContext,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { PdfEngine, decodePdfEngineOutput } from "../pdf.engine.js";
import { PdfCorruptedError, PdfInvalidError, PdfPasswordRequiredError } from "../pdf.errors.js";
import type { PdfEngineInput } from "../pdf.types.js";

import {
  createEngineContext,
  createMockPdfDocument,
  createValidInput,
  mockGetDocumentFailure,
  mockGetDocumentResult,
} from "./fixtures/test-helpers.js";

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

  // No numerado en §13 (regla de §9 Restricciones: buffer.byteLength === 0).
  describe("Empty buffer", () => {
    it("throws PdfInvalidError on empty buffer", async () => {
      await engine.init(ctx);
      const input: PdfEngineInput = { documentId: "doc-empty-buf", buffer: new ArrayBuffer(0) };

      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
      await expect(engine.process(input, ctx)).rejects.toThrow("Buffer vacío");
    });
  });

  // Caso 6 (§13): PDF corrupto (header inválido).
  describe("Caso 6: PDF corrupto (header inválido)", () => {
    it("throws PdfInvalidError on non-pdf buffer", async () => {
      await engine.init(ctx);
      const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]).buffer;
      const input: PdfEngineInput = { documentId: "doc-nonpdf", buffer };

      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
      await expect(engine.process(input, ctx)).rejects.toThrow("no comienza con %PDF-");
    });

    it("throws PdfInvalidError on corrupt header", async () => {
      await engine.init(ctx);
      const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x0a]).buffer;
      const input: PdfEngineInput = { documentId: "doc-corrupt-header", buffer };
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
    });

    it("throws PdfInvalidError when getDocument fails with an unknown error (ADR-020 §4)", async () => {
      // Reclasificado: un error desconocido a nivel de documento (getDocument)
      // ya no es PdfCorruptedError (reservado a fallos de página interna,
      // ver §11) — pasa a ser PdfInvalidError.
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentFailure(new Error("PDF object reference: unknown type")),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-parse-error");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: input null/undefined).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input null con InvalidInputError
      await expect(engine.process(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError for undefined input", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input undefined con InvalidInputError
      await expect(engine.process(undefined, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // Casos 3–4 (§13): PDF protegido con password correcto / incorrecto.
  describe("Casos 3–4: PDF protegido con password", () => {
    it("throws PdfPasswordRequiredError on protected without password", async () => {
      const pwdErr = new Error("Password required");
      pwdErr.name = "PasswordException";
      vi.mocked(getDocument).mockReturnValueOnce(mockGetDocumentFailure(pwdErr));

      await engine.init(ctx);
      const input = createValidInput("doc-pwd-required");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfPasswordRequiredError);
    });

    it("throws PdfPasswordRequiredError on wrong password", async () => {
      const pwdErr = new Error("IncorrectPassword");
      pwdErr.name = "PasswordException";
      vi.mocked(getDocument).mockReturnValueOnce(mockGetDocumentFailure(pwdErr));

      await engine.init(ctx);
      const input = createValidInput("doc-wrong-pwd", "wrong");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfPasswordRequiredError);
    });

    it("emits PDF_PASSWORD_REQUIRED event on password error", async () => {
      const pwdErr = new Error("Password required");
      pwdErr.name = "PasswordException";
      vi.mocked(getDocument).mockReturnValueOnce(mockGetDocumentFailure(pwdErr));

      await engine.init(ctx);
      const emitSpy = vi.spyOn(ctx.bus, "emit");
      const input = createValidInput("doc-pwd-spy");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfPasswordRequiredError);
      expect(emitSpy).toHaveBeenCalledWith(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, {
        documentId: "doc-pwd-spy",
      });
    });

    it("parses protected pdf with correct password", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-correct-pwd", "test1234");
      const output = await engine.process(input, ctx);
      expect(output.pageCount).toBe(1);
    });

    // ADR-049 §4: retryable pasa a false para que el flag sobreviva la serialización
    // cruzando el Worker (el instanceof de subclase concreta no sobrevive, el flag sí).
    it("PdfPasswordRequiredError is not retryable", () => {
      const err = new PdfPasswordRequiredError("doc-pwd-retryable");
      expect(err.retryable).toBe(false);
    });
  });

  // No numerado en §13 (regla de §9: password vacío no permitido).
  describe("Password vacío", () => {
    it("throws PdfInvalidError on empty password string", async () => {
      await engine.init(ctx);
      const input = createValidInput("doc-empty-pwd", "");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfInvalidError);
      await expect(engine.process(input, ctx)).rejects.toThrow("Password vacío");
    });
  });

  // Caso 10 (§13): PDF con JavaScript embebido.
  describe("Caso 10: PDF con JavaScript embebido", () => {
    it("ignores embedded JavaScript", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult({
          numPages: 2,
          getPage: vi.fn((_pageNum: number) =>
            Promise.resolve({
              getViewport: vi.fn(() => ({ width: 595, height: 842 })),
              getTextContent: vi.fn(() =>
                Promise.resolve({
                  items: [{ str: "Safe", transform: [1, 0, 0, 1, 50, 800], width: 30, height: 12 }],
                }),
              ),
            }),
          ),
          getMetadata: vi.fn(() =>
            Promise.resolve({ info: { Title: "JS Doc" }, metadata: undefined }),
          ),
          getJSActions: vi.fn(() =>
            Promise.resolve({
              doc: ["app.alert('Hello');"],
              "page:1": ["this.print({bUI: true});"],
            }),
          ),
          destroy: vi.fn(),
          _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
        }),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-js-actions");
      const output = await engine.process(input, ctx);

      expect(output.pageCount).toBe(2);
      expect(output.document.pages[0]!.words.length).toBe(1);
      expect(output.document.pages[0]!.words[0]!.text).toBe("Safe");
    });
  });

  // Caso 7 (§13): PDF corrupto (página interna inválida).
  describe("Caso 7: PDF corrupto (página interna inválida)", () => {
    it("throws PdfCorruptedError on internal page corruption", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(3, { throwOnGetPage: true })),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-page-corrupt");
      await expect(engine.process(input, ctx)).rejects.toThrow(PdfCorruptedError);
    });
  });

  // Caso 8 (§13): PDF con metadata sensible (author, XMP).
  describe("Caso 8: PDF con metadata sensible", () => {
    it("metadata excludes author and XMP sensitive", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
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
      );

      await engine.init(ctx);
      const input = createValidInput("doc-meta");
      const output = await engine.process(input, ctx);

      expect(output.document.metadata.title).toBe("My Document");
      expect(output.document.metadata.producer).toBe("LibreOffice");
      expect(output.document.metadata.creationTool).toBe("Jane Doe");
      // Assert por claves presentes (más fuerte que value === undefined, sin casts).
      const metadataKeys = Object.keys(output.document.metadata);
      expect(metadataKeys).not.toContain("Author");
      expect(metadataKeys).not.toContain("Subject");
    });

    it("does not expose XMP metadata in DocumentMetadata", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, {
            metadata: {
              Title: "Doc Title",
              Producer: "App",
              Creator: "User",
            },
          }),
        ),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-xmp");
      const output = await engine.process(input, ctx);

      // Assert por claves presentes (más fuerte que value === undefined, sin casts).
      const metadataKeys = Object.keys(output.document.metadata);
      expect(metadataKeys).not.toContain("xmpMetadata");
      expect(metadataKeys).not.toContain("metadata");
    });
  });

  // Caso 9 (§13): PDF con forms (AcroForm).
  describe("Caso 9: PDF con forms (AcroForm)", () => {
    it("hasForms = true for AcroForm pdf", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(1, { hasForms: true })),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-forms");
      const output = await engine.process(input, ctx);
      expect(output.document.metadata.hasForms).toBe(true);
    });

    it("sets hasForms=false when no AcroForm", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input = createValidInput("doc-noforms");
      const output = await engine.process(input, ctx);
      expect(output.document.metadata.hasForms).toBe(false);
    });
  });

  // Caso 1 (§13): PDF vacío (0 páginas).
  describe("Caso 1: PDF vacío (0 páginas)", () => {
    it("0 pages document returns cleanly", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult({
          numPages: 0,
          getPage: vi.fn(),
          getMetadata: vi.fn(() => Promise.resolve({ info: {}, metadata: undefined })),
          destroy: vi.fn(),
          _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
        }),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-zero-pages");
      const output = await engine.process(input, ctx);

      expect(output.pageCount).toBe(0);
      expect(output.document.pages.length).toBe(0);
      expect(output.textlessPages).toEqual([]);
      expect(output.sourceKind).toBe("text");
    });
  });

  // Caso base (§14, sin número en §13): ninguna página requiere OCR.
  describe("SourceKind detection: text (caso base)", () => {
    it("sourceKind = text when none textless", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(3)));

      await engine.init(ctx);
      const input = createValidInput("doc-text-kind");
      const output = await engine.process(input, ctx);
      expect(output.sourceKind).toBe("text");
    });
  });

  // Caso 11 (§13): PDF con páginas todas escaneadas.
  describe("Caso 11: PDF con páginas todas escaneadas", () => {
    it("sourceKind = scanned when all textless", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(2, { textless: true })),
      );

      await engine.init(ctx);
      const input = createValidInput("doc-all-scanned");
      const output = await engine.process(input, ctx);

      expect(output.sourceKind).toBe("scanned");
      expect(output.textlessPages).toEqual([0, 1]);
      expect(output.document.pages[0]!.requiresOCR).toBe(true);
    });
  });

  // No numerado en §13 (mixto: intermedio entre casos 1 y 11).
  describe("Mixed text/textless pages", () => {
    it("sourceKind = mixed", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
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
      );

      await engine.init(ctx);
      const input = createValidInput("doc-mixed-kind");
      const output = await engine.process(input, ctx);

      expect(output.sourceKind).toBe("mixed");
    });
  });

  // Caso 20 (§13, ADR-063): matriz degenerada (a=b=0, o c=d=0) no divide por
  // cero — el versor correspondiente cae al comportamiento horizontal.
  describe("Caso 20: matriz de transform degenerada (ADR-063)", () => {
    it("degenerate transform matrix does not divide by zero", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(
          createMockPdfDocument(1, () => ({
            getViewport: vi.fn(() => ({ width: 595, height: 500 })),
            getTextContent: vi.fn(() =>
              Promise.resolve({
                items: [
                  // a=b=0 (dir degenerado) -> dir cae a (1,0); c=0,d=1 válido.
                  { str: "Deg1", transform: [0, 0, 0, 1, 100, 100], width: 50, height: 10 },
                  // c=d=0 (up degenerado) -> up cae a (0,1); a=1,b=0 válido.
                  { str: "Deg2", transform: [1, 0, 0, 0, 200, 200], width: 40, height: 8 },
                ],
              }),
            ),
          })),
        ),
      );

      await engine.init(ctx);
      const output = await engine.process(createValidInput("doc-degenerate-matrix"), ctx);
      const words = output.document.pages[0]!.words;

      const wordDeg1 = words.find((w) => w.text === "Deg1");
      const wordDeg2 = words.find((w) => w.text === "Deg2");
      expect(wordDeg1).toBeDefined();
      expect(wordDeg2).toBeDefined();

      for (const value of [
        wordDeg1!.bbox.x,
        wordDeg1!.bbox.y,
        wordDeg1!.bbox.width,
        wordDeg1!.bbox.height,
        wordDeg2!.bbox.x,
        wordDeg2!.bbox.y,
        wordDeg2!.bbox.width,
        wordDeg2!.bbox.height,
      ]) {
        expect(Number.isNaN(value)).toBe(false);
      }

      expect(wordDeg1!.bbox).toEqual({ x: 100, y: 390, width: 50, height: 10 });
      expect(wordDeg2!.bbox).toEqual({ x: 200, y: 292, width: 40, height: 8 });
    });
  });

  // Caso 13 (§13): process llamado tras dispose.
  describe("Caso 13: process llamado tras dispose", () => {
    it("process after dispose throws", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const input = createValidInput("doc-after-dispose");
      await expect(engine.process(input, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  // No numerado en §13 (cancelación cooperativa, ver §12).
  describe("Cancellation during processing", () => {
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

      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult({
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
          _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
        }),
      );

      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });
      await engine.init(ctxWithAbort);
      const input = createValidInput("doc-cancel-mid");
      await expect(engine.process(input, ctxWithAbort)).rejects.toThrow(CancelledError);
    });
  });

  // No numerado en §13 (password es un campo opcional; su ausencia es válida).
  describe("Password absent (optional field omitted)", () => {
    it("parses normally when password field is absent", async () => {
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

      await engine.init(ctx);
      const input: PdfEngineInput = {
        documentId: "doc-no-pwd-field",
        buffer: createValidInput("tmp").buffer,
      };
      const output = await engine.process(input, ctx);
      expect(output.pageCount).toBe(1);
    });
  });

  // No numerado en §13 (ADR-020 §3: límite de configuración, no caso límite del spec).
  describe("maxPageCount exceeded", () => {
    it("throws PdfInvalidError when page count exceeds maxPageCount", async () => {
      const limitedCtx = createEngineContext({
        config: {
          ...ctx.config,
          pdf: { maxPageCount: 2 },
        },
      });

      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(3)));

      await engine.init(limitedCtx);
      const emitSpy = vi.spyOn(limitedCtx.bus, "emit");
      const input = createValidInput("doc-too-many-pages");

      await expect(engine.process(input, limitedCtx)).rejects.toThrow(PdfInvalidError);
      expect(emitSpy).toHaveBeenCalledWith(
        EventChannel.Pdf,
        EngineEvents.PDF_INVALID,
        expect.objectContaining({ documentId: "doc-too-many-pages" }),
      );
    });
  });

  // ADR-020 §3: política única de señalización — todo error fatal de parseo
  // emite PDF_INVALID antes de lanzar.
  describe("Fatal parse errors emit PDF_INVALID before throwing", () => {
    it("emits PDF_INVALID before throwing on fatal parse errors", async () => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument(1, { throwOnGetPage: true })),
      );

      await engine.init(ctx);
      const emitSpy = vi.spyOn(ctx.bus, "emit");
      const input = createValidInput("doc-emit-before-throw");

      await expect(engine.process(input, ctx)).rejects.toThrow(PdfCorruptedError);
      expect(emitSpy).toHaveBeenCalledWith(
        EventChannel.Pdf,
        EngineEvents.PDF_INVALID,
        expect.objectContaining({ documentId: "doc-emit-before-throw" }),
      );
    });
  });

  // ADR-055 §3/§10, PDF_Engine.md §13 caso 17. Lo que se prueba acá no es que
  // el decoder "valide": es que ante una forma que no reconoce LANCE, en vez
  // de devolver un default y dejar que el pipeline avance con un Document
  // roto. Ese fallo mudo es el modo de falla que ADR-055 existe para cerrar.
  describe("decodePdfEngineOutput rejects anything that is not a PdfEngineOutput", () => {
    const validOutput = {
      document: {
        id: "doc-1",
        name: "d.pdf",
        pageCount: 1,
        pages: [],
        metadata: {},
        sourceKind: "text",
        importedAt: 0,
      },
      pageCount: 1,
      textlessPages: [],
      sourceKind: "text",
    };

    it("decodePdfEngineOutput throws InvalidInputError on garbage", () => {
      const garbage: ReadonlyArray<unknown> = [null, undefined, "x", 42, true, [], {}];

      for (const value of garbage) {
        expect(() => decodePdfEngineOutput(value)).toThrow(InvalidInputError);
      }
    });

    it("decodePdfEngineOutput throws on missing or mistyped fields", () => {
      const broken: ReadonlyArray<unknown> = [
        { ...validOutput, document: undefined },
        { ...validOutput, pageCount: undefined },
        { ...validOutput, textlessPages: undefined },
        { ...validOutput, sourceKind: undefined },
        { ...validOutput, sourceKind: "raster" }, // fuera del union
        { ...validOutput, pageCount: "1" },
        { ...validOutput, textlessPages: [0, "1"] }, // array con un no-number
        { ...validOutput, document: { id: "doc-1" } }, // sin `pages`
        { ...validOutput, document: { id: 7, pages: [] } }, // `id` no-string
        { ...validOutput, document: { id: "doc-1", pages: {} } }, // `pages` no-array
      ];

      for (const value of broken) {
        expect(() => decodePdfEngineOutput(value)).toThrow(InvalidInputError);
      }
    });

    it("decodePdfEngineOutput throws on an enveloped result", () => {
      // La regresión concreta de ADR-055 (Contexto §1) trasladada a PDF: un
      // resultado por lo demás perfecto, envuelto. Antes de este decoder,
      // `dispatch<PdfEngineOutput>` lo aceptaba en silencio y el pipeline
      // seguía con `document`/`textlessPages` undefined.
      expect(() => decodePdfEngineOutput({ output: validOutput })).toThrow(InvalidInputError);
      expect(() => decodePdfEngineOutput({ result: validOutput })).toThrow(InvalidInputError);
    });

    it("decodePdfEngineOutput error details carry shape, never content", () => {
      // Code_Standards.md §9: el valor sospechoso puede traer el texto
      // extraído entero; el `details` reporta claves y tipos, nunca contenido.
      const secret = "Juan Pérez, DNI 30123456";
      let caught: unknown;
      try {
        decodePdfEngineOutput({ output: { text: secret } });
      } catch (err: unknown) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InvalidInputError);
      const details = (caught as InvalidInputError).details;
      const serialized = JSON.stringify(details);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("Juan");
      expect(details).toMatchObject({ receivedShape: "object(keys=[output])" });
    });
  });
});
