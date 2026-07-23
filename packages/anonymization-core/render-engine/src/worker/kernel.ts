/**
 * `RenderKernel` — el kernel sin estado por documento que ADR-043 §1 asigna
 * al RenderWorker (salvo los `PDFDocumentProxy` cargados, únicos que
 * sobreviven entre llamadas). Contiene TODO lo que toca pdfjs-dist/canvas:
 * carga/descarga de documentos, rasterización, composición de reemplazos y
 * highlights, y codificación PNG/JPEG.
 *
 * Este archivo lo importan DOS consumidores (mismo código, dos fronteras):
 * - `render.engine.ts` (host, in-process fallback): lo invoca directo desde
 *   el `run()` que pasa a `RenderPool.dispatch` cuando no hay `workerFactory`
 *   real configurada (ADR-035, fallback bit-idéntico).
 * - `worker/entry.ts` (worker real): lo invoca detrás de la mensajería
 *   `postMessage` cuando SÍ hay un Worker de SO real.
 *
 * La clase `RenderEngine` (estado, cache, supersede, subscripciones, eventos)
 * NUNCA importa `pdfjs-dist` fuera de este archivo — es la única frontera del
 * paquete que lo hace, junto con el cast documentado de
 * `renderPageOntoContext` (ADR-031 §4, Code_Standards.md §10).
 *
 * Estado: `documents: Map<string, PDFDocumentProxy>` a nivel de módulo. Para
 * el worker real, esto es literalmente "lo que ese worker tiene cargado". Para
 * el fallback in-process, representa "el único kernel virtual" que corre en
 * el mismo proceso que el host — coherente con que en ese modo no hay
 * paralelismo real de todos modos (un solo hilo de JS).
 */

