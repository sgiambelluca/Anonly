/**
 * @anonly/render-engine — `RenderEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Render_Engine.md (v1.3.1, ADR-030, ADR-031, ADR-034, ADR-037).
 *
 * ADR-021 (motores inline hasta Hito 9): sin pool propio, sin Workers
 * propios — el motor sigue corriendo inline en Hito 9 (el `RenderPool` del
 * Orchestrator lo invoca por sus métodos públicos existentes, sin cambio de
 * interfaz). Corre en el host (main thread) con `OffscreenCanvas` +
 * `pdfjs-dist`. La cancelación es cooperativa vía `ctx.abortSignal` con
 * checkpoints entre operaciones de Canvas; el SLA estricto < 200ms se valida
 * en Hito 9/11 (mismo precedente que pdf-engine/ocr-engine/ner-engine).
 *
 * ADR-034 (auditoría pre-Hito 9): `rasterizePage` (rasterización pura sin
 * eventos/cache, para el flujo OCR del Orchestrator) y `RenderPageOutput.encoded`
 * (bytes codificados en mode "full", vía `convertToBlob`) son nuevos en este
 * hito. La nota de implementación 4 (abajo) documentaba el placeholder de
 * `PREVIEW_UPDATED.canvasBlobUrl` con bytes crudos (ADR-031 §5); este hito lo
 * reemplaza por codificación real (`encodeImageData`, `convertToBlob`).
 *
 * ADR-030 (`RenderEngine.loadDocument`): el motor mantiene su propio
 * `Map<documentId, PDFDocumentProxy>`, poblado por `loadDocument` (toma
 * posesión del buffer) y liberado por `unloadDocument`/`dispose` — mismo
 * patrón que `PdfEngine` (pdf-engine/src/pdf.engine.ts: `getDocument()` +
 * `Map<string, Document>` + `dispose()` destruyendo proxies), adaptado a que
 * acá el proxy vive mientras el documento esté abierto (no se destruye al
 * terminar cada render, porque el delta render necesita re-renderizar en
 * cualquier momento posterior).
 *
 * Notas de diseño no triviales (dentro del margen que el spec deja abierto,
 * ninguna rompe un contrato público de Contracts.md/Render_Engine.md):
 *
 * 1. `RENDER_REQUESTED` (§8) no trae `kind` ni `replacements`/`annotations`
 *    — solo `{ documentId, pageIndices, mode }`. `06_Pipeline.md` §10 dice
 *    que se renderiza primero "original" y luego "anonimizado" para las
 *    páginas visibles, así que el handler reconstruye ambos `RenderPageInput`
 *    por página a partir del último input recordado para esa página (o
 *    valores por defecto — `replacements: []` — si nunca se renderizó antes).
 * 2. El índice `pageIndex → groupIds` (§12) se construye a partir de
 *    `replacement.groupId`/`annotation.groupId` en cada `renderPage` con
 *    `mode: "preview"`. `requestDeltaRender` (§8, `GROUP_REPLACEMENT_CHANGED`
 *    / `GROUP_TOGGLED`) no recibe bbox/valor por evento (esos payloads solo
 *    llevan `{ groupId, mode, value }` / `{ groupId, enabled }`), así que el
 *    motor aplica el override sobre el último `Replacement`/`Annotation[]`
 *    conocido de cada página afectada (sin esto, el delta render no tendría
 *    ningún dato con el cual re-pintar).
 * 3. La clave de cache es `documentId:pageIndex:kind:mode:
 *    hash(replacements ++ annotations)` — letra corregida del spec §15 item 12
 *    (errata: la versión previa decía `hash(replacements)`, que para
 *    `kind: "original"` sin `replacements` colisionaría entre distintos
 *    `annotations`; ADR-031 §2). No es una extensión propia: es el
 *    comportamiento especificado.
 * 4. `PREVIEW_UPDATED.canvasBlobUrl` (§7): en Hito 7 (inline, ADR-021) el
 *    propio motor arma el blob (igual que `PdfEngine`/`OcrEngine` emiten sus
 *    propios eventos en modo inline). El motor sigue armando el blob en
 *    Hito 9 (sigue sin haber un host separado — el `RenderPool` invoca los
 *    métodos existentes del motor), pero ahora con codificación real
 *    (`encodeImageData` → `OffscreenCanvas.convertToBlob`, ADR-034 §3),
 *    reemplazando el placeholder de bytes crudos de ADR-031 §5. El
 *    Orchestrator no crea el blob: solo lo rastrea y revoca (ADR-034 §5).
 * 5. `as unknown as CanvasRenderingContext2D` en `renderPageOntoContext`:
 *    ÚNICO cast de este tipo en código de producción de todo el Core (ver el
 *    comentario puntual, más abajo, para el detalle técnico completo).
 *    Excepción aprobada explícitamente por ADR-031 §4 (Code_Standards.md §10).
 * 6. ADR-037 (zoom con re-render real, Hito 10): `RENDER_REQUESTED.scale` se
 *    propaga a `renderPages` (ausente → `previewScale`/`fullScale` según
 *    `mode`, igual que `renderPage` ya hacía con `RenderPageInput.scale`
 *    desde v1.0.0). Tres piezas nuevas:
 *    a. Guard de rango `0 < scale <= MAX_RENDER_SCALE`: `InvalidInputError`
 *       en invocación directa (`renderPage`/`renderPages`), `warn` + no-op en
 *       la vía por evento (mismo tratamiento que documento no cargado, ADR-030 §3).
 *    b. La clave del cache LRU incorpora la escala efectiva (nunca `input.scale`
 *       crudo, que puede ser `undefined`: usar la escala efectiva evita que un
 *       `scale` explícito numéricamente igual al default invalide el hit —
 *       nota de "Consecuencias" de ADR-037). El cache gana además un límite
 *       por bytes (`PREVIEW_CACHE_MAX_BYTES`), evaluado junto al límite por
 *       items (`cachePages`) en cada eviction.
 *    c. Supersede por página: `pendingRenders` (`Map<"documentId:pageIndex:kind",
 *       escalaVigente>`) registra, para cada `RENDER_REQUESTED`, la escala
 *       vigente por `(documentId, pageIndex, kind)`. Participan del mecanismo
 *       ÚNICAMENTE los renders originados en `handleRenderRequested`, que
 *       invoca `renderPagesInternal` con `participatesInSupersede = true`: en
 *       sus checkpoints (mismos puntos que el chequeo de `ctx.abortSignal`,
 *       vía `throwIfSuperseded`) lanzan `CancelledError` si su escala ya no
 *       coincide con la vigente — lo que descarta un render "en cola" antes
 *       de que arranque, o aborta uno "en vuelo" en su próximo checkpoint,
 *       sin ejecutar ni emitir `PREVIEW_UPDATED`. `renderPagesInternal`
 *       distingue esa cancelación (page-local: no aborta el resto del batch,
 *       no emite `PREVIEW_PAGE_FAILED`) de una cancelación real de
 *       `ctx.abortSignal` (aborta el batch completo, comportamiento
 *       preexistente) mirando si `ctx.abortSignal.aborted` es la causa. El
 *       mecanismo es enteramente interno al motor (no usa `CANCEL_REQUESTED`
 *       ni el `AbortRegistry` del Orchestrator, ADR-037 §4).
 *
 *       Alcance del supersede (resolución del hallazgo de revisión del PR4
 *       del Hito 10, antes "LIMITACIÓN CONOCIDA" en esta nota): las
 *       invocaciones DIRECTAS de `renderPage`/`renderPages` (export del
 *       Orchestrator vía `RenderPageProvider.renderFull`, tests, y el delta
 *       render interno de `requestDeltaRender`) pasan
 *       `participatesInSupersede = false` y NUNCA consultan `pendingRenders`:
 *       son inmunes por construcción a las entradas que deja el flujo por
 *       eventos (`rasterizePage` nunca participó del mecanismo). Antes ambas
 *       vías compartían el checkpoint en `renderPage`, y una entrada residual
 *       de un preview ya completado a otra escala cancelaba espuriamente un
 *       export posterior en `mode: "full"` de la misma página (la clave no
 *       incluye `mode`, decisión literal de ADR-037 §4, que este fix NO
 *       cambia) o un delta render.
 *
 *       Las entradas de `pendingRenders` NO se limpian al completar un render
 *       (solo en `dispose`/`unloadDocument`/`loadDocument` reload), y es
 *       deliberado: la entrada significa "última escala pedida por evento
 *       para esta clave", no "hay un render en curso". Limpiarla al completar
 *       reintroduce una carrera con el propio supersede-en-cola: si el
 *       request ganador B completa y borra la entrada antes de que el
 *       perdedor A (todavía en cola) llegue a su checkpoint, A no encuentra
 *       entrada y ejecuta como si no hubiera sido superado. Una entrada
 *       residual es inofensiva: un próximo request por evento a la misma
 *       escala coincide y procede, uno a otra escala la reemplaza, y las
 *       invocaciones directas no la miran. Memoria acotada: ≤ 2 entradas
 *       (una por kind) por página por documento cargado. La detección es por
 *       comparación de escala pura; el `AbortController` por entrada de la
 *       versión inicial del PR4 era código muerto (hallazgo cosmético del
 *       revisor: el `.abort()` solo alcanzaba a la entrada ya reemplazada,
 *       nunca a la vigente) y se eliminó junto con este fix.
 */

