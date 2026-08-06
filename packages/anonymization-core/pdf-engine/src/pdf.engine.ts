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

/**
 * Prefijos first-party de los assets de pdfjs-dist que sirve la app bajo
 * `/pdfjs/` (ADR-053 §3/§4/§5, copiados de `node_modules` en `predev`/
 * `prebuild` de `apps/react-client` — PR B1 de ADR-053 §9). Constantes de
 * módulo, NO un campo de `EngineConfig` (mismo patrón que
 * `NER_LOCAL_MODEL_PATH`/`NER_WASM_PATH` en `ner-engine/src/worker/kernel.ts`
 * y que `RENDER_PDFJS_CMAP_URL`/`RENDER_PDFJS_STANDARD_FONT_DATA_URL` en
 * `render-engine/src/worker/kernel.ts`): `public/` se copia verbatim, sin
 * hashear, así que pdfjs-dist resuelve estos 169 archivos por nombre contra
 * un prefijo estable — no hace falta que el Core los conozca por config.
 */
const PDF_ENGINE_PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const PDF_ENGINE_PDFJS_STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

/**
 * `CMapReaderFactory` propia para `getDocument()` (ADR-053 §2/§5, trampa 2 de
 * Contexto §6): pdf.js instancia la CLASE que se le pasa en
 * `CMapReaderFactory` — nunca una instancia —, así que esto es exactamente lo
 * que necesita, ni más ni menos. Usa `fetch()` pelado: a diferencia de
 * `DOMCMapReaderFactory` de pdf.js (no exportada por el paquete, por eso no se
 * extiende — solo se implementa su forma), NUNCA referencia `document`, que no
 * existe dentro del `PdfWorker` (ADR-036 §2/`05_Worker_Architecture.md` §7.1).
 * Contrato (ADR-053 §2, verificado contra `pdfjs-dist@4.10.38/build/pdf.mjs`
 * líneas 6032-6060, `BaseCMapReaderFactory`): constructor
 * `{ baseUrl, isCompressed }`, `fetch({ name })` ->
 * `{ cMapData: Uint8Array, isCompressed }`, URL = `baseUrl + name +
 * (isCompressed ? ".bcmap" : "")`. Duplicada intencionalmente respecto de la
 * homónima de `render-engine` (no se importa de ahí: P-2 lo prohíbe).
 */
export class PdfEngineCMapReaderFactory {
  private readonly baseUrl: string;
  private readonly isCompressed: boolean;

  constructor(params: { readonly baseUrl: string; readonly isCompressed: boolean }) {
    this.baseUrl = params.baseUrl;
    this.isCompressed = params.isCompressed;
  }

  async fetch(params: {
    readonly name: string;
  }): Promise<{ readonly cMapData: Uint8Array; readonly isCompressed: boolean }> {
    const url = `${this.baseUrl}${params.name}${this.isCompressed ? ".bcmap" : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el CMap en ${url} (status ${response.status}).`);
    }
    const buffer = await response.arrayBuffer();
    return { cMapData: new Uint8Array(buffer), isCompressed: this.isCompressed };
  }
}

/**
 * `StandardFontDataFactory` propia para `getDocument()` (ADR-053 §2/§5, misma
 * trampa 2 que la factory de arriba): reemplaza a `DOMStandardFontDataFactory`
 * de pdf.js, que toca `document.baseURI` en su primer fetch. Contrato
 * (ADR-053 §2, verificado contra `pdf.mjs` líneas 6407-6431,
 * `BaseStandardFontDataFactory`): constructor `{ baseUrl }`, `fetch({
 * filename })` -> `Uint8Array`, URL = `baseUrl + filename`. Duplicada
 * intencionalmente respecto de la homónima de `render-engine` (P-2).
 */
export class PdfEngineStandardFontDataFactory {
  private readonly baseUrl: string;

  constructor(params: { readonly baseUrl: string }) {
    this.baseUrl = params.baseUrl;
  }

