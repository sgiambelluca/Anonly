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

/* TextContent from pdfjs-dist has items: Array<TextItem | TextMarkedContent>.
 * TextMarkedContent (type/id only) is filtered out in convertTextItemsToWords.
 * The `as` cast at the call site is valid because the structural subset
 * (optional str/transform/width/height) is compatible with both TextItem and
 * TextMarkedContent shapes. */
type TextContentLike = {
  items: ReadonlyArray<{
    str?: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
  }>;
};

/*
 * Funciones de módulo (ADR-013 §6, ADR-020 §10): parsePage() y sus helpers no
 * asumen host ni worker — Hito 9 las envuelve en un job del worker sin
 * modificarlas. No emiten eventos: la emisión queda en process() (host).
 */

async function parsePageTextWithTimeout(
  pageProxy: PDFPageProxy,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): Promise<TextContentLike> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PdfTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([pageProxy.getTextContent(), timeoutPromise]);
    return result as TextContentLike;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/*
 * ADR-020 §1: PDF.js devuelve un TextItem por run (frecuentemente línea/frase
 * entera), no por palabra. Se divide str por whitespace en Words individuales,
 * prorrateando x/width linealmente por longitud de caracteres (aproximación:
 * asume ancho de carácter constante dentro del run). y/height se conservan.
 * Con un solo token, se conserva el bbox del item completo (comportamiento
 * previo) y solo se aplica normalización NFC (ADR-020 §2).
 */
function convertTextItemsToWords(
  textContent: TextContentLike,
  pageIndex: number,
  pageHeight: number,
): Word[] {
  const words: Word[] = [];

  for (const item of textContent.items) {
    if (!item.str || item.str.trim().length === 0 || !item.transform) continue;

    const str = item.str;
    const x = item.transform[4] ?? 0;
    const baselineY = item.transform[5] ?? 0;
    const width = item.width ?? 0;
    const height = item.height ?? 12;
    const y = pageHeight - baselineY - height;

    const tokens = [...str.matchAll(/\S+/g)];

    if (tokens.length <= 1) {
      const text = (tokens[0]?.[0] ?? str).normalize("NFC");
      const bbox: BoundingBox = { x, y, width, height };
      words.push({ text, bbox, pageIndex, confidence: 1.0, source: "pdf" });
      continue;
    }

    const charWidth = str.length > 0 ? width / str.length : 0;
    for (const token of tokens) {
      const tokenText = token[0];
      if (tokenText === undefined) continue;
      const offset = token.index ?? 0;
      const bbox: BoundingBox = {
        x: x + charWidth * offset,
        y,
        width: charWidth * tokenText.length,
        height,
      };
      words.push({
        text: tokenText.normalize("NFC"),
        bbox,
        pageIndex,
        confidence: 1.0,
        source: "pdf",
      });
    }
  }

  return words;
}

function sortWordsByReadingOrder(words: ReadonlyArray<Word>): Word[] {
  const sorted = [...words];
  sorted.sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 1) return dy;
    return a.bbox.x - b.bbox.x;
  });
  return sorted;
}

/*
 * ADR-020 §10: parsePage() puro — obtiene la página, viewport y texto (con
 * timeout), convierte a Words y arma la Page. Lanza PdfCorruptedError /
 * PdfTimeoutError con el documentId correcto (ADR-020 §5). No emite eventos.
 */
async function parsePage(
  pdfDocument: PDFDocumentProxy,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): Promise<Page> {
  const pageNum = pageIndex + 1;

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageNum);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfCorruptedError(documentId, message, pageIndex);
  }

  const viewport = pageProxy.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  let words: Word[];
  try {
    const textContent = await parsePageTextWithTimeout(pageProxy, documentId, pageIndex, timeoutMs);
    words = convertTextItemsToWords(textContent, pageIndex, pageHeight);
  } catch (err: unknown) {
    if (err instanceof PdfTimeoutError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfCorruptedError(documentId, message, pageIndex);
  }

  const sortedWords = sortWordsByReadingOrder(words);
  const text = sortedWords.map((w) => w.text).join(" ");
  const requiresOCR = sortedWords.length === 0;

  const page: Page = {
    index: pageIndex,
    width: pageWidth,
    height: pageHeight,
    words: sortedWords,
    text,
    requiresOCR,
    ocrCompleted: false,
  };
  return page;
}