import {
  AnnotationKind,
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  MAX_RENDER_SCALE,
  PREVIEW_CACHE_MAX_BYTES,
  ReplacementMode,
  type Annotation,
  type BoundingBox,
  type EncodedPageImage,
  type EngineContext,
  type GroupReplacementChanged,
  type GroupToggled,
  type IEngine,
  type RenderRequested,
  type Replacement,
  type Unsubscribe,
} from "@anonly/shared";
import {
  getDocument,
  type PageViewport,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";

import { RenderFailedError, RenderPageFailedError, RenderTimeoutError } from "./render.errors.js";
import type { RenderPageInput, RenderPageOutput } from "./render.types.js";

const DEFAULT_TIMEOUT_MS = 10_000; // render-page preview (05_Worker_Architecture.md §4); full=30s idem si config lo define.
const MAX_RETRIES = 1; // spec §11: "reintentar 1 vez"
const DEFAULT_CACHE_PAGES = 16;

// §13 casos 3/4/5/6/7/8: colores/estilos de cada modo. Contracts.md no expone
// `EntityType` en `Annotation` (solo `groupId`/`bbox`/`kind`), así que el
// highlight usa un único color por `AnnotationKind` — letra corregida del
// spec §13.7 (antes decía "borde color, configurable por tipo"; errata
// corregida por ADR-031 §3), consistente con lo único verificable por los
// tests del spec (§14: "highlight border" / "conflict marker", ambos por
// `kind`, no por tipo de entidad).
const HIGHLIGHT_COLOR = "#2563eb";
const CONFLICT_COLOR = "#dc2626";
const REDACT_FILL_COLOR = "#000000";
const REPLACEMENT_BG_COLOR = "#ffffff";
const REPLACEMENT_TEXT_COLOR = "#000000";
const ANNOTATION_LINE_WIDTH = 2;

/** Override pendiente de aplicar en el próximo (re)render de un grupo (ver nota 2 de arriba). */
interface GroupOverride {
  readonly mode?: ReplacementMode;
  readonly value?: string;
  readonly enabled?: boolean;
}

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
  // §13 caso 5: placeholder usa monospace si está disponible, fallback sans-serif.
  const family = mode === ReplacementMode.Placeholder ? "monospace, sans-serif" : "sans-serif";
  return `${size}px ${family}`;
}

// Hash determinista y compacto (FNV-1a), mismo estilo que shared/src/synthesizer.ts (hashStringToInt).
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// Nota de implementación 3 (cabecera del archivo): hash(replacements ++ annotations).
function hashPageContent(
  replacements: ReadonlyArray<Replacement>,
  annotations: ReadonlyArray<Annotation>,
): string {
  const replacementPart = replacements.map(
    (r) => `R|${r.groupId}|${r.occurrenceId}|${r.mode}|${r.replacementValue}`,
  );
  const annotationPart = annotations.map((a) => `A|${a.id}|${a.kind}`);
  const combined = [...replacementPart, ...annotationPart].sort().join(";");
  return combined.length === 0 ? "0" : fnv1a(combined);
}

