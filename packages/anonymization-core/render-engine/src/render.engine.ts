/**
 * @anonly/render-engine — `RenderEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Render_Engine.md (v1.5.0, ADR-030, ADR-031,
 * ADR-034, ADR-037, ADR-043, ADR-044).
 *
 * ADR-044 (2026-07-23 — el motor deja de escuchar eventos de Grouping; el
 * delta render por overrides se retira): los reemplazos autoritativos del
 * preview `anonymized` llegan por invocación directa del Orchestrator
 * (`renderPage({ kind: "anonymized", mode: "preview", replacements })`,
 * computados desde el snapshot de Grouping — `Orchestrator.md` §2/§8/§13
 * casos 26-27). Se retiran de este archivo: las suscripciones a
 * `GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`, el método público
 * `requestDeltaRender` (sin callers externos), el estado `groupOverrides` +
 * `applyReplacementOverrides`/`applyAnnotationOverrides`, y el índice
 * `pageIndex → groupIds` (`pageGroupIndex`, cuyo único consumidor era
 * `requestDeltaRender`). Motivo: el primer render `anonymized` salía con
 * `replacements: []` y dejaba `pageGroupIndex` vacío para siempre (deadlock
 * de arranque del preview), y el mecanismo de overrides era lossy (un toggle
 * off→on no podía resucitar los `Replacement` filtrados del input recordado).
 * `lastAnonymizedInputs`/`lastOriginalInputs` se conservan intactos
 * (reconstrucción de `RENDER_REQUESTED`, nota 1 de abajo), igual que todo el
 * reparto host/worker, supersede y cache de ADR-043/ADR-037. Canal
 * escuchado: solo `EventChannel.UI` (`RENDER_REQUESTED`).
 *
 * ADR-043 (reparto host/worker, Hito 10 PR13): la clase `RenderEngine` queda
 * ENTERA host-side — todo su estado (`documents`, cache LRU,
 * `lastAnonymizedInputs`/`lastOriginalInputs`, `pendingRenders`), sus
 * suscripciones al bus, el supersede (ADR-037 §4) y la emisión de
 * eventos/blob URLs. El trabajo que SÍ cruza al
 * worker —rasterización pdfjs + composición OffscreenCanvas + encode— vive en
 * el **kernel** sin estado por documento (`./worker/kernel.ts`,
 * `05_Worker_Architecture.md` §7.4), invocado siempre a través de
 * `this.pool.dispatch({ run, payload })`: con una `RenderPool` real
 * (inyectada por el façade en `createCore`, ver `create-core.ts`) despacha
 * por `postMessage`; sin ella (fallback, usado por los tests de este motor
 * que construyen `new RenderEngine()` directo) invoca el kernel in-process,
 * en el mismo proceso — comportamiento bit-idéntico al de antes de este PR
 * (ADR-035). `documents` pasa de `Map<documentId, PDFDocumentProxy>` a
 * `Map<documentId, { buffer, pageCount }>`: los proxies viven en cada
 * RenderWorker (o en el kernel local, en fallback); el host retiene el
 * `buffer` (para el broadcast/re-priming) y el `pageCount` (para las
 * precondiciones de ADR-030 y la validación de `pageIndex`).
 *
 * ADR-021 (motores inline hasta Hito 9): sin pool PROPIO en el sentido de
 * "instanciado por este archivo" — el pool lo inyecta el façade (constructor,
 * ver `RenderJobPool` más abajo); ausente, cae al fallback in-process
 * trivial. La cancelación es cooperativa vía `ctx.abortSignal` con
 * checkpoints entre operaciones de canvas (ahora dentro del kernel).
 *
 * ADR-034 (auditoría pre-Hito 9): `rasterizePage` (rasterización pura sin
 * eventos/cache, para el flujo OCR del Orchestrator) y `RenderPageOutput.encoded`
 * (bytes codificados en mode "full", vía `convertToBlob`, ahora en el kernel).
 *
 * ADR-030 (`RenderEngine.loadDocument`): el motor obtiene el PDF fuente por
 * invocación directa del caller; en modo worker, el `PDFDocumentProxy` vive en
 * cada RenderWorker — el host solo retiene `{ buffer, pageCount }` (ADR-043 §3).
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
 * 2. (Retirado por ADR-044) El índice `pageIndex → groupIds` y el delta
 *    render por overrides (`requestDeltaRender`, `groupOverrides`) vivían
 *    acá; el re-render por cambio de grupo lo media ahora el Orchestrator con
 *    reemplazos autoritativos del snapshot de Grouping (ver la nota ADR-044
 *    de cabecera).
 * 3. La clave de cache es `documentId:pageIndex:kind:mode:scale:
 *    hash(replacements ++ annotations)` (ADR-031 §2, extendida con `scale`
 *    por ADR-037 §3).
 * 4. `PREVIEW_UPDATED.canvasBlobUrl` (§7): el host arma el blob a partir del
 *    `ImageData` que devuelve el kernel (`encodeImageData` → `convertToBlob`,
 *    ADR-034 §3). El Orchestrator no crea el blob: solo lo rastrea y revoca
 *    (ADR-034 §5).
 * 5. El cast `as unknown as CanvasRenderingContext2D` (ADR-031 §4, único de
 *    este paquete) vive ahora en `./worker/kernel.ts#renderPageOntoContext`
 *    (relocalizado desde este archivo por ADR-043: es el kernel quien invoca
 *    pdfjs, no `RenderEngine`).
 * 6. ADR-037 (zoom con re-render real): guard de rango de `scale`, cache por
 *    escala + límite por bytes, y supersede por página (`pendingRenders`) —
 *    ver el detalle completo en la nota histórica de ADR-037 en versiones
 *    previas de este archivo (comportamiento sin cambios; ADR-043 solo mueve
 *    DÓNDE corre el trabajo de canvas, no la lógica de supersede/cache).
 *    Único cambio de granularidad: el checkpoint de supersede que antes se
 *    chequeaba en 4 puntos intermedios de `renderPageInternal` (antes/después
 *    de cada paso de canvas) ahora se chequea en 2 (antes de despachar al
 *    kernel, y una vez más cuando el kernel resuelve) — el trabajo de canvas
 *    en sí corre atómicamente dentro del kernel. La cancelación real
 *    (`ctx.abortSignal`) SÍ mantiene su granularidad fina: el kernel repite
 *    los mismos checkpoints que antes vivían acá, contra la misma señal.
 * 7. ADR-043 §2: puerto interno `RenderJobPool`/`RenderDispatchParams`
 *    (definidos más abajo, NO exportados desde `index.ts` — detalle de
 *    wiring interno, mismo criterio que `PipelineOrchestratorOptions` en
 *    `orchestrator.ts`, tampoco documentado en `Orchestrator.md` §6).
 *    Estructural a propósito (mismo patrón que `WorkerLike`, Contracts.md
 *    §3.5): la `WorkerPool` real del façade (`packages/anonymization-core/
 *    src/worker-pool.ts`) ya expone `dispatch<T>(params): Promise<T>` con
 *    esta forma, así que la satisface sin ningún cast ni import cruzado
 *    (P-2: este paquete no puede importar del façade, que es quien lo
 *    importa a él). El façade inyecta la pool real vía el constructor
 *    (`new RenderEngine(pool)`, en `create-core.ts`); sin argumento, cae al
 *    fallback in-process trivial (usado por los ~150 tests de este motor,
 *    que construyen `new RenderEngine()` sin pool y esperan exactamente el
 *    comportamiento de antes de este PR — ejecución inmediata, sin cola).
 *    `maxRetriesOverride: 0` en cada `dispatch(...)`: el reintento de
 *    "1 vez" (spec §11) lo sigue implementando este motor en
 *    `renderPagesInternal`, no la pool (evitar reintentos compuestos).
 */

