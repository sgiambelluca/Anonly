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
 *
 * ADR-050 (`LoadDocumentPayload.password`): `kernelLoadDocument` lo pasa a
 * `getDocument({ data, password })` y no lo retiene en ninguna variable de
 * módulo — el único lugar de este archivo donde el password existe es el
 * scope local de esa función, durante esa única llamada. Quien lo retiene
 * para re-primear workers nuevos/reemplazados es el host (`render.engine.ts`,
 * `RetainedDocument.password`), no este kernel (`08_Security_Model.md` §6).
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
// ADR-058 §1 (Hito 10.5, PR 1): piso del shrink-to-fit. Ya existía como el
// número mágico `8` dentro de `fontForMode` (Math.max(8, ...)); queda nombrado
// acá porque ahora es también la condición de corte del loop de encogido de
// `fitReplacementFont` — nunca se baja de acá aunque el token siga sin entrar
// (spec Render_Engine.md §13 caso 25).
const REPLACEMENT_MIN_FONT_PX = 8;

/**
 * Prefijos first-party de los assets de pdfjs-dist que sirve la app bajo
 * `/pdfjs/` (ADR-053 §3/§4, copiados de `node_modules` en `predev`/`prebuild`
 * de `apps/react-client` — PR B1 de ADR-053 §9). Constantes de módulo, NO un
 * campo de `EngineConfig` (mismo patrón que `NER_LOCAL_MODEL_PATH`/
 * `NER_WASM_PATH` en `ner-engine/src/worker/kernel.ts`): `public/` se copia
 * verbatim, sin hashear, así que pdfjs-dist resuelve estos 169 archivos por
 * nombre contra un prefijo estable — no hace falta que el Core los conozca
 * por config.
 */
const RENDER_PDFJS_CMAP_URL = "/pdfjs/cmaps/";
const RENDER_PDFJS_STANDARD_FONT_DATA_URL = "/pdfjs/standard_fonts/";

/** `PDFDocumentProxy` cargados por este kernel, indexados por `documentId`. */
const documents = new Map<string, PDFDocumentProxy>();

/**
 * `CMapReaderFactory` propia para `getDocument()` (ADR-053 §2, trampa 2 de
 * Contexto §6): pdf.js instancia la CLASE que se le pasa en
 * `CMapReaderFactory` — nunca una instancia —, así que esto es exactamente lo
 * que necesita, ni más ni menos. Usa `fetch()` pelado: a diferencia de
 * `DOMCMapReaderFactory` de pdf.js (no exportada por el paquete, por eso no se
 * extiende — solo se implementa su forma), NUNCA referencia `document`, que
 * no existe dentro de un Worker. Contrato (ADR-053 §2, verificado contra
 * `pdfjs-dist@4.10.38/build/pdf.mjs` líneas 6032-6060, `BaseCMapReaderFactory`):
 * constructor `{ baseUrl, isCompressed }`, `fetch({ name })` ->
 * `{ cMapData: Uint8Array, isCompressed }`, URL = `baseUrl + name +
 * (isCompressed ? ".bcmap" : "")`.
 */