// ADR-037 §3: la clave incorpora la escala EFECTIVA (nunca `input.scale` crudo,
// que puede ser `undefined`) — así un `scale` explícito numéricamente igual al
// default de `mode` cae en la misma entrada de cache (nota de "Consecuencias"
// de ADR-037: evita invalidar el hit entre "preview default" y "scale=1" explícito).
function buildCacheKey(
  documentId: string,
  pageIndex: number,
  kind: "original" | "anonymized",
  mode: "preview" | "full",
  scale: number,
  replacements: ReadonlyArray<Replacement>,
  annotations: ReadonlyArray<Annotation>,
): string {
  return `${documentId}:${pageIndex}:${kind}:${mode}:${scale}:${hashPageContent(replacements, annotations)}`;
}

function pageKey(documentId: string, pageIndex: number): string {
  return `${documentId}:${pageIndex}`;
}

// ADR-037 §4: clave de coalescing del supersede por página — NO incluye `mode`
// (la decisión del ADR es explícita: la clave es (documentId, pageIndex, kind)).
function supersedeKey(
  documentId: string,
  pageIndex: number,
  kind: "original" | "anonymized",
): string {
  return `${documentId}:${pageIndex}:${kind}`;
}

// ADR-037 §2: rango válido de scale, compartido por el guard de invocación
// directa (InvalidInputError) y el de la vía por evento (warn + no-op).
function isValidScale(scale: number): boolean {
  return Number.isFinite(scale) && scale > 0 && scale <= MAX_RENDER_SCALE;
}

// ADR-037 §3: tamaño estimado de una entrada de cache para el límite por bytes
// (PREVIEW_CACHE_MAX_BYTES) — los píxeles RGBA crudos dominan el costo; los
// bytes codificados (mode "full") se suman cuando existen.
function estimateOutputBytes(output: RenderPageOutput): number {
  return output.imageData.data.byteLength + (output.encoded?.bytes.byteLength ?? 0);
}

// Nota de implementación 2: aplica el último GROUP_REPLACEMENT_CHANGED/GROUP_TOGGLED
// conocido sobre los Replacement cacheados de una página (delta render, §12).
function applyReplacementOverrides(
  replacements: ReadonlyArray<Replacement>,
  overrides: ReadonlyMap<string, GroupOverride>,
): ReadonlyArray<Replacement> {
  const result: Replacement[] = [];
  for (const replacement of replacements) {
    const override = overrides.get(replacement.groupId);
    if (override?.enabled === false) continue; // §13 caso 2: grupo deshabilitado → texto original.
    if (override?.mode !== undefined || override?.value !== undefined) {
      result.push({
        ...replacement,
        mode: override.mode ?? replacement.mode,
        replacementValue: override.value ?? replacement.replacementValue,
      });
    } else {
      result.push(replacement);
    }
  }
  return result;
}

function applyAnnotationOverrides(
  annotations: ReadonlyArray<Annotation>,
  overrides: ReadonlyMap<string, GroupOverride>,
): ReadonlyArray<Annotation> {
  return annotations.filter((annotation) => {
    if (annotation.kind !== AnnotationKind.Highlight) return true;
    const override = overrides.get(annotation.groupId);
    return override?.enabled !== false;
  });
}

export class RenderEngine implements IEngine {
  readonly id = EngineId.Render;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  private unsubscribers: Unsubscribe[] = [];