import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  MAX_RENDER_SCALE,
  PREVIEW_CACHE_MAX_BYTES,
  type Annotation,
  type EncodedPageImage,
  type EngineContext,
  type IEngine,
  type LoadDocumentPayload,
  type RasterizePagePayload,
  type RenderPagePayload as RenderPagePayloadWire,
  type RenderRequested,
  type Replacement,
  type Unsubscribe,
  type UnloadDocumentPayload,
} from "@anonly/shared";

import { RenderFailedError, RenderPageFailedError, RenderTimeoutError } from "./render.errors.js";
import type { RenderPageInput, RenderPageOutput } from "./render.types.js";
import {
  kernelDisposeAll,
  kernelLoadDocument,
  kernelRasterizePage,
  kernelRenderPage,
  kernelUnloadDocument,
} from "./worker/kernel.js";

const DEFAULT_TIMEOUT_MS = 10_000; // render-page preview (05_Worker_Architecture.md §4); full=30s idem si config lo define.
const MAX_RETRIES = 1; // spec §11: "reintentar 1 vez"
const DEFAULT_CACHE_PAGES = 16;

// ─── Puerto interno de despacho (ADR-043 §2; ver nota 7 de cabecera) ───

interface RenderDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

interface RenderJobPool {
  dispatch<T>(params: RenderDispatchParams<T>): Promise<T>;
  /**
   * Broadcast (ADR-043 §4): usado por `loadDocument`/`unloadDocument` — a
   * diferencia de `dispatch` (un job a UN worker), un control debe llegar a
   * TODOS los workers vivos del pool. `run` es el fallback in-process
   * (in-process: `broadcast` degenera en una sola invocación de `run()`,
   * ADR-043 §4).
   */
  broadcast<T>(payload: unknown, run: () => Promise<T>): Promise<ReadonlyArray<T>>;
}