export class RenderKernelCMapReaderFactory {
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
 * `StandardFontDataFactory` propia para `getDocument()` (ADR-053 §2, misma
 * trampa 2 que la factory de arriba): reemplaza a `DOMStandardFontDataFactory`
 * de pdf.js, que toca `document.baseURI` en su primer fetch. Contrato
 * (ADR-053 §2, verificado contra `pdf.mjs` líneas 6407-6431,
 * `BaseStandardFontDataFactory`): constructor `{ baseUrl }`, `fetch({
 * filename })` -> `Uint8Array`, URL = `baseUrl + filename`.
 */
export class RenderKernelStandardFontDataFactory {
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

function scaleBbox(bbox: BoundingBox, scale: number): BoundingBox {
  return {
    x: bbox.x * scale,
    y: bbox.y * scale,
    width: bbox.width * scale,
    height: bbox.height * scale,
  };
}

function replacementFontSize(boxHeight: number): number {
  return Math.max(REPLACEMENT_MIN_FONT_PX, Math.round(boxHeight * 0.7));
}

function replacementFontFamily(mode: ReplacementMode): string {
  return mode === ReplacementMode.Placeholder ? "monospace, sans-serif" : "sans-serif";
}

function buildReplacementFont(size: number, family: string): string {
  return `${size}px ${family}`;
}

/**
 * ADR-058 §1 (Hito 10.5, PR 1) — la garantía dura del ADR, la única de sus
 * cuatro piezas que no es "calidad" (spec Render_Engine.md §2): `paintReplacements`
 * derivaba el tamaño de fuente solo de `bbox.height` y llamaba `fillText` sin
 * `maxWidth`, con el texto centrado — un token más ancho que su caja se
 * derramaba hacia los dos lados, encima de palabras del original dibujadas
 * debajo (ADR-058, Contexto §1). Esta función mide con `measureWidth` (que en
 * producción es `context.measureText`, ver `paintReplacements` abajo) y
 * encoge el tamaño de fuente hasta que `text` entra en `availableWidth`, sin
 * bajar nunca de `REPLACEMENT_MIN_FONT_PX`. Si el token ya entraba al tamaño
 * inicial, el loop no itera ni una vez y el resultado es exactamente el que
 * producía la fórmula anterior — no-regresión bit a bit (ADR-058 §1: "si el
 * token entra, no se toca nada").
 *
 * `measureWidth` desacopla la medición real de canvas (que exige
 * `context.font` seteado antes de medir) de esta función, que queda pura y
 * testeable con cualquier función de medición determinista, sin necesitar un
 * `OffscreenCanvas`. Exportada para test directo (`kernel.test.ts`) — no
 * forma parte del `index.ts` público del paquete, mismo patrón que el resto
 * de las funciones exportadas de este archivo (ADR-043 §2).
 */
export function fitReplacementFont(
  measureWidth: (font: string, text: string) => number,
  text: string,
  mode: ReplacementMode,
  boxHeight: number,
  availableWidth: number,
): string {
  const family = replacementFontFamily(mode);
  let size = replacementFontSize(boxHeight);
  let font = buildReplacementFont(size, family);

  while (measureWidth(font, text) > availableWidth && size > REPLACEMENT_MIN_FONT_PX) {
    size -= 1;
    font = buildReplacementFont(size, family);
  }

  return font;
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

    // §13 casos 4/5/6 (mask/placeholder/synthetic): fondo + texto centrado,
    // encogido para entrar en bbox.width (ADR-058 §1: shrink-to-fit, piso
    // REPLACEMENT_MIN_FONT_PX). `maxWidth` en `fillText` es la red de
    // seguridad final para cuando ni el piso alcanza (caso 25 del spec).
    context.fillStyle = REPLACEMENT_BG_COLOR;
    context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
    context.fillStyle = REPLACEMENT_TEXT_COLOR;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = fitReplacementFont(
      (font, text) => {
        context.font = font;
        return context.measureText(text).width;
      },
      replacement.replacementValue,
      replacement.mode,
      bbox.height,
      bbox.width,
    );
    context.fillText(
      replacement.replacementValue,
      bbox.x + bbox.width / 2,
      bbox.y + bbox.height / 2,
      bbox.width,
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
  // ADR-050 §1/§2: `password` opcional — se usa una única vez acá, abajo, y
  // no se guarda en ningún estado del kernel (ni en `documents`, ni en
  // ninguna otra variable de módulo). Una vez que `getDocument` resuelve el
  // `PDFDocumentProxy`, el password ya no se vuelve a necesitar.
  const { documentId, buffer, password } = payload;

  // ADR-030 §1: recarga determinística — destruye el proxy anterior si existía.
  const existing = documents.get(documentId);
  if (existing !== undefined) void existing.destroy();

  let pdfDocument: PDFDocumentProxy;
  try {
    // Regla transversal de 05_Worker_Architecture.md §7 (ADR-053): este
    // kernel corre la capa de display de pdf.js dentro de un Web Worker, sin
    // `document`. Las cinco opciones de abajo + las dos factories propias son
    // SOLIDARIAS — omitir cualquiera rompe el visor entero (ADR-053 Contexto
    // §6):
    //  - disableFontFace: dibuja los glifos como Path2D desde el programa de
    //    fuente embebido en vez de un @font-face registrado en el DOM (que no
    //    existe acá); además viaja en evaluatorOptions y es lo que hace que
    //    pdf.js construya y envíe las siluetas (trampa 3).
    //  - useSystemFonts: false evita el camino loadSystemFont, que sin Font
    //    Loading API llega a un unreachable().
    //  - useWorkerFetch: false EXPLÍCITO (trampa 1): el default de pdf.js
    //    evalúa `document.baseURI` al calcularse — con las URLs de cMap/
    //    standardFont ya pasadas, esa expresión se evalúa completa y tira
    //    ReferenceError dentro del Worker.
    //  - cMapUrl/cMapPacked + standardFontDataUrl: fuentes CID con CMap
    //    predefinido y fuentes no embebidas (standard-14/sustituciones).
    //  - CMapReaderFactory/StandardFontDataFactory propias (trampa 2): las
    //    DOM* de pdf.js tocan document.baseURI en su primer fetch; servir los
    //    assets sin esto no alcanza.
    const loadingTask = getDocument({
      data: buffer,
      password,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      cMapUrl: RENDER_PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: RENDER_PDFJS_STANDARD_FONT_DATA_URL,
      CMapReaderFactory: RenderKernelCMapReaderFactory,
      StandardFontDataFactory: RenderKernelStandardFontDataFactory,
    });
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
