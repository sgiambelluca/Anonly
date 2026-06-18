import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type BoundingBox,
  type Document,
  type DocumentMetadata,
  type EngineContext,
  type IEngine,
  type Page,
  type PdfEngineConfig,
  type Word,
} from "@anonly/shared";
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";

import {
  PdfCorruptedError,
  PdfInvalidError,
  PdfPasswordRequiredError,
  PdfTimeoutError,
} from "./pdf.errors.js";
import type { PdfEngineInput, PdfEngineOutput } from "./pdf.types.js";

const DEFAULT_MAX_PAGE_COUNT = 10_000;
const DEFAULT_TIMEOUT_MS_PER_PAGE = 30_000;

/*
 * `_pdfInfo` es una propiedad pública en la clase PDFDocumentProxy
 * (tipo `any`), usada para acceder a isEncrypted y pdfVersion que no
 * están en la interfaz pública de TypeScript.
 */
export class PdfEngine implements IEngine {
  readonly id = EngineId.Pdf;

  private ctx: EngineContext | null = null;
  private config: PdfEngineConfig = {
    maxPageCount: DEFAULT_MAX_PAGE_COUNT,
  };
  private documents: Map<string, Document> = new Map();
  private initialized = false;
  private disposed = false;

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      maxPageCount: ctx.config.pdf.maxPageCount ?? DEFAULT_MAX_PAGE_COUNT,
    };
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("PDF Engine initialized");
    return Promise.resolve();
  }

  async process(input: PdfEngineInput, operationCtx: EngineContext): Promise<PdfEngineOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Pdf });
    }

    const { documentId, buffer, password } = input;

    if (buffer.byteLength === 0) {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "Buffer vacío.",
      });
      throw new PdfInvalidError(documentId, "Buffer vacío.");
    }

    if (password !== undefined && password.length === 0) {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "Password vacío no permitido.",
      });
      throw new PdfInvalidError(documentId, "Password vacío no permitido.");
    }

    if (operationCtx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const header = new Uint8Array(buffer, 0, 5);
    const headerStr = new TextDecoder().decode(header);
    if (headerStr !== "%PDF-") {
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: "No es un PDF válido: header no comienza con %PDF-.",
      });
      throw new PdfInvalidError(documentId, "No es un PDF válido: header no comienza con %PDF-.");
    }

    let pdfDocument: PDFDocumentProxy;
    try {
      const loadingTask = getDocument({
        data: buffer,
        password,
        useWorkerFetch: false,
      });
      pdfDocument = await loadingTask.promise;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";

      if (
        name === "PasswordException" ||
        message.toLowerCase().includes("password") ||
        message.includes("NeedsPwd") ||
        message.includes("IncorrectPassword")
      ) {
        operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId });
        throw new PdfPasswordRequiredError(documentId);
      }
      if (
        name === "InvalidPDFException" ||
        message.toLowerCase().includes("invalid") ||
        message.toLowerCase().includes("corrupt")
      ) {
        operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
          documentId,
          reason: message,
        });
        throw new PdfInvalidError(documentId, message);
      }
      throw new PdfCorruptedError(documentId, message);
    }

    if (operationCtx.abortSignal.aborted) {
      void pdfDocument.destroy();
      throw new CancelledError(documentId);
    }

    const pageCount = pdfDocument.numPages;

    if (pageCount > this.config.maxPageCount) {
      void pdfDocument.destroy();
      throw new PdfInvalidError(
        documentId,
        `El documento supera el límite de ${this.config.maxPageCount} páginas.`,
      );
    }

    const pages: Page[] = [];
    const textlessPages: number[] = [];

    for (let i = 1; i <= pageCount; i++) {
      if (operationCtx.abortSignal.aborted) {
        void pdfDocument.destroy();
        throw new CancelledError(documentId);
      }

      const pageIndex = i - 1;

      let pageProxy: PDFPageProxy;
      try {
        pageProxy = await pdfDocument.getPage(i);
      } catch (err: unknown) {
        void pdfDocument.destroy();
        const message = err instanceof Error ? err.message : String(err);
        throw new PdfCorruptedError(documentId, message, pageIndex);
      }

      const viewport = pageProxy.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      let words: Word[];
      try {
        const timeoutMs =
          operationCtx.config.workerPool.timeouts["pdf-parse"] ?? DEFAULT_TIMEOUT_MS_PER_PAGE;
        const textContent = await this.parsePageTextWithTimeout(pageProxy, pageIndex, timeoutMs);
        words = this.convertTextItemsToWords(textContent, pageIndex, pageHeight);
      } catch (err: unknown) {
        void pdfDocument.destroy();
        if (err instanceof PdfTimeoutError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new PdfCorruptedError(documentId, message, pageIndex);
      }

      const sortedWords = this.sortWordsByReadingOrder(words);
      const text = sortedWords.map((w) => w.text).join(" ");
      const requiresOCR = sortedWords.length === 0;

      if (requiresOCR) {
        textlessPages.push(pageIndex);
      }

      const page: Page = {
        index: pageIndex,
        width: pageWidth,
        height: pageHeight,
        words: sortedWords,
        text,
        requiresOCR,
        ocrCompleted: false,
      };
      pages.push(page);

      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId,
        pageIndex,
        wordCount: sortedWords.length,
        requiresOCR,
      });
    }

    textlessPages.sort((a, b) => a - b);
    const sourceKind = this.determineSourceKind(textlessPages, pageCount);

    const metadata = await this.extractMetadata(pdfDocument);
    void pdfDocument.destroy();

    const document: Document = {
      id: documentId,
      name: "",
      pageCount,
      pages,
      metadata,
      sourceKind,
      importedAt: Date.now(),
    };

    this.documents.set(documentId, document);

    operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
      documentId,
      pageCount,
      textlessPages,
      sourceKind,
    });

    operationCtx.logger.info(`Documento parseado: ${documentId}`, {
      pageCount,
      textlessPagesCount: textlessPages.length,
      sourceKind,
    });

    const output: PdfEngineOutput = {
      document,
      pageCount,
      textlessPages,
      sourceKind,
    };

    return output;
  }

  fuseOcrPage(
    documentId: string,
    pageIndex: number,
    words: ReadonlyArray<Word>,
  ): Promise<Document> {
    try {
      this.assertNotDisposed();
      this.assertInitialized();

      const doc = this.documents.get(documentId);
      if (!doc) {
        return Promise.reject(
          new InvalidInputError(`Documento ${documentId} no encontrado.`, { documentId }),
        );
      }

      if (pageIndex < 0 || pageIndex >= doc.pageCount) {
        return Promise.reject(
          new InvalidInputError(
            `pageIndex ${pageIndex} fuera de rango para documento con ${doc.pageCount} páginas.`,
            { documentId, pageIndex, pageCount: doc.pageCount },
          ),
        );
      }

      const existingPage = doc.pages[pageIndex];
      if (!existingPage) {
        return Promise.reject(
          new InvalidInputError(`Página ${pageIndex} no encontrada en documento ${documentId}.`, {
            documentId,
            pageIndex,
          }),
        );
      }

      const normalizedWords: Word[] = words.map((w) => ({
        text: w.text,
        bbox: w.bbox,
        pageIndex,
        confidence: w.confidence,
        source: "ocr" as const,
      }));

      const sortedWords = this.sortWordsByReadingOrder(normalizedWords);
      const mergedText = sortedWords.map((w) => w.text).join(" ");

      const updatedPage: Page = {
        ...existingPage,
        words: sortedWords,
        text: mergedText,
        requiresOCR: true,
        ocrCompleted: true,
      };

      const updatedPages = doc.pages.map((p) => (p.index === pageIndex ? updatedPage : p));

      const updatedDocument: Document = {
        ...doc,
        pages: updatedPages,
      };

      this.documents.set(documentId, updatedDocument);

      return Promise.resolve(updatedDocument);
    } catch (err: unknown) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.documents.clear();
    this.ctx = null;
    this.initialized = false;
    return Promise.resolve();
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new EngineNotInitializedError(EngineId.Pdf);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Pdf);
    }
  }

  /* TextContent from pdfjs-dist has items: Array<TextItem | TextMarkedContent>.
   * TextMarkedContent (type/id only) is filtered out in convertTextItemsToWords.
   * The `as` cast is valid because the structural subset (optional str/transform/width/height)
   * is compatible with both TextItem and TextMarkedContent shapes. */
  private async parsePageTextWithTimeout(
    pageProxy: PDFPageProxy,
    pageIndex: number,
    timeoutMs: number,
  ): Promise<{
    items: ReadonlyArray<{
      str?: string;
      transform?: readonly number[];
      width?: number;
      height?: number;
    }>;
  }> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new PdfTimeoutError("", pageIndex, timeoutMs));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([pageProxy.getTextContent(), timeoutPromise]);
      return result as {
        items: ReadonlyArray<{
          str?: string;
          transform?: readonly number[];
          width?: number;
          height?: number;
        }>;
      };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private convertTextItemsToWords(
    textContent: {
      items: ReadonlyArray<{
        str?: string;
        transform?: readonly number[];
        width?: number;
        height?: number;
      }>;
    },
    pageIndex: number,
    pageHeight: number,
  ): Word[] {
    const words: Word[] = [];

    for (const item of textContent.items) {
      if (!item.str || item.str.trim().length === 0 || !item.transform) continue;

      const x = item.transform[4] ?? 0;
      const baselineY = item.transform[5] ?? 0;
      const width = item.width ?? 0;
      const height = item.height ?? 12;

      const bbox: BoundingBox = {
        x,
        y: pageHeight - baselineY - height,
        width,
        height,
      };

      words.push({
        text: item.str,
        bbox,
        pageIndex,
        confidence: 1.0,
        source: "pdf",
      });
    }

    return words;
  }

  private sortWordsByReadingOrder(words: ReadonlyArray<Word>): Word[] {
    const sorted = [...words];
    sorted.sort((a, b) => {
      const dy = a.bbox.y - b.bbox.y;
      if (Math.abs(dy) > 1) return dy;
      return a.bbox.x - b.bbox.x;
    });
    return sorted;
  }

  private determineSourceKind(
    textlessPages: ReadonlyArray<number>,
    pageCount: number,
  ): "text" | "scanned" | "mixed" {
    if (textlessPages.length === 0) return "text";
    if (textlessPages.length === pageCount) return "scanned";
    return "mixed";
  }

  private async extractMetadata(pdfDocument: PDFDocumentProxy): Promise<DocumentMetadata> {
    let title: string | undefined;
    let producer: string | undefined;
    let creationTool: string | undefined;
    let pdfVersion = "1.4";
    let encrypted = false;
    let hasForms = false;

    try {
      const result = await pdfDocument.getMetadata();
      const info = result.info as Record<string, unknown> | undefined;
      if (info) {
        if (typeof info.Title === "string") title = info.Title;
        if (typeof info.Producer === "string") producer = info.Producer;
        if (typeof info.Creator === "string") creationTool = info.Creator;
        hasForms = info.IsAcroFormPresent === true;
        if (typeof info.PDFVersion === "string") {
          pdfVersion = info.PDFVersion;
        }
      }
    } catch {
      // metadata no disponible — valores por defecto
    }

    try {
      const pdfInfo = pdfDocument._pdfInfo as
        | { encrypted?: boolean; pdfVersion?: string }
        | undefined;
      encrypted = pdfInfo?.encrypted === true;
      if (typeof pdfInfo?.pdfVersion === "string") {
        pdfVersion = pdfInfo.pdfVersion;
      }
    } catch {
      // no se pudo determinar isEncrypted ni pdfVersion
    }

    const md: DocumentMetadata = {
      pdfVersion,
      encrypted,
      hasForms,
      ...(title !== undefined ? { title } : {}),
      ...(producer !== undefined ? { producer } : {}),
      ...(creationTool !== undefined ? { creationTool } : {}),
    };
    return md;
  }
}
