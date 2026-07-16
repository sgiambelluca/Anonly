/**
 * @anonly/render-engine — `RenderEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Render_Engine.md (v1.1.1, ADR-030, ADR-031).
 *
 * ADR-021 (motores inline hasta Hito 9): sin pool propio, sin Workers
 * propios. Corre en el host (main thread) con `OffscreenCanvas` +
 * `pdfjs-dist`. La cancelación es cooperativa vía `ctx.abortSignal` con
 * checkpoints entre operaciones de Canvas; el SLA estricto < 200ms se valida
 * en Hito 9/11 (mismo precedente que pdf-engine/ocr-engine/ner-engine).
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
 * 4. `PREVIEW_UPDATED.canvasBlobUrl` (§7): la nota del spec describe que en
 *    la arquitectura de Worker (Hito 9) el host genera el blob a partir del
 *    `ImageData` transferido, para evitar `createObjectURL` en el worker. En
 *    Hito 7 (inline, ADR-021) no hay un host separado: el propio motor arma
 *    el blob (igual que `PdfEngine`/`OcrEngine` emiten sus propios eventos en
 *    modo inline) — item 7 del checklist ("Implementar `renderPage` con...
 *    `PREVIEW_UPDATED` por página") lo confirma. Como no hay codificador de
 *    imagen real disponible inline (eso es del Export Engine, Hito 8), el
 *    `Blob` envuelve los bytes crudos de `ImageData.data` con el
 *    `imageFormat` solicitado solo como pista de tipo MIME (`image/png` /
 *    `image/jpeg`), no como una codificación real. Aceptado como placeholder
 *    de Hito 7 (ADR-031 §5); la codificación real y el armado del blob en el
 *    host llegan con el Orchestrator (Hito 9) — pendiente a verificar ahí.
 * 5. `as unknown as CanvasRenderingContext2D` en `renderPageOntoContext`:
 *    ÚNICO cast de este tipo en código de producción de todo el Core (ver el
 *    comentario puntual, más abajo, para el detalle técnico completo).
 *    Excepción aprobada explícitamente por ADR-031 §4 (Code_Standards.md §10).
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
  ReplacementMode,
  type Annotation,
  type BoundingBox,
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

function buildCacheKey(
  documentId: string,
  pageIndex: number,
  kind: "original" | "anonymized",
  mode: "preview" | "full",
  replacements: ReadonlyArray<Replacement>,
  annotations: ReadonlyArray<Annotation>,
): string {
  return `${documentId}:${pageIndex}:${kind}:${mode}:${hashPageContent(replacements, annotations)}`;
}

function pageKey(documentId: string, pageIndex: number): string {
  return `${documentId}:${pageIndex}`;
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
  // Índice pageIndex → groupIds (§12), clave `${documentId}:${pageIndex}`.
  private readonly pageGroupIndex = new Map<string, Set<string>>();
  // Último RenderPageInput usado por página (para RENDER_REQUESTED y delta render).
  private readonly lastAnonymizedInputs = new Map<string, RenderPageInput>();
  private readonly lastOriginalInputs = new Map<string, RenderPageInput>();
  // Overrides pendientes por (documentId, groupId) — ver nota de implementación 2.
  private readonly groupOverrides = new Map<string, Map<string, GroupOverride>>();

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

  async renderPage(input: RenderPageInput, ctx: EngineContext): Promise<RenderPageOutput> {
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

    this.rememberInput(input, replacements, annotations);

    const cacheKey = buildCacheKey(documentId, pageIndex, kind, mode, replacements, annotations);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.touchCache(cacheKey);
      if (mode === "preview") this.emitPreviewUpdated(ctx, cached, imageFormat);
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

    if (kind === "anonymized") {
      this.paintReplacements(context2d, replacements, scale, ctx.abortSignal, documentId);
    } else {
      this.paintAnnotations(context2d, annotations, scale, ctx.abortSignal, documentId);
    }

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(documentId);
    }

    const imageData = context2d.getImageData(0, 0, viewport.width, viewport.height);
    const durationMs = Date.now() - startedAt;
    const output: RenderPageOutput = { documentId, pageIndex, kind, imageData, durationMs };

    this.cache.set(cacheKey, output);
    this.evictCacheIfNeeded(ctx);

    if (mode === "preview") {
      this.emitPreviewUpdated(ctx, output, imageFormat);
    }

    return output;
  }

  async renderPages(
    inputs: ReadonlyArray<RenderPageInput>,
    ctx: EngineContext,
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

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (ctx.abortSignal.aborted) {
          throw new CancelledError(documentId);
        }
        try {
          const output = await this.renderPage(input, ctx);
          outputs.push(output);
          pageIndices.push(input.pageIndex);
          succeeded = true;
          break;
        } catch (err: unknown) {
          if (err instanceof CancelledError) throw err;
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

      if (!succeeded) {
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
    this.pageGroupIndex.clear();
    this.lastAnonymizedInputs.clear();
    this.lastOriginalInputs.clear();
    this.groupOverrides.clear();
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

    // 06_Pipeline.md §10: se renderiza "original" y luego "anonimizado" por
    // página visible. RenderRequested (Contracts.md §8) no trae kind ni
    // replacements/annotations: se reconstruyen desde el último input
    // recordado por página (o vacío, primera vez) — ver nota de implementación 1.
    const inputs: RenderPageInput[] = [];
    for (const pageIndex of payload.pageIndices) {
      const key = pageKey(payload.documentId, pageIndex);

      const original = this.lastOriginalInputs.get(key);
      inputs.push(
        original !== undefined
          ? { ...original, mode: payload.mode }
          : { documentId: payload.documentId, pageIndex, kind: "original", mode: payload.mode },
      );

      const anonymized = this.lastAnonymizedInputs.get(key);
      inputs.push(
        anonymized !== undefined
          ? { ...anonymized, mode: payload.mode }
          : {
              documentId: payload.documentId,
              pageIndex,
              kind: "anonymized",
              mode: payload.mode,
              replacements: [],
            },
      );
    }

    void this.renderPages(inputs, ctx).catch((err: unknown) => {
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

  private emitPreviewUpdated(
    ctx: EngineContext,
    output: RenderPageOutput,
    imageFormat: "png" | "jpeg",
  ): void {
    // Nota de implementación 4 (cabecera del archivo): sin codificador de
    // imagen real disponible inline; el Blob envuelve los bytes crudos con el
    // tipo MIME solicitado como pista de formato. Aceptado como placeholder de
    // Hito 7 (ADR-031 §5): la codificación real de imagen y el armado del
    // blob en el host (spec §7, `convertToBlob`) llegan con el Orchestrator
    // en Hito 9 — pendiente a verificar en ese hito, no perder de vista.
    const blob = new Blob([output.imageData.data], { type: `image/${imageFormat}` });
    const canvasBlobUrl = URL.createObjectURL(blob);
    ctx.bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: output.documentId,
      pageIndex: output.pageIndex,
      kind: output.kind,
      canvasBlobUrl,
    });
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

  private evictCacheIfNeeded(ctx: EngineContext): void {
    const capacity =
      ctx.config.render.cachePages > 0 ? ctx.config.render.cachePages : DEFAULT_CACHE_PAGES;
    while (this.cache.size > capacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private clearDocumentState(documentId: string): void {
    // Los documentId son UUID v4 (03_Data_Model.md §2): sin ":" propio, así
    // que el prefijo `${documentId}:` no colisiona con otro documentId.
    const prefix = `${documentId}:`;
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
    for (const key of [...this.pageGroupIndex.keys()])
      if (key.startsWith(prefix)) this.pageGroupIndex.delete(key);
    for (const key of [...this.lastAnonymizedInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastAnonymizedInputs.delete(key);
    }
    for (const key of [...this.lastOriginalInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastOriginalInputs.delete(key);
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