// EngineError.details es Readonly<Record<string, unknown>>; `reason` es un
// string en PdfCorruptedError, pero el tipo no lo garantiza estáticamente.
function reasonFromCorruptedError(err: PdfCorruptedError): string {
  const { reason } = err.details;
  return typeof reason === "string" ? reason : err.message;
}

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
      // ADR-020 §4: cualquier error a nivel de documento (matcheado por "invalid"/
      // "corrupt" o desconocido) se reclasifica como PdfInvalidError. PDF_CORRUPTED
      // queda reservado a fallos de página interna (getPage/getTextContent).
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
        documentId,
        reason: message,
      });
      throw new PdfInvalidError(documentId, message);
    }

    if (operationCtx.abortSignal.aborted) {
      void pdfDocument.destroy();
      throw new CancelledError(documentId);
    }

    const pageCount = pdfDocument.numPages;

    if (pageCount > this.config.maxPageCount) {
      void pdfDocument.destroy();
      const reason = `El documento supera el límite de ${this.config.maxPageCount} páginas.`;
      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, { documentId, reason });
      throw new PdfInvalidError(documentId, reason);
    }

    const pages: Page[] = [];
    const textlessPages: number[] = [];
    const timeoutMs =
      operationCtx.config.workerPool.timeouts["pdf-parse"] ?? DEFAULT_TIMEOUT_MS_PER_PAGE;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      if (operationCtx.abortSignal.aborted) {
        void pdfDocument.destroy();
        throw new CancelledError(documentId);
      }

      let page: Page;
      try {
        page = await parsePage(pdfDocument, documentId, pageIndex, timeoutMs);
      } catch (err: unknown) {
        void pdfDocument.destroy();
        // ADR-020 §3: todo error fatal de parseo emite su evento antes de lanzar.
        // PdfTimeoutError no emite (la señal es el rechazo de la promesa; el
        // retry queda diferido al WorkerPool en Hito 9, ver ADR-020 §5).
        if (err instanceof PdfCorruptedError) {
          operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PDF_INVALID, {
            documentId,
            reason: reasonFromCorruptedError(err),
          });
        }
        throw err;
      }

      if (page.requiresOCR) {
        textlessPages.push(page.index);
      }
      pages.push(page);

      operationCtx.bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId,
        pageIndex: page.index,
        wordCount: page.words.length,
        requiresOCR: page.requiresOCR,
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

      // ADR-020 §6: fuseOcrPage solo aplica a páginas genuinamente textless.
      // Antes se pisaban en silencio las palabras nativas de una página con
      // texto real y se forzaba requiresOCR=true incondicionalmente.
      if (existingPage.requiresOCR !== true) {
        return Promise.reject(
          new InvalidInputError(
            `La página ${pageIndex} del documento ${documentId} no requiere OCR (requiresOCR=false); ` +
              "fuseOcrPage solo aplica a páginas sin texto nativo.",
            { documentId, pageIndex },
          ),
        );
      }

      const normalizedWords: Word[] = words.map((w) => ({
        text: w.text.normalize("NFC"),
        bbox: w.bbox,
        pageIndex,
        confidence: w.confidence,
        source: "ocr" as const,
      }));

      const sortedWords = sortWordsByReadingOrder(normalizedWords);
      const mergedText = sortedWords.map((w) => w.text).join(" ");

      // requiresOCR ya es true (precondición del guard); no se fuerza, se
      // hereda del spread de existingPage.
      const updatedPage: Page = {
        ...existingPage,
        words: sortedWords,
        text: mergedText,
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

  // ADR-020 §7: evicción individual, idempotente. Sin asserts: debe ser seguro
  // llamarlo en cualquier secuencia de teardown, incluso tras dispose().
  releaseDocument(documentId: string): void {
    this.documents.delete(documentId);
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