import {
  AnnotationKind,
  CancelledError,
  InvalidInputError,
  ReplacementMode,
  type Annotation,
  type BoundingBox,
  type EncodedPageImage,
  type LoadDocumentPayload,
  type RasterizePagePayload,
  type RenderPagePayload,
  type Replacement,
  type UnloadDocumentPayload,
} from "@anonly/shared";
import {
  getDocument,
  type PageViewport,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";

import { RenderFailedError, RenderPageFailedError, RenderTimeoutError } from "../render.errors.js";

// §13 casos 3/4/5/6/7/8: colores/estilos de cada modo (Contracts.md no expone
// `EntityType` en `Annotation`, así que el highlight usa un único color por
// `AnnotationKind` — ADR-031 §3).
const HIGHLIGHT_COLOR = "#2563eb";
const CONFLICT_COLOR = "#dc2626";
const REDACT_FILL_COLOR = "#000000";
const REPLACEMENT_BG_COLOR = "#ffffff";
const REPLACEMENT_TEXT_COLOR = "#000000";
const ANNOTATION_LINE_WIDTH = 2;

/** `PDFDocumentProxy` cargados por este kernel, indexados por `documentId`. */
const documents = new Map<string, PDFDocumentProxy>();

function scaleBbox(bbox: BoundingBox, scale: number): BoundingBox {
  return {
    x: bbox.x * scale,
    y: bbox.y * scale,
    width: bbox.width * scale,
    height: bbox.height * scale,
  };
}

function fontForMode(mode: ReplacementMode, boxHeight: number): string {
  const size = Math.max(8, Math.round(boxHeight * 0.7));
  const family = mode === ReplacementMode.Placeholder ? "monospace, sans-serif" : "sans-serif";
  return `${size}px ${family}`;
}

function toPageFailure(
  documentId: string,
  pageIndex: number,
  err: unknown,
): RenderPageFailedError | RenderTimeoutError {
  if (err instanceof RenderPageFailedError || err instanceof RenderTimeoutError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  return new RenderPageFailedError(documentId, pageIndex, reason);
}

/**
 * Callback de logging opcional (spec §13 caso 14: "mostrar warning" cuando
 * `OffscreenCanvas` no está disponible). El kernel no tiene acceso a
 * `ctx.logger` (no es un `EngineContext` completo, ADR-043 §2) — el host
 * (`render.engine.ts`) lo cablea a `ctx.logger.warn` para el fallback
 * in-process; el worker real (`worker/entry.ts`) no lo cablea (sin bus/logger
 * puente, ver su nota de cabecera) — gap conocido, no bloqueante: en ese modo
 * el render igual falla con `RenderPageFailedError`, solo sin el warning
 * diagnóstico adicional.
 */
export type KernelWarnLogger = (message: string, meta: Readonly<Record<string, unknown>>) => void;

function createCanvas(
  documentId: string,
  pageIndex: number,
  width: number,
  height: number,
  onWarn?: KernelWarnLogger,
): OffscreenCanvas {
  // §13 caso 14: v1.0 puede requerir OffscreenCanvas.
  if (typeof OffscreenCanvas === "undefined") {
    onWarn?.(
      "OffscreenCanvas no disponible en este entorno; Render Engine v1.0 lo requiere (spec §13 caso 14).",
      {
        documentId,
        pageIndex,
      },
    );
    throw new RenderPageFailedError(
      documentId,
      pageIndex,
      "OffscreenCanvas no disponible en este entorno.",
    );
  }
  return new OffscreenCanvas(width, height);
}

function get2dContext(
  canvas: OffscreenCanvas,
  documentId: string,
  pageIndex: number,
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new RenderPageFailedError(
      documentId,
      pageIndex,
      "No se pudo obtener un contexto 2D de OffscreenCanvas.",
    );
  }
  return context;
}

async function renderPageOntoContext(
  pageProxy: PDFPageProxy,
  context: OffscreenCanvasRenderingContext2D,
  viewport: PageViewport,
  documentId: string,
  pageIndex: number,
  timeoutMs: number,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new RenderTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    /*
     * pdfjs-dist@4.x tipa `PDFPageProxy.render({ canvasContext })` como
     * `CanvasRenderingContext2D` (contexto de un <canvas> de DOM), pero en
     * runtime pdf.js acepta cualquier contexto de canvas 2D válido —
     * incluido `OffscreenCanvasRenderingContext2D`, exactamente lo que exige
     * Render_Engine.md §1 y 05_Worker_Architecture.md §7.4 (OffscreenCanvas +
     * pdfjs-dist; fe de erratas ADR-030 §5, antes decía "pdf-lib"). El `.d.ts`
     * de la librería no refleja ese soporte (gap de tipos conocido, no
     * corregible sin tocar el paquete). Único `as unknown as` de este
     * paquete (ADR-031 §4, Code_Standards.md §10) — relocalizado acá desde
     * `render.engine.ts` por ADR-043 (el kernel es ahora quien invoca pdfjs).
     */
    await Promise.race([
      pageProxy.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise,
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function paintReplacements(
  context: OffscreenCanvasRenderingContext2D,
  replacements: ReadonlyArray<Replacement>,
  scale: number,
  abortSignal: AbortSignal,
  documentId: string,
): void {
  for (const replacement of replacements) {
    if (abortSignal.aborted) throw new CancelledError(documentId);
    const bbox = scaleBbox(replacement.bbox, scale);

    if (replacement.mode === ReplacementMode.Redact) {
      // §13 caso 3: fill opaco negro, sin texto.
      context.fillStyle = REDACT_FILL_COLOR;
      context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
      continue;
    }

    // §13 casos 4/5/6 (mask/placeholder/synthetic): fondo + texto centrado.
    context.fillStyle = REPLACEMENT_BG_COLOR;
    context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
    context.fillStyle = REPLACEMENT_TEXT_COLOR;
    context.font = fontForMode(replacement.mode, bbox.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      replacement.replacementValue,
      bbox.x + bbox.width / 2,
      bbox.y + bbox.height / 2,
    );
  }
}

function paintAnnotations(
  context: OffscreenCanvasRenderingContext2D,
  annotations: ReadonlyArray<Annotation>,
  scale: number,
  abortSignal: AbortSignal,
  documentId: string,
): void {
  for (const annotation of annotations) {
    if (abortSignal.aborted) throw new CancelledError(documentId);
    // §2/§13 casos 7-8: en kind="original" solo highlight y conflict aplican.
    if (
      annotation.kind !== AnnotationKind.Highlight &&
      annotation.kind !== AnnotationKind.Conflict
    ) {
      continue;
    }
    const bbox = scaleBbox(annotation.bbox, scale);
    context.strokeStyle =
      annotation.kind === AnnotationKind.Conflict ? CONFLICT_COLOR : HIGHLIGHT_COLOR;
    context.lineWidth = ANNOTATION_LINE_WIDTH;
    context.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
  }
}

/**
 * Codifica `ImageData` a PNG/JPEG vía `OffscreenCanvas.convertToBlob`
 * (ADR-034 §3): "donde vive el canvas" — un `OffscreenCanvas` temporal
 * pintado con `putImageData`.
 */
async function encodeImageData(
  imageData: ImageData,
  imageFormat: "png" | "jpeg",
  quality: number,
  documentId: string,
  pageIndex: number,
  onWarn?: KernelWarnLogger,
): Promise<EncodedPageImage> {
  const canvas = createCanvas(documentId, pageIndex, imageData.width, imageData.height, onWarn);
  const context = get2dContext(canvas, documentId, pageIndex);
  context.putImageData(imageData, 0, 0);

  let blob: Blob;
  try {
    blob = await canvas.convertToBlob({ type: `image/${imageFormat}`, quality });
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }
  const bytes = await blob.arrayBuffer();
  return { bytes, format: imageFormat, widthPx: imageData.width, heightPx: imageData.height };
}

// ─── Puerto interno (ADR-043 §2): las 4 operaciones ───

export async function kernelLoadDocument(
  payload: LoadDocumentPayload,
): Promise<{ readonly pageCount: number }> {
  const { documentId, buffer } = payload;

  // ADR-030 §1: recarga determinística — destruye el proxy anterior si existía.
  const existing = documents.get(documentId);
  if (existing !== undefined) void existing.destroy();

  let pdfDocument: PDFDocumentProxy;
  try {
    const loadingTask = getDocument({ data: buffer });
    pdfDocument = await loadingTask.promise;
  } catch (err: unknown) {
    // ADR-030 §2: getDocument() fallando acá es excepcional (la etapa 1 ya validó el PDF).
    const reason = err instanceof Error ? err.message : String(err);
    throw new RenderFailedError(documentId, reason);
  }

  documents.set(documentId, pdfDocument);
  return { pageCount: pdfDocument.numPages };
}

export function kernelUnloadDocument(payload: UnloadDocumentPayload): Promise<void> {
  const existing = documents.get(payload.documentId);
  if (existing === undefined) return Promise.resolve(); // ADR-030 §1/§3: no-op idempotente.
  documents.delete(payload.documentId);
  void existing.destroy();
  return Promise.resolve();
}

export interface KernelRenderOptions {
  readonly jpegQuality: number;
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onWarn?: KernelWarnLogger;
}

export interface KernelRenderResult {
  readonly imageData: ImageData;
  // Siempre presente (a diferencia de `RenderPageOutput.encoded`, público y
  // opcional según `mode` — Render_Engine.md §10): el host decide si lo
  // expone según `mode === "full"`, y reusa este mismo valor para el blob de
  // `PREVIEW_UPDATED` en `mode: "preview"` sin re-codificar ni tocar
  // OffscreenCanvas fuera del kernel (ver `render.engine.ts#emitPreviewUpdated`).
  readonly encoded: EncodedPageImage;
}

/**
 * `RenderPagePayload` construido por el host con `scale`/`imageFormat` ya
 * resueltos (nunca `undefined` en la práctica: `render.engine.ts` aplica los
 * defaults de `previewScale`/`fullScale`/formato antes de despachar) —
 * defensivamente se toleran acá también por si algún día un caller directo al
 * kernel omite alguno.
 */
export async function kernelRenderPage(
  payload: RenderPagePayload,
  opts: KernelRenderOptions,
): Promise<KernelRenderResult> {
  const { documentId, pageIndex, kind, mode } = payload;
  const pdfDocument = documents.get(documentId);
  if (pdfDocument === undefined) {
    throw new InvalidInputError(
      `Documento ${documentId} no está cargado en el kernel de Render (ADR-030).`,
      { documentId },
    );
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
      { documentId, pageIndex, pageCount: pdfDocument.numPages },
    );
  }

  const replacements = payload.replacements ?? [];
  const annotations = payload.annotations ?? [];
  const scale = payload.scale ?? 1;
  const imageFormat = payload.imageFormat ?? (mode === "preview" ? "png" : "jpeg");

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageIndex + 1);
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const viewport = pageProxy.getViewport({ scale });
  const canvas = createCanvas(documentId, pageIndex, viewport.width, viewport.height, opts.onWarn);
  const context2d = get2dContext(canvas, documentId, pageIndex);

  try {
    await renderPageOntoContext(
      pageProxy,
      context2d,
      viewport,
      documentId,
      pageIndex,
      opts.timeoutMs,
    );
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  if (kind === "anonymized") {
    paintReplacements(context2d, replacements, scale, opts.abortSignal, documentId);
  } else {
    paintAnnotations(context2d, annotations, scale, opts.abortSignal, documentId);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const imageData = context2d.getImageData(0, 0, viewport.width, viewport.height);

  // ADR-034 §3 + ADR-043 (relocalizado al kernel): se codifica siempre —
  // tanto `mode: "full"` (para `RenderPageOutput.encoded` público) como
  // `mode: "preview"` (para el blob de `PREVIEW_UPDATED`, que antes de
  // ADR-043 se re-codificaba por fuera, host-side; ahora lo hace el mismo
  // kernel una sola vez). El host decide qué exponer públicamente.
  const encoded = await encodeImageData(
    imageData,
    imageFormat,
    opts.jpegQuality,
    documentId,
    pageIndex,
    opts.onWarn,
  );

  return { imageData, encoded };
}

export interface KernelRasterizeOptions {
  readonly timeoutMs: number;
  readonly abortSignal: AbortSignal;
  readonly onWarn?: KernelWarnLogger;
}

/** Rasterización pura sin reemplazos ni highlights (ADR-034 §1). */
export async function kernelRasterizePage(
  payload: RasterizePagePayload,
  opts: KernelRasterizeOptions,
): Promise<ImageData> {
  const { documentId, pageIndex, scale } = payload;
  const pdfDocument = documents.get(documentId);
  if (pdfDocument === undefined) {
    throw new InvalidInputError(
      `Documento ${documentId} no está cargado en el kernel de Render (ADR-030, ADR-034 §1).`,
      { documentId },
    );
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
    throw new InvalidInputError(
      `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
      { documentId, pageIndex, pageCount: pdfDocument.numPages },
    );
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  let pageProxy: PDFPageProxy;
  try {
    pageProxy = await pdfDocument.getPage(pageIndex + 1);
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  const viewport = pageProxy.getViewport({ scale });
  const canvas = createCanvas(documentId, pageIndex, viewport.width, viewport.height, opts.onWarn);
  const context2d = get2dContext(canvas, documentId, pageIndex);

  try {
    await renderPageOntoContext(
      pageProxy,
      context2d,
      viewport,
      documentId,
      pageIndex,
      opts.timeoutMs,
    );
  } catch (err: unknown) {
    throw toPageFailure(documentId, pageIndex, err);
  }

  if (opts.abortSignal.aborted) throw new CancelledError(documentId);

  return context2d.getImageData(0, 0, viewport.width, viewport.height);
}

/**
 * Libera todos los `PDFDocumentProxy` cargados por este kernel. Invocado
 * DIRECTO (sin pasar por `RenderPool.dispatch`, ver `render.engine.ts#dispose`)
 * porque `dispose()` no es una de las 4 operaciones del puerto (ADR-043 §2) —
 * es un efecto local de teardown; para el modo worker real, la liberación
 * server-side llega por el mensaje genérico `DISPOSE` del protocolo
 * (`05_Worker_Architecture.md` §7.4), manejado en `worker/entry.ts`.
 */
export function kernelDisposeAll(): void {
  for (const doc of documents.values()) void doc.destroy();
  documents.clear();
}