/**
 * Fallback in-process trivial: sin `RenderPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (los reintentos de "1 vez" del
 * spec §11 los sigue aplicando `renderPagesInternal`). Es EXACTAMENTE el
 * comportamiento de este motor antes de ADR-043 (no había ninguna pool
 * involucrada en `renderPage`/`rasterizePage`/`loadDocument`/`unloadDocument`
 * — el Orchestrator envolvía por fuera, en `runOcrStage`/`makeRenderPageProvider`,
 * y los tests de este paquete siempre invocaron los métodos directo).
 */
const IMMEDIATE_POOL: RenderJobPool = {
  dispatch: <T>(params: RenderDispatchParams<T>): Promise<T> => params.run(),
  broadcast: async <T>(_payload: unknown, run: () => Promise<T>): Promise<ReadonlyArray<T>> => [
    await run(),
  ],
};

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

/**
 * Entrada interna del cache LRU: a diferencia de `RenderPageOutput` (público,
 * `encoded` opcional según `mode` — Render_Engine.md §10), acá `encoded`
 * SIEMPRE está presente (el kernel lo computa incondicionalmente desde
 * ADR-043, ver `KernelRenderResult`) — permite reusar los mismos bytes para
 * el blob de `PREVIEW_UPDATED` en cache hits de `mode: "preview"` sin volver
 * a tocar `OffscreenCanvas` fuera del kernel.
 */
interface InternalCacheEntry {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly imageData: ImageData;
  readonly encoded: EncodedPageImage;
  readonly durationMs: number;
}

// ADR-037 §3: tamaño estimado de una entrada de cache para el límite por bytes
// (PREVIEW_CACHE_MAX_BYTES) — los píxeles RGBA crudos dominan el costo; se
// suman los bytes codificados (siempre presentes en la entrada interna).
function estimateEntryBytes(entry: InternalCacheEntry): number {
  return entry.imageData.data.byteLength + entry.encoded.bytes.byteLength;
}