  async fetch(params: { readonly filename: string }): Promise<Uint8Array> {
    const url = `${this.baseUrl}${params.filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `No se pudo cargar la fuente estándar en ${url} (status ${response.status}).`,
      );
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
}

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
 * ADR-041: fuseOcrPage es una función pura y síncrona, sin instancia ni
 * estado retenido. El caller (Orchestrator) provee el Document que él mismo
 * retiene como copia canónica y persiste el resultado — no hay lookup por
 * documentId ni asserts de initialized/disposed (no hay instancia). Preserva
 * el guard de ADR-020 §6 (requiresOCR) y la normalización NFC (ADR-020 §2).
 * Reemplaza al método PdfEngine.fuseOcrPage; el caso "documento no
 * encontrado" desaparece porque el caller siempre provee el Document.
 */
export function fuseOcrPage(
  document: Document,
  pageIndex: number,
  words: ReadonlyArray<Word>,
): Document {
  const existingPage = document.pages[pageIndex];
  if (pageIndex < 0 || pageIndex >= document.pageCount || existingPage === undefined) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${document.pageCount} páginas.`,
      { pageIndex },
    );
  }

  // ADR-020 §6: fuseOcrPage solo aplica a páginas genuinamente textless.
  if (existingPage.requiresOCR !== true) {
    throw new InvalidInputError(
      `La página ${pageIndex} del documento ${document.id} no requiere OCR (requiresOCR=false); ` +
        "fuseOcrPage solo aplica a páginas sin texto nativo.",
      { documentId: document.id, pageIndex },
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

  const updatedPages = document.pages.map((p) => (p.index === pageIndex ? updatedPage : p));

  return {
    ...document,
    pages: updatedPages,
  };
}

// ─── Decoder del `COMPLETED.result` del PdfWorker (ADR-055 §10, nota v1.4.0
// de PDF_Engine.md) ───
//
// A diferencia de los otros cuatro motores, `pdf-engine` NO tiene puerto
// interno de despacho que angostar a `Promise<unknown>` (ADR-055 §2): nunca se
// partió en mitad host + kernel (ADR-043/045/046/047), su entry-point corre el
// motor real completo (ADR-036 §3) y por lo tanto el único consumidor de un
// resultado suyo que cruzó un `postMessage` vive en el façade
// (`orchestrator.ts`, stage de extracción). El guard lo escribe igual ESTE
// motor —es el que conoce el contrato de su propio worker, ADR-055 §8— y se
// exporta para que el façade lo invoque host-side sobre un `dispatch<unknown>`.
// Misma forma que `fuseOcrPage` (ADR-041): función pura de este paquete,
// ejecutada por el façade, que como façade sí puede importar de un motor (P-1).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PDF_SOURCE_KINDS: ReadonlySet<string> = new Set(["text", "scanned", "mixed"]);

/**
 * Detalle legible de una forma no reconocida, para el `details` del
 * `InvalidInputError`. Reporta SOLO la forma —claves y tipos—, nunca el
 * contenido del valor (`Code_Standards.md` §9: nunca loguear contenido del
 * documento; acá el valor sospechoso puede contener el texto extraído entero).
 */
function describeDispatchResultShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (isRecord(value)) return `object(keys=[${Object.keys(value).join(", ")}])`;
  return typeof value;
}

/**
 * Type predicate, no un `as`: es lo que permite que `decodePdfEngineOutput`
 * devuelva `PdfEngineOutput` sin un solo cast sobre el valor que cruzó la
 * frontera (ADR-055, Validación: "ningún `as` sobre el resultado de un
 * `dispatch`"). Lo que el guard no chequea —el interior de `pages`— queda
 * cubierto por el contrato del propio motor, que es quien produjo ese array:
 * la duda que ADR-055 cierra es si el valor viene del `PdfEngine` o de otra
 * cosa, no si `PdfEngine` construyó mal sus propias páginas.
 */