  private readonly documents = new Map<string, PDFDocumentProxy>();
  private readonly cache = new Map<string, RenderPageOutput>();
  // Bytes totales cacheados (ADR-037 §3), mantenido en paralelo a `cache` vía
  // setCacheEntry/deleteCacheEntry — nunca se lee directo de `cache.values()`.
  private cacheBytes = 0;
  // Índice pageIndex → groupIds (§12), clave `${documentId}:${pageIndex}`.
  private readonly pageGroupIndex = new Map<string, Set<string>>();
  // Último RenderPageInput usado por página (para RENDER_REQUESTED y delta render).
  private readonly lastAnonymizedInputs = new Map<string, RenderPageInput>();
  private readonly lastOriginalInputs = new Map<string, RenderPageInput>();
  // Overrides pendientes por (documentId, groupId) — ver nota de implementación 2.
  private readonly groupOverrides = new Map<string, Map<string, GroupOverride>>();
  // Supersede por página (ADR-037 §4, nota 6c de cabecera) — clave
  // `documentId:pageIndex:kind` → escala vigente registrada por el último
  // RENDER_REQUESTED. Poblada únicamente por handleRenderRequested y
  // consultada solo por renders con participatesInSupersede = true.
  private readonly pendingRenders = new Map<string, number>();

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    this.unsubscribers = [
      ctx.bus.on(EventChannel.UI, EngineEvents.RENDER_REQUESTED, (payload) =>
        this.handleRenderRequested(payload),
      ),
      ctx.bus.on(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, (payload) =>
        this.handleGroupReplacementChanged(payload),
      ),
      ctx.bus.on(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED, (payload) =>
        this.handleGroupToggled(payload),
      ),
    ];
    ctx.logger.info("Render Engine initialized");
    return Promise.resolve();
  }

  async loadDocument(documentId: string, buffer: ArrayBuffer): Promise<void> {
    this.assertNotDisposed();
    this.assertInitialized();
    // assertInitialized ya garantiza this.ctx !== null; guard explícito solo
    // para que TS estreche el tipo dentro de este método (sin non-null assertion).
    if (this.ctx === null) {
      throw new EngineNotInitializedError(EngineId.Render);
    }
    const ctx = this.ctx;

    if (buffer == null || buffer.byteLength === 0) {
      throw new InvalidInputError("buffer vacío o null en loadDocument.", { documentId });
    }

    // ADR-030 §1: recarga determinística — destruye el proxy anterior si existía.
    const existing = this.documents.get(documentId);
    if (existing !== undefined) {
      void existing.destroy();
    }

    let pdfDocument: PDFDocumentProxy;
    try {
      const loadingTask = getDocument({ data: buffer });
      pdfDocument = await loadingTask.promise;
    } catch (err: unknown) {
      // ADR-030 §2: getDocument() fallando acá es excepcional (la etapa 1 ya validó el PDF).
      const reason = err instanceof Error ? err.message : String(err);
      throw new RenderFailedError(documentId, reason);
    }

    this.documents.set(documentId, pdfDocument);
    this.clearDocumentState(documentId);
    ctx.logger.info(`Documento cargado en Render Engine: ${documentId}`, {
      documentId,
      pageCount: pdfDocument.numPages,
    });
  }

  unloadDocument(documentId: string): Promise<void> {
    // ADR-030 §1/§3: sin asserts — no-op idempotente en cualquier secuencia de
    // teardown, incluso tras dispose() (mismo patrón que PdfEngine.releaseDocument).
    const existing = this.documents.get(documentId);
    if (existing === undefined) return Promise.resolve();
    this.documents.delete(documentId);
    void existing.destroy();
    this.clearDocumentState(documentId);
    return Promise.resolve();
  }

  /**
   * Render directo de una página (§6). No participa del supersede por página
   * de ADR-037 §4 (spec §13 caso 21): las entradas de `pendingRenders` que
   * deja el flujo de `RENDER_REQUESTED` no afectan a esta vía (export del
   * Orchestrator, delta render, tests) — ver nota 6c de cabecera.
   */
  async renderPage(input: RenderPageInput, ctx: EngineContext): Promise<RenderPageOutput> {
    return this.renderPageInternal(input, ctx, false);
  }

  private async renderPageInternal(
    input: RenderPageInput,
    ctx: EngineContext,
    participatesInSupersede: boolean,
  ): Promise<RenderPageOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Render });
    }

    const { documentId, pageIndex, kind, mode } = input;
    const pdfDocument = this.documents.get(documentId);
    if (pdfDocument === undefined) {
      // §11 / ADR-030 §2: renderPage/renderPages sobre documentId no cargado → INVALID_INPUT.
      throw new InvalidInputError(
        `Documento ${documentId} no está cargado. Llamá loadDocument antes de renderPage/renderPages (ADR-030).`,
        { documentId },
      );
    }

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
      throw new InvalidInputError(
        `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
        { documentId, pageIndex, pageCount: pdfDocument.numPages },
      );
    }

    // ADR-037 §2: guard de rango en invocación directa → InvalidInputError
    // (endurece una laguna previa: RenderPageInput.scale no declaraba validación).
    if (input.scale !== undefined && !isValidScale(input.scale)) {
      throw new InvalidInputError(
        `scale ${input.scale} fuera de rango (0, ${MAX_RENDER_SCALE}] o no finito.`,
        { documentId, pageIndex, scale: input.scale },
      );
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    // §9: replacements solo aplica a "anonymized"; annotations solo a "original".
    // Caso 1: replacements ausente/vacío en "anonymized" = idéntico al original.
    const replacements = kind === "anonymized" ? (input.replacements ?? []) : [];
    const annotations = kind === "original" ? (input.annotations ?? []) : [];
    const scale =
      input.scale ??
      (mode === "preview" ? ctx.config.render.previewScale : ctx.config.render.fullScale);
    const imageFormat = input.imageFormat ?? (mode === "preview" ? "png" : "jpeg");

    // ADR-037 §4, alcance precisado por el hallazgo del PR4 (nota 6c de
    // cabecera): solo los renders originados en RENDER_REQUESTED participan
    // del supersede; en la vía directa el checkpoint degrada al chequeo
    // preexistente de ctx.abortSignal.
    const checkpoint = participatesInSupersede
      ? (): void => {
          this.throwIfSuperseded(ctx, documentId, pageIndex, kind, scale);
        }
      : (): void => {
          if (ctx.abortSignal.aborted) throw new CancelledError(documentId);
        };

    // ADR-037 §4: primer checkpoint — un render por evento "en cola" se
    // descarta acá, antes de tocar rememberInput/cache, sin haber ejecutado nada.
    checkpoint();

    this.rememberInput(input, replacements, annotations);

    const cacheKey = buildCacheKey(
      documentId,
      pageIndex,
      kind,
      mode,
      scale,
      replacements,
      annotations,
    );
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.touchCache(cacheKey);
      if (mode === "preview") await this.emitPreviewUpdated(ctx, cached, imageFormat);
      return cached;
    }

    const startedAt = Date.now();
    const timeoutMs = ctx.config.workerPool.timeouts["render-page"] ?? DEFAULT_TIMEOUT_MS;

    let pageProxy: PDFPageProxy;
    try {
      pageProxy = await pdfDocument.getPage(pageIndex + 1);
    } catch (err: unknown) {
      throw this.toPageFailure(documentId, pageIndex, err);
    }

    checkpoint();

    const viewport = pageProxy.getViewport({ scale });
    const canvas = this.createCanvas(documentId, pageIndex, viewport.width, viewport.height);
    const context2d = this.get2dContext(canvas, documentId, pageIndex);

    try {
      await this.renderPageOntoContext(
        pageProxy,
        context2d,
        viewport,
        documentId,
        pageIndex,
        timeoutMs,
      );
    } catch (err: unknown) {
      throw this.toPageFailure(documentId, pageIndex, err);
    }

    checkpoint();

    if (kind === "anonymized") {
      this.paintReplacements(context2d, replacements, scale, ctx.abortSignal, documentId);
    } else {
      this.paintAnnotations(context2d, annotations, scale, ctx.abortSignal, documentId);
    }

    checkpoint();

    const imageData = context2d.getImageData(0, 0, viewport.width, viewport.height);
    const durationMs = Date.now() - startedAt;

    // ADR-034 §3: `encoded` solo se computa para mode "full" (consumido por el
    // RenderPageProvider del Orchestrator vía convertToBlob, no imageData crudo).
    const encoded =
      mode === "full"
        ? await this.encodeImageData(
            imageData,
            imageFormat,
            ctx.config.render.jpegQuality,
            documentId,
            pageIndex,
          )
        : undefined;

    const output: RenderPageOutput = {
      documentId,
      pageIndex,
      kind,
      imageData,
      durationMs,
      ...(encoded !== undefined ? { encoded } : {}),
    };

    this.setCacheEntry(cacheKey, output);
    this.evictCacheIfNeeded(ctx);

    if (mode === "preview") {
      await this.emitPreviewUpdated(ctx, output, imageFormat);
    }

    return output;
  }

  /**
   * Rasterización pura de una página a `ImageData`, sin reemplazos ni
   * highlights (ADR-034 §1): alimenta el OCR desde el Orchestrator, que no
   * puede importar pdfjs. No emite eventos (ni `PREVIEW_UPDATED`) ni toca el
   * cache LRU de previews.
   */
  async rasterizePage(
    documentId: string,
    pageIndex: number,
    scale: number,
    ctx: EngineContext,
  ): Promise<ImageData> {
    this.assertNotDisposed();
    this.assertInitialized();

    const pdfDocument = this.documents.get(documentId);
    if (pdfDocument === undefined) {
      throw new InvalidInputError(
        `Documento ${documentId} no está cargado. Llamá loadDocument antes de rasterizePage (ADR-030, ADR-034 §1).`,
        { documentId },
      );
    }

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.numPages) {
      throw new InvalidInputError(
        `pageIndex ${pageIndex} fuera de rango para documento con ${pdfDocument.numPages} páginas.`,
        { documentId, pageIndex, pageCount: pdfDocument.numPages },
      );
    }

    if (!(scale > 0)) {
      throw new InvalidInputError(`scale debe ser mayor a 0. Recibido: ${scale}.`, {
        documentId,
        pageIndex,
        scale,
      });
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const timeoutMs = ctx.config.workerPool.timeouts["render-page"] ?? DEFAULT_TIMEOUT_MS;

    let pageProxy: PDFPageProxy;
    try {
      pageProxy = await pdfDocument.getPage(pageIndex + 1);
    } catch (err: unknown) {
      throw this.toPageFailure(documentId, pageIndex, err);
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const viewport = pageProxy.getViewport({ scale });
    const canvas = this.createCanvas(documentId, pageIndex, viewport.width, viewport.height);
    const context2d = this.get2dContext(canvas, documentId, pageIndex);

    try {
      await this.renderPageOntoContext(
        pageProxy,
        context2d,
        viewport,
        documentId,
        pageIndex,
        timeoutMs,
      );
    } catch (err: unknown) {
      throw this.toPageFailure(documentId, pageIndex, err);
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    return context2d.getImageData(0, 0, viewport.width, viewport.height);
  }

  /**
   * Render directo de un batch (§6). Igual que `renderPage`, no participa del
   * supersede por página (spec §13 caso 21) — ver nota 6c de cabecera.
   */
  async renderPages(
    inputs: ReadonlyArray<RenderPageInput>,
    ctx: EngineContext,
  ): Promise<ReadonlyArray<RenderPageOutput>> {
    return this.renderPagesInternal(inputs, ctx, false);
  }

  private async renderPagesInternal(
    inputs: ReadonlyArray<RenderPageInput>,
    ctx: EngineContext,
    participatesInSupersede: boolean,
  ): Promise<ReadonlyArray<RenderPageOutput>> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (inputs == null) {
      throw new InvalidInputError("inputs es null o undefined.", { engineId: EngineId.Render });
    }

    const documentId = inputs[0]?.documentId ?? "";
    const startedAt = Date.now();
    const outputs: RenderPageOutput[] = [];
    const pageIndices: number[] = [];

    // §12: prioridad visible-first — el caller ya ordena `inputs` de esa forma;
    // el motor procesa en el orden recibido (mismo patrón "secuencial en el
    // orden recibido" documentado en ocr-engine, ADR-021 §5).
    for (const input of inputs) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }

      let lastError: unknown = null;
      let succeeded = false;
      let superseded = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (ctx.abortSignal.aborted) {
          throw new CancelledError(documentId);
        }
        try {
          const output = await this.renderPageInternal(input, ctx, participatesInSupersede);
          outputs.push(output);
          pageIndices.push(input.pageIndex);
          succeeded = true;
          break;
        } catch (err: unknown) {
          if (err instanceof CancelledError) {
            // ADR-037 §4: distingue una cancelación real de batch/pipeline
            // (ctx.abortSignal, comportamiento preexistente: aborta todo el
            // batch) de un supersede page-local (throwIfSuperseded dentro de
            // renderPageInternal): se descarta esta página sin emitir nada y
            // se continúa con las demás del batch. En la vía directa
            // (participatesInSupersede = false) un CancelledError solo puede
            // venir de ctx.abortSignal, así que siempre re-lanza.
            if (ctx.abortSignal.aborted) throw err;
            superseded = true;
            break;
          }
          if (err instanceof RenderPageFailedError || err instanceof RenderTimeoutError) {
            lastError = err;
            continue; // retryable: reintenta si quedan intentos.
          }
          // RenderFailedError / InvalidInputError: no recuperable → aborta el batch (§11).
          if (err instanceof RenderFailedError) {
            ctx.bus.emit(EventChannel.Render, EngineEvents.RENDER_FAILED, {
              documentId: input.documentId,
              error: err.serialize(),
            });
          }
          throw err;
        }
      }

      if (!succeeded && !superseded) {
        // §11/§13 caso 12: falla una página tras reintentos → PREVIEW_PAGE_FAILED, continúa con las demás.
        const failure = this.toPageFailure(input.documentId, input.pageIndex, lastError);
        ctx.bus.emit(EventChannel.Render, EngineEvents.PREVIEW_PAGE_FAILED, {
          documentId: input.documentId,
          pageIndex: input.pageIndex,
          error: failure.serialize(),
        });
        ctx.logger.warn(
          `Render de la página ${input.pageIndex} falló tras reintentos; se continúa con las demás páginas.`,
          { documentId: input.documentId, pageIndex: input.pageIndex },
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    ctx.bus.emit(EventChannel.Render, EngineEvents.RENDER_FINISHED, {
      documentId,
      pageIndices,
      durationMs,
    });

    return outputs;
  }

  requestDeltaRender(documentId: string, groupIds: ReadonlyArray<string>): void {
    // Sin caller síncrono al que lanzarle (mismo tratamiento que las vías por
    // evento, ADR-030 §3): si el motor no está listo o el documento no está
    // cargado, se ignora silenciosamente (con warning cuando hay logger).
    // El delta render usa la vía directa de renderPage: NO participa del
    // supersede por página (nota 6c de cabecera; observación PR4 — antes una
    // entrada de RENDER_REQUESTED a otra escala podía cancelarlo espuriamente
    // y el cambio de grupo se perdía visualmente hasta el próximo evento).
    if (this.disposed || !this.initialized || this.ctx === null) return;
    const ctx = this.ctx;

    if (!this.documents.has(documentId)) {
      ctx.logger.warn(`requestDeltaRender para documento no cargado: ${documentId}`, {
        documentId,
      });
      return;
    }

    const groupIdSet = new Set(groupIds);
    const prefix = `${documentId}:`;
    const affectedPageIndices: number[] = [];

    for (const [key, groupSet] of this.pageGroupIndex) {
      if (!key.startsWith(prefix)) continue;
      let affected = false;
      for (const groupId of groupSet) {
        if (groupIdSet.has(groupId)) {
          affected = true;
          break;
        }
      }
      if (affected) affectedPageIndices.push(Number(key.slice(prefix.length)));
    }

    if (affectedPageIndices.length === 0) return; // §13 caso 11: no-op.

    const overrides = this.getGroupOverrides(documentId);

    for (const pageIndex of affectedPageIndices) {
      const key = pageKey(documentId, pageIndex);

      const anonymizedInput = this.lastAnonymizedInputs.get(key);
      if (anonymizedInput !== undefined) {
        const updated: RenderPageInput = {
          ...anonymizedInput,
          replacements: applyReplacementOverrides(anonymizedInput.replacements ?? [], overrides),
        };
        void this.renderPage(updated, ctx).catch((err: unknown) => {
          this.handleInternalRenderError(ctx, documentId, pageIndex, err);
        });
      }

      const originalInput = this.lastOriginalInputs.get(key);
      if (originalInput !== undefined) {
        const updated: RenderPageInput = {
          ...originalInput,
          annotations: applyAnnotationOverrides(originalInput.annotations ?? [], overrides),
        };
        void this.renderPage(updated, ctx).catch((err: unknown) => {
          this.handleInternalRenderError(ctx, documentId, pageIndex, err);
        });
      }
    }
  }

  dispose(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    for (const doc of this.documents.values()) void doc.destroy();
    this.documents.clear();
    this.cache.clear();
    this.cacheBytes = 0;
    this.pageGroupIndex.clear();
    this.lastAnonymizedInputs.clear();
    this.lastOriginalInputs.clear();
    this.groupOverrides.clear();
    this.pendingRenders.clear();
    this.disposed = true;
    this.initialized = false;
    this.ctx = null;
    return Promise.resolve();
  }

  // ─── Eventos consumidos (§8) ───

  private handleRenderRequested(payload: RenderRequested): void {
    if (this.ctx === null) return;
    const ctx = this.ctx;

    if (!this.documents.has(payload.documentId)) {
      // ADR-030 §3: sin caller al que lanzarle → warn + no-op.
      ctx.logger.warn(`RENDER_REQUESTED para documento no cargado: ${payload.documentId}`, {
        documentId: payload.documentId,
      });
      return;
    }

    // ADR-037 §2: guard de rango en la vía por evento → warn + no-op (sin
    // caller al que lanzarle, mismo tratamiento que documento no cargado).
    if (payload.scale !== undefined && !isValidScale(payload.scale)) {
      ctx.logger.warn(`RENDER_REQUESTED con scale fuera de rango: ${payload.scale}`, {
        documentId: payload.documentId,
        scale: payload.scale,
      });
      return;
    }

    // ADR-037 §1: escala efectiva del request completo (ausente → previewScale/
    // fullScale según mode); se propaga a cada RenderPageInput reconstruido.
    const effectiveScale =
      payload.scale ??
      (payload.mode === "preview" ? ctx.config.render.previewScale : ctx.config.render.fullScale);

    // 06_Pipeline.md §10: se renderiza "original" y luego "anonimizado" por
    // página visible. RenderRequested (Contracts.md §8) no trae kind ni
    // replacements/annotations: se reconstruyen desde el último input
    // recordado por página (o vacío, primera vez) — ver nota de implementación 1.
    const inputs: RenderPageInput[] = [];
    for (const pageIndex of payload.pageIndices) {
      const key = pageKey(payload.documentId, pageIndex);

      // ADR-037 §4: registra la escala vigente para "original" y "anonymized"
      // de esta página — cualquier render POR EVENTO pendiente con otra escala
      // para la misma clave se descarta/aborta en su próximo checkpoint
      // (ver nota 6c de cabecera).
      this.registerPendingRender(payload.documentId, pageIndex, "original", effectiveScale);
      this.registerPendingRender(payload.documentId, pageIndex, "anonymized", effectiveScale);

      const original = this.lastOriginalInputs.get(key);
      inputs.push(
        original !== undefined
          ? { ...original, mode: payload.mode, scale: effectiveScale }
          : {
              documentId: payload.documentId,
              pageIndex,
              kind: "original",
              mode: payload.mode,
              scale: effectiveScale,
            },
      );

      const anonymized = this.lastAnonymizedInputs.get(key);
      inputs.push(
        anonymized !== undefined
          ? { ...anonymized, mode: payload.mode, scale: effectiveScale }
          : {
              documentId: payload.documentId,
              pageIndex,
              kind: "anonymized",
              mode: payload.mode,
              replacements: [],
              scale: effectiveScale,
            },
      );
    }

    // Única vía que participa del supersede (nota 6c de cabecera): los
    // renders de este batch chequean pendingRenders en sus checkpoints.
    void this.renderPagesInternal(inputs, ctx, true).catch((err: unknown) => {
      if (err instanceof CancelledError) return;
      ctx.logger.warn("Fallo al procesar RENDER_REQUESTED.", {
        documentId: payload.documentId,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private handleGroupReplacementChanged(payload: GroupReplacementChanged): void {
    if (this.ctx === null) return;
    if (!this.documents.has(payload.documentId)) {
      this.ctx.logger.warn(
        `GROUP_REPLACEMENT_CHANGED para documento no cargado: ${payload.documentId}`,
        {
          documentId: payload.documentId,
          groupId: payload.groupId,
        },
      );
      return;
    }
    const overrides = this.getGroupOverrides(payload.documentId);
    const existing = overrides.get(payload.groupId) ?? {};
    overrides.set(payload.groupId, { ...existing, mode: payload.mode, value: payload.value });
    this.requestDeltaRender(payload.documentId, [payload.groupId]);
  }

  private handleGroupToggled(payload: GroupToggled): void {
    if (this.ctx === null) return;
    if (!this.documents.has(payload.documentId)) {
      this.ctx.logger.warn(`GROUP_TOGGLED para documento no cargado: ${payload.documentId}`, {
        documentId: payload.documentId,
        groupId: payload.groupId,
      });
      return;
    }
    const overrides = this.getGroupOverrides(payload.documentId);
    const existing = overrides.get(payload.groupId) ?? {};
    overrides.set(payload.groupId, { ...existing, enabled: payload.enabled });
    this.requestDeltaRender(payload.documentId, [payload.groupId]);
  }

  private handleInternalRenderError(
    ctx: EngineContext,
    documentId: string,
    pageIndex: number,
    err: unknown,
  ): void {
    if (err instanceof CancelledError) return;
    const failure = this.toPageFailure(documentId, pageIndex, err);
    ctx.bus.emit(EventChannel.Render, EngineEvents.PREVIEW_PAGE_FAILED, {
      documentId,
      pageIndex,
      error: failure.serialize(),
    });
    ctx.logger.warn(
      `Render interno (delta render / RENDER_REQUESTED) falló para la página ${pageIndex}.`,
      {
        documentId,
        pageIndex,
      },
    );
  }

  private getGroupOverrides(documentId: string): Map<string, GroupOverride> {
    let overrides = this.groupOverrides.get(documentId);
    if (overrides === undefined) {
      overrides = new Map<string, GroupOverride>();
      this.groupOverrides.set(documentId, overrides);
    }
    return overrides;
  }

  // ─── Supersede por página (ADR-037 §4, nota 6 de cabecera) ───

  /**
   * Registra `scale` como la escala vigente para `(documentId, pageIndex, kind)`
   * del flujo por eventos. Un render por evento ya en cola o en vuelo para esa
   * clave con OTRA escala detecta el reemplazo en su próximo checkpoint
   * (`throwIfSuperseded`) y se descarta. Poblado únicamente desde
   * `handleRenderRequested`; las entradas persisten hasta `unloadDocument`/
   * `loadDocument` (reload)/`dispose` — deliberadamente NO se limpian al
   * completar un render (nota 6c de cabecera: limpiarlas reintroduce la
   * carrera en la que el "perdedor" en cola deja de detectar que fue superado
   * si el "ganador" completa y borra la entrada primero).
   */
  private registerPendingRender(
    documentId: string,
    pageIndex: number,
    kind: "original" | "anonymized",
    scale: number,
  ): void {
    this.pendingRenders.set(supersedeKey(documentId, pageIndex, kind), scale);
  }

  /**
   * Checkpoint combinado (ctx.abortSignal + supersede de página) del flujo por
   * eventos — mismos puntos donde la vía directa solo chequea
   * `ctx.abortSignal.aborted`. Lanza `CancelledError` si el batch fue
   * cancelado, o si un `RENDER_REQUESTED` más reciente registró OTRA escala
   * para la misma `(documentId, pageIndex, kind)` (ADR-037 §4). Solo lo
   * invocan renders con `participatesInSupersede = true` (originados en
   * `handleRenderRequested`); las invocaciones directas nunca llegan acá
   * (nota 6c de cabecera, spec §13 caso 21).
   */
  private throwIfSuperseded(
    ctx: EngineContext,
    documentId: string,
    pageIndex: number,
    kind: "original" | "anonymized",
    scale: number,
  ): void {
    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }
    const pendingScale = this.pendingRenders.get(supersedeKey(documentId, pageIndex, kind));
    if (pendingScale !== undefined && pendingScale !== scale) {
      throw new CancelledError(documentId);
    }
  }

  // ─── Pintado sobre canvas (§13 casos 3-8) ───

  private paintReplacements(
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
      // El spec solo pide "fondo blanco" explícitamente para `mask` (caso 4);
      // se extiende a placeholder/synthetic por legibilidad (el texto se
      // pinta sobre el contenido original ya renderizado) — no cambia el
      // texto ni el modo, solo el tratamiento visual de fondo.
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

  private paintAnnotations(
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

  private async renderPageOntoContext(
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
       * incluido `OffscreenCanvasRenderingContext2D`, que es exactamente lo
       * que exige Render_Engine.md §1 y 05_Worker_Architecture.md §7.4
       * (OffscreenCanvas + pdfjs-dist; fe de erratas ADR-030 §5, antes decía
       * "pdf-lib"). El `.d.ts` de la librería no refleja ese soporte (gap de
       * tipos conocido de pdfjs-dist, no corregible sin tocar el paquete).
       *
       * Se investigaron alternativas sin cast antes de usar este: los tipos
       * que "pdfjs-dist" re-exporta en su raíz (`PDFPageProxy`,
       * `RenderParameters`) son alias de tipo (`export type X =
       * import(...).X`), no interfaces, por lo que no admiten declaration
       * merging vía `declare module "pdfjs-dist" { interface ... }` (se
       * comprobó). `CanvasRenderingContext2D` y
       * `OffscreenCanvasRenderingContext2D` tampoco tienen overlap
       * estructural suficiente para un `as` simple (TS2352: a
       * `CanvasRenderingContext2D` le faltan `getContextAttributes` y
       * `drawFocusIfNeeded` en el otro tipo) — se verificó con `tsc`.
       *
       * Este es el ÚNICO `as unknown as` de este paquete y el único de todo
       * el Core fuera de un helper de test. Permitido explícitamente por
       * ADR-031 §4: "Se permite `as unknown as CanvasRenderingContext2D`
       * solo en esa frontera, en un único punto del motor, con comentario
       * justificativo adyacente que cite este ADR" (Code_Standards.md §10
       * documenta la excepción). No cambia ningún contrato público:
       * `RenderPageInput`/`RenderPageOutput` y los eventos del motor son
       * idénticos con o sin este cast.
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

  private createCanvas(
    documentId: string,
    pageIndex: number,
    width: number,
    height: number,
  ): OffscreenCanvas {
    // §13 caso 14: v1.0 puede requerir OffscreenCanvas y mostrar warning si no está.
    if (typeof OffscreenCanvas === "undefined") {
      this.ctx?.logger.warn(
        "OffscreenCanvas no disponible en este entorno; Render Engine v1.0 lo requiere (spec §13 caso 14).",
        { documentId, pageIndex },
      );
      throw new RenderPageFailedError(
        documentId,
        pageIndex,
        "OffscreenCanvas no disponible en este entorno.",
      );
    }
    return new OffscreenCanvas(width, height);
  }

  private get2dContext(
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

  private toPageFailure(
    documentId: string,
    pageIndex: number,
    err: unknown,
  ): RenderPageFailedError | RenderTimeoutError {
    if (err instanceof RenderPageFailedError || err instanceof RenderTimeoutError) return err;
    const reason = err instanceof Error ? err.message : String(err);
    return new RenderPageFailedError(documentId, pageIndex, reason);
  }

  private async emitPreviewUpdated(
    ctx: EngineContext,
    output: RenderPageOutput,
    imageFormat: "png" | "jpeg",
  ): Promise<void> {
    // ADR-034 §3 (reemplaza el placeholder de bytes crudos de ADR-031 §5):
    // codificación real vía `convertToBlob`, donde vive el canvas. `output.encoded`
    // solo existe para mode "full" (§10), así que preview siempre re-codifica
    // desde `imageData` acá — mismos bytes, sin duplicar el campo `encoded`
    // en el output de un preview.
    const encoded = await this.encodeImageData(
      output.imageData,
      imageFormat,
      ctx.config.render.jpegQuality,
      output.documentId,
      output.pageIndex,
    );
    const blob = new Blob([encoded.bytes], { type: `image/${encoded.format}` });
    const canvasBlobUrl = URL.createObjectURL(blob);
    ctx.bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: output.documentId,
      pageIndex: output.pageIndex,
      kind: output.kind,
      canvasBlobUrl,
    });
  }

  /**
   * Codifica `ImageData` a PNG/JPEG vía `OffscreenCanvas.convertToBlob`
   * (ADR-034 §3): "donde vive el canvas" — un `OffscreenCanvas` temporal
   * pintado con `putImageData`, consistente con `07_Performance_Strategy.md`
   * §10. Usado tanto para `RenderPageOutput.encoded` (mode "full") como para
   * el blob de `PREVIEW_UPDATED` (mode "preview").
   */
  private async encodeImageData(
    imageData: ImageData,
    imageFormat: "png" | "jpeg",
    quality: number,
    documentId: string,
    pageIndex: number,
  ): Promise<EncodedPageImage> {
    const canvas = this.createCanvas(documentId, pageIndex, imageData.width, imageData.height);
    const context = this.get2dContext(canvas, documentId, pageIndex);
    context.putImageData(imageData, 0, 0);

    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: `image/${imageFormat}`, quality });
    } catch (err: unknown) {
      throw this.toPageFailure(documentId, pageIndex, err);
    }
    const bytes = await blob.arrayBuffer();
    return { bytes, format: imageFormat, widthPx: imageData.width, heightPx: imageData.height };
  }

  private rememberInput(
    input: RenderPageInput,
    replacements: ReadonlyArray<Replacement>,
    annotations: ReadonlyArray<Annotation>,
  ): void {
    const key = pageKey(input.documentId, input.pageIndex);
    if (input.kind === "anonymized") {
      this.lastAnonymizedInputs.set(key, input);
    } else {
      this.lastOriginalInputs.set(key, input);
    }

    if (replacements.length === 0 && annotations.length === 0) return;
    const groupIds = new Set<string>(this.pageGroupIndex.get(key) ?? []);
    for (const replacement of replacements) groupIds.add(replacement.groupId);
    for (const annotation of annotations) groupIds.add(annotation.groupId);
    this.pageGroupIndex.set(key, groupIds);
  }

  private touchCache(key: string): void {
    const value = this.cache.get(key);
    if (value === undefined) return;
    this.cache.delete(key);
    this.cache.set(key, value);
  }

  // ADR-037 §3: setCacheEntry/deleteCacheEntry mantienen `cacheBytes` en
  // sincronía con `cache` — todo alta/baja del cache pasa por acá (nunca
  // `this.cache.set`/`.delete` directo fuera de estos dos métodos y `touchCache`,
  // que reordena sin cambiar bytes).
  private setCacheEntry(key: string, output: RenderPageOutput): void {
    const existing = this.cache.get(key);
    if (existing !== undefined) this.cacheBytes -= estimateOutputBytes(existing);
    this.cache.set(key, output);
    this.cacheBytes += estimateOutputBytes(output);
  }

  private deleteCacheEntry(key: string): void {
    const existing = this.cache.get(key);
    if (existing === undefined) return;
    this.cacheBytes -= estimateOutputBytes(existing);
    this.cache.delete(key);
  }

  private evictCacheIfNeeded(ctx: EngineContext): void {
    const capacity =
      ctx.config.render.cachePages > 0 ? ctx.config.render.cachePages : DEFAULT_CACHE_PAGES;
    // ADR-037 §3: además del límite por items (cachePages), un límite por
    // bytes (PREVIEW_CACHE_MAX_BYTES) — se evictan las entradas más viejas
    // (orden de inserción del Map) hasta satisfacer ambos límites.
    while (
      this.cache.size > 0 &&
      (this.cache.size > capacity || this.cacheBytes > PREVIEW_CACHE_MAX_BYTES)
    ) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.deleteCacheEntry(oldestKey);
    }
  }

  private clearDocumentState(documentId: string): void {
    // Los documentId son UUID v4 (03_Data_Model.md §2): sin ":" propio, así
    // que el prefijo `${documentId}:` no colisiona con otro documentId.
    const prefix = `${documentId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.deleteCacheEntry(key);
    }
    for (const key of [...this.pageGroupIndex.keys()])
      if (key.startsWith(prefix)) this.pageGroupIndex.delete(key);
    for (const key of [...this.lastAnonymizedInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastAnonymizedInputs.delete(key);
    }
    for (const key of [...this.lastOriginalInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastOriginalInputs.delete(key);
    }
    for (const key of [...this.pendingRenders.keys()]) {
      if (key.startsWith(prefix)) this.pendingRenders.delete(key);
    }
    this.groupOverrides.delete(documentId);
  }

  private assertInitialized(): void {
    if (!this.initialized || this.ctx === null) {
      throw new EngineNotInitializedError(EngineId.Render);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Render);
    }
  }
}