/** Proyecta la entrada interna al `RenderPageOutput` público: `encoded` solo se expone si `mode === "full"` (Render_Engine.md §10). */
function toPublicOutput(entry: InternalCacheEntry, mode: "preview" | "full"): RenderPageOutput {
  return {
    documentId: entry.documentId,
    pageIndex: entry.pageIndex,
    kind: entry.kind,
    imageData: entry.imageData,
    durationMs: entry.durationMs,
    ...(mode === "full" ? { encoded: entry.encoded } : {}),
  };
}

/** Documento retenido host-side desde ADR-043 §3: ya no es el `PDFDocumentProxy` (vive en el worker/kernel), solo lo necesario para las precondiciones de ADR-030 y el re-priming. */
interface RetainedDocument {
  readonly buffer: ArrayBuffer;
  readonly pageCount: number;
}

export class RenderEngine implements IEngine {
  readonly id = EngineId.Render;

  private readonly pool: RenderJobPool;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  private unsubscribers: Unsubscribe[] = [];

  private readonly documents = new Map<string, RetainedDocument>();
  private readonly cache = new Map<string, InternalCacheEntry>();
  // Bytes totales cacheados (ADR-037 §3), mantenido en paralelo a `cache` vía
  // setCacheEntry/deleteCacheEntry — nunca se lee directo de `cache.values()`.
  private cacheBytes = 0;
  // Último RenderPageInput usado por página (para la reconstrucción de RENDER_REQUESTED).
  private readonly lastAnonymizedInputs = new Map<string, RenderPageInput>();
  private readonly lastOriginalInputs = new Map<string, RenderPageInput>();
  // Supersede por página (ADR-037 §4, nota 6 de cabecera) — clave
  // `documentId:pageIndex:kind` → escala vigente registrada por el último
  // RENDER_REQUESTED. Poblada únicamente por handleRenderRequested y
  // consultada solo por renders con participatesInSupersede = true.
  private readonly pendingRenders = new Map<string, number>();

  /**
   * `pool` (ADR-043 §2): inyectada por el façade en `createCore`
   * (`create-core.ts`, que ya posee `WorkerPoolManager` — P-1 intacto). Sin
   * argumento, cae al fallback in-process trivial (`IMMEDIATE_POOL`) — el
   * comportamiento que este motor tenía antes de este PR, usado por sus
   * propios tests.
   */
  constructor(pool?: RenderJobPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
  }