function isPdfEngineOutput(value: unknown): value is PdfEngineOutput {
  return (
    isRecord(value) &&
    isRecord(value.document) &&
    typeof value.document.id === "string" &&
    Array.isArray(value.document.pages) &&
    typeof value.pageCount === "number" &&
    Array.isArray(value.textlessPages) &&
    value.textlessPages.every((p): boolean => typeof p === "number") &&
    typeof value.sourceKind === "string" &&
    PDF_SOURCE_KINDS.has(value.sourceKind)
  );
}

/**
 * Decodifica un valor que cruzó la frontera del `PdfWorker` y lo devuelve
 * tipado como `PdfEngineOutput` (ADR-055 §1: verificar la forma en runtime, no
 * afirmarla con un `dispatch<T>` que el compilador no puede verificar).
 *
 * Este motor NO envuelve su resultado en ningún sobre: `worker/entry.ts` postea
 * `result` = lo que devolvió `engine.process()`, así que el camino remoto y el
 * in-process resuelven exactamente la misma forma. Esa es la única válida
 * (PDF_Engine.md §13 casos 16-17); cualquier otra —incluido un `{ output }` que
 * envuelva un resultado por lo demás correcto— **lanza**. Devolver un default
 * en silencio está prohibido (ADR-055 §3): que falle ruidosamente es el punto.
 *
 * Verificación superficial y deliberada: los cuatro campos de `PdfEngineOutput`
 * más `document.id`/`document.pages`, sin recorrer `words`/`bbox`. Corre una
 * vez por import sobre documentos de hasta 10.000 páginas, y una corrupción
 * campo a campo no es el modo de falla que ADR-055 cierra (el sobre de forma
 * distinta sí lo es).
 */
export function decodePdfEngineOutput(value: unknown): PdfEngineOutput {
  if (isPdfEngineOutput(value)) return value;

  throw new InvalidInputError(
    "El resultado del despacho de pdf-parse no tiene la forma de PdfEngineOutput: " +
      "se esperaba { document: { id, pages }, pageCount, textlessPages, sourceKind } " +
      "(la misma forma en el camino remoto y en el in-process — este motor no envuelve " +
      "su resultado, PDF_Engine.md §13 caso 16). Devolver un default en silencio está " +
      "prohibido (ADR-055 §3).",
    { engineId: EngineId.Pdf, receivedShape: describeDispatchResultShape(value) },
  );
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
      // ADR-053 §5: extracción de texto, no rasterización — por eso NO lleva
      // disableFontFace (esta ruta nunca dibuja glifos como Path2D; agregarlo
      // solo haría que pdf.js construya siluetas que nadie va a pintar, ver
      // `05_Worker_Architecture.md` §7.1). Las opciones de abajo son la mitad
      // de la regla transversal de §7 que SÍ aplica acá:
      //  - useWorkerFetch: false EXPLÍCITO (trampa 1 de ADR-053 Contexto §6):
      //    ya estaba puesto y es lo que protege esta llamada de que el default
      //    de pdf.js evalúe `document.baseURI` dentro del PdfWorker en cuanto
      //    se pasan cMapUrl/standardFontDataUrl. No se toca.
      //  - cMapUrl/cMapPacked + standardFontDataUrl: sin esto, un PDF con
      //    fuentes CID de CMap predefinido se EXTRAE con unicode incorrecto —
      //    degrada regex-engine/ner-engine, no solo el dibujo (ADR-053 §5).
      //  - CMapReaderFactory/StandardFontDataFactory propias (trampa 2): las
      //    DOM* de pdf.js tocan document.baseURI en su primer fetch; servir
      //    los assets sin esto no alcanza.
      const loadingTask = getDocument({
        data: buffer,
        password,
        useWorkerFetch: false,
        cMapUrl: PDF_ENGINE_PDFJS_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_ENGINE_PDFJS_STANDARD_FONT_DATA_URL,
        CMapReaderFactory: PdfEngineCMapReaderFactory,
        StandardFontDataFactory: PdfEngineStandardFontDataFactory,
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

  dispose(): Promise<void> {
    this.disposed = true;
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