  init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    // ADR-044: único canal escuchado desde el retiro del delta render por
    // eventos de Grouping (`GROUP_REPLACEMENT_CHANGED`/`GROUP_TOGGLED`).
    this.unsubscribers = [
      ctx.bus.on(EventChannel.UI, EngineEvents.RENDER_REQUESTED, (payload) =>
        this.handleRenderRequested(payload),
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

    // ADR-043 §4: broadcast "load-document" (control, no job encolable) —
    // llega a CADA RenderWorker vivo (buffer clonado por worker,
    // 05_Worker_Architecture.md §2.3); en fallback, invoca el kernel local
    // directo. `loadDocument` sobre un `documentId` ya cargado recarga
    // determinísticamente (el kernel destruye el proxy anterior — ADR-030
    // §1). Todos los workers parsean el mismo buffer clonado -> mismo
    // `pageCount`; se toma el primero como canónico.
    const payload: LoadDocumentPayload = { documentId, buffer };
    const results = await this.pool.broadcast(payload, () => kernelLoadDocument(payload));
    const result = results[0];
    if (result === undefined) {
      throw new RenderFailedError(
        documentId,
        "load-document no devolvió resultado de ningún worker.",
      );
    }

    // ADR-043 §3: el host retiene { buffer, pageCount } — nunca el proxy.
    this.documents.set(documentId, { buffer, pageCount: result.pageCount });
    this.clearDocumentState(documentId);
    ctx.logger.info(`Documento cargado en Render Engine: ${documentId}`, {
      documentId,
      pageCount: result.pageCount,
    });
  }

  unloadDocument(documentId: string): Promise<void> {
    // ADR-030 §1/§3: sin asserts — no-op idempotente en cualquier secuencia de
    // teardown, incluso tras dispose() (mismo patrón que PdfEngine.releaseDocument).
    const existing = this.documents.get(documentId);
    if (existing === undefined) return Promise.resolve();

    // ADR-043 §4: broadcast "unload-document" simétrico a "load-document" —
    // libera el PDFDocumentProxy de ese documento en cada RenderWorker (o en
    // el kernel local, en fallback).
    const payload: UnloadDocumentPayload = { documentId };
    return this.pool
      .broadcast(payload, () => kernelUnloadDocument(payload))
      .then(() => {
        this.documents.delete(documentId);
        this.clearDocumentState(documentId);
      });
  }

  /**
   * Re-priming (ADR-043 §5): re-envía `load-document` (vía `broadcast`, que
   * llega a TODOS los workers vivos, incluido el recién creado) para cada
   * documento actualmente retenido. Invocado por el façade (`create-core.ts`)
   * como `onWorkerCreated` de la `RenderPool` real — `WorkerPool#workerForSlot`
   * lo espera (`await`) antes de que ese worker acepte cualquier job
   * `render-page`. No forma parte de la interfaz pública documentada
   * (Render_Engine.md §6): wiring interno entre este motor y su pool, mismo
   * criterio que `PipelineOrchestratorOptions` en `orchestrator.ts`. Reenviar
   * a workers que YA tienen el documento cargado es redundante pero
   * inofensivo (recarga determinística, ADR-030 §1) — se prioriza la
   * simplicidad de reusar `broadcast` tal cual sobre evitar ese resend.
   */
  async reprimeWorkers(): Promise<void> {
    if (this.ctx === null) return;
    const ctx = this.ctx;
    await Promise.all(
      [...this.documents.entries()].map(([documentId, doc]) => {
        const payload: LoadDocumentPayload = { documentId, buffer: doc.buffer };
        return this.pool
          .broadcast(payload, () => kernelLoadDocument(payload))
          .catch((err: unknown) => {
            ctx.logger.warn("Fallo al re-primear un RenderWorker nuevo con un documento vigente.", {
              documentId,
              reason: err instanceof Error ? err.message : String(err),
            });
          });
      }),
    );
  }

  /**
   * Render directo de una página (§6). No participa del supersede por página
   * de ADR-037 §4 (spec §13 caso 21): las entradas de `pendingRenders` que
   * deja el flujo de `RENDER_REQUESTED` no afectan a esta vía (export del
   * Orchestrator, delta render, tests) — ver nota 6 de cabecera.
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
    const doc = this.documents.get(documentId);
    if (doc === undefined) {
      // §11 / ADR-030 §2: renderPage/renderPages sobre documentId no cargado → INVALID_INPUT.
      throw new InvalidInputError(
        `Documento ${documentId} no está cargado. Llamá loadDocument antes de renderPage/renderPages (ADR-030).`,
        { documentId },
      );
    }

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.pageCount) {
      throw new InvalidInputError(
        `pageIndex ${pageIndex} fuera de rango para documento con ${doc.pageCount} páginas.`,
        { documentId, pageIndex, pageCount: doc.pageCount },
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

    // ADR-037 §4, alcance precisado por el hallazgo del PR4 (nota 6 de
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

    this.rememberInput(input);

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
      if (mode === "preview") await this.emitPreviewUpdated(ctx, cached);
      return toPublicOutput(cached, mode);
    }

    const startedAt = Date.now();
    const timeoutMs = ctx.config.workerPool.timeouts["render-page"] ?? DEFAULT_TIMEOUT_MS;

    const payload: RenderPagePayloadWire = {
      documentId,
      pageIndex,
      kind,
      mode,
      replacements,
      annotations,
      scale,
      imageFormat,
    };

    // ADR-043 §2: única vía de despacho — converge en pool.dispatch (kernel
    // remoto o in-process). maxRetriesOverride: 0 — ver nota 7 de cabecera
    // (el reintento de "1 vez" lo sigue aplicando renderPagesInternal, no la
    // pool). Prioridad (05_Worker_Architecture.md §6.2): el camino completo
    // del export (mode "full") va a 1000; preview usa 70 (nivel "visible" —
    // este motor no recibe información de visibilidad de página en su
    // input, así que no distingue visible/no-visible dentro de "preview";
    // el orden de despacho de `renderPagesInternal` ya prioriza por el orden
    // en que el caller arma `inputs`, mismo criterio preexistente).
    const kernelResult = await this.pool.dispatch({
      run: () =>
        kernelRenderPage(payload, {
          jpegQuality: ctx.config.render.jpegQuality,
          timeoutMs,
          abortSignal: ctx.abortSignal,
          onWarn: (message, meta) => ctx.logger.warn(message, meta),
        }),
      signal: ctx.abortSignal,
      priority: mode === "full" ? 1000 : 70,
      payload,
      maxRetriesOverride: 0,
    });

    // Segundo checkpoint (ver nota 6 de cabecera): revalida supersede/abort
    // una vez más ahora que el kernel resolvió, antes de cachear/emitir. El
    // trabajo de canvas del kernel para un render ya superado no se
    // interrumpe a mitad de camino (ADR-043 no lo prioriza), pero su
    // resultado se descarta acá sin efectos observables.
    checkpoint();

    const durationMs = Date.now() - startedAt;
    const entry: InternalCacheEntry = {
      documentId,
      pageIndex,
      kind,
      imageData: kernelResult.imageData,
      encoded: kernelResult.encoded,
      durationMs,
    };

    this.setCacheEntry(cacheKey, entry);
    this.evictCacheIfNeeded(ctx);

    if (mode === "preview") {
      await this.emitPreviewUpdated(ctx, entry);
    }

    return toPublicOutput(entry, mode);
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

    const doc = this.documents.get(documentId);
    if (doc === undefined) {
      throw new InvalidInputError(
        `Documento ${documentId} no está cargado. Llamá loadDocument antes de rasterizePage (ADR-030, ADR-034 §1).`,
        { documentId },
      );
    }

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.pageCount) {
      throw new InvalidInputError(
        `pageIndex ${pageIndex} fuera de rango para documento con ${doc.pageCount} páginas.`,
        { documentId, pageIndex, pageCount: doc.pageCount },
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
    const payload: RasterizePagePayload = { documentId, pageIndex, scale };

    // Prioridad 90 (05_Worker_Architecture.md §6.2: espejo de ocr-page
    // visible, a la que esta rasterización alimenta — ADR-036 §4).
    return this.pool.dispatch({
      run: () =>
        kernelRasterizePage(payload, {
          timeoutMs,
          abortSignal: ctx.abortSignal,
          onWarn: (message, meta) => ctx.logger.warn(message, meta),
        }),
      signal: ctx.abortSignal,
      priority: 90,
      payload,
      maxRetriesOverride: 0,
    });
  }

  /**
   * Render directo de un batch (§6). Igual que `renderPage`, no participa del
   * supersede por página (spec §13 caso 21) — ver nota 6 de cabecera.
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

  dispose(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    // ADR-043 §2: no pasa por pool.dispatch (dispose no es una de las 4
    // operaciones del puerto) — libera directo el kernel local. La
    // liberación de PDFDocumentProxy en RenderWorkers reales llega por el
    // mensaje genérico DISPOSE del protocolo, disparado por
    // WorkerPoolManager.disposeAll() (05_Worker_Architecture.md §7.4).
    kernelDisposeAll();
    this.documents.clear();
    this.cache.clear();
    this.cacheBytes = 0;
    this.lastAnonymizedInputs.clear();
    this.lastOriginalInputs.clear();
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
      // (ver nota 6 de cabecera).
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

    // Única vía que participa del supersede (nota 6 de cabecera): los
    // renders de este batch chequean pendingRenders en sus checkpoints.
    void this.renderPagesInternal(inputs, ctx, true).catch((err: unknown) => {
      if (err instanceof CancelledError) return;
      ctx.logger.warn("Fallo al procesar RENDER_REQUESTED.", {
        documentId: payload.documentId,
        reason: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ─── Supersede por página (ADR-037 §4, nota 6 de cabecera) ───

  /**
   * Registra `scale` como la escala vigente para `(documentId, pageIndex, kind)`
   * del flujo por eventos. Un render por evento ya en cola o en vuelo para esa
   * clave con OTRA escala detecta el reemplazo en su próximo checkpoint
   * (`throwIfSuperseded`) y se descarta. Poblado únicamente desde
   * `handleRenderRequested`; las entradas persisten hasta `unloadDocument`/
   * `loadDocument` (reload)/`dispose` — deliberadamente NO se limpian al
   * completar un render (nota 6 de cabecera: limpiarlas reintroduce la
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
   * (nota 6 de cabecera, spec §13 caso 21).
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

  // ─── Helpers de host ───

  private toPageFailure(
    documentId: string,
    pageIndex: number,
    err: unknown,
  ): RenderPageFailedError | RenderTimeoutError {
    if (err instanceof RenderPageFailedError || err instanceof RenderTimeoutError) return err;
    const reason = err instanceof Error ? err.message : String(err);
    return new RenderPageFailedError(documentId, pageIndex, reason);
  }

  /**
   * Emite `PREVIEW_UPDATED` reusando `entry.encoded` (siempre presente en la
   * entrada interna del cache, ver `InternalCacheEntry` — el kernel lo
   * computa incondicionalmente desde ADR-043, tanto para `mode: "preview"`
   * como `"full"`). No vuelve a tocar `OffscreenCanvas`: ni acá ni en ningún
   * otro punto de esta clase — esa frontera vive exclusivamente en
   * `./worker/kernel.ts` desde ADR-043 §1.
   */
  private emitPreviewUpdated(ctx: EngineContext, entry: InternalCacheEntry): Promise<void> {
    const blob = new Blob([entry.encoded.bytes], { type: `image/${entry.encoded.format}` });
    const canvasBlobUrl = URL.createObjectURL(blob);
    ctx.bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: entry.documentId,
      pageIndex: entry.pageIndex,
      kind: entry.kind,
      canvasBlobUrl,
    });
    return Promise.resolve();
  }

  /** Recuerda el último `RenderPageInput` por página, para la reconstrucción de `RENDER_REQUESTED` (nota 1 de cabecera). */
  private rememberInput(input: RenderPageInput): void {
    const key = pageKey(input.documentId, input.pageIndex);
    if (input.kind === "anonymized") {
      this.lastAnonymizedInputs.set(key, input);
    } else {
      this.lastOriginalInputs.set(key, input);
    }
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
  private setCacheEntry(key: string, entry: InternalCacheEntry): void {
    const existing = this.cache.get(key);
    if (existing !== undefined) this.cacheBytes -= estimateEntryBytes(existing);
    this.cache.set(key, entry);
    this.cacheBytes += estimateEntryBytes(entry);
  }

  private deleteCacheEntry(key: string): void {
    const existing = this.cache.get(key);
    if (existing === undefined) return;
    this.cacheBytes -= estimateEntryBytes(existing);
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
    for (const key of [...this.lastAnonymizedInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastAnonymizedInputs.delete(key);
    }
    for (const key of [...this.lastOriginalInputs.keys()]) {
      if (key.startsWith(prefix)) this.lastOriginalInputs.delete(key);
    }
    for (const key of [...this.pendingRenders.keys()]) {
      if (key.startsWith(prefix)) this.pendingRenders.delete(key);
    }
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
