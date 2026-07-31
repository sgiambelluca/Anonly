/**
 * @anonly/export-engine — `ExportEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Export_Engine.md (v1.2.0, ADR-047).
 *
 * ADR-047 (PR16, reparto host/worker): `export()` queda entero host-side
 * (validación, loop por página, `RenderPageProvider`, retry/timeout, los
 * cuatro eventos, sanitización de `title`/`filename`, blob URL). Al
 * **ExportWorker** cruzan solo dos operaciones de pdf-lib —`append-page` y
 * `save`— a través del puerto interno `ExportJobPool` (espejo de
 * `OcrJobPool`/ADR-045 §2, `NerJobPool`/ADR-046 §2): con `pool` inyectado por
 * constructor, cada despacho corre por `WorkerPool` (Web Worker real si el
 * façade lo configuró, `ADR-036 §2`); sin `pool` (`new ExportEngine()`),
 * cae al fallback in-process trivial (`IMMEDIATE_POOL`), que invoca el mismo
 * módulo de ensamblado (`./worker/assembler.js`) directo — bit-idéntico,
 * ADR-035. El `PDFDocument` en construcción vive en `this.assemblerState`
 * cuando se usa el fallback (el worker real lo retiene del otro lado de la
 * frontera, `worker/entry.ts`).
 *
 * ADR-032 (auditoría pre-Hito 8): `RenderPageProvider.renderFull` devuelve
 * `EncodedPageImage` (bytes ya codificados PNG/JPEG); el motor no se
 * suscribe a ningún evento (`EXPORT_REQUESTED` lo escucha el Orchestrator,
 * que arma `ExportEngineInput` y llama `export()` directamente); con 0
 * grupos `enabled`, `export()` **no lanza**: loguea `ctx.logger.warn` con el
 * code `EXPORT_NO_ENABLED_GROUPS` en metadata y continúa (el export
 * resultante es idéntico al original reconstruido).
 *
 * Notas de diseño no triviales (dentro del margen que el spec deja abierto,
 * ninguna rompe un contrato público de Contracts.md/Export_Engine.md):
 *
 * 1. `Replacement.originalValue` (uno por cada `Replacement` resuelto de un
 *    grupo `enabled`, §"Flujo de export": "replacements = resolver
 *    replacements de grupos enabled para esta página") no tiene fuente propia
 *    en el modelo de datos: `EntityGroup` no guarda un valor original por
 *    `OccurrenceRef` (solo `canonicalValue` a nivel de grupo) y
 *    `OccurrenceRef` no incluye `value`. Se usa `group.canonicalValue` como
 *    `originalValue`: es el único dato semánticamente equivalente disponible,
 *    y el campo no es consumido por ninguna lógica de seguridad ni de
 *    ensamblado (`RenderEngine.paintReplacements` tampoco lo lee, solo usa
 *    `mode`/`replacementValue`) — no afecta ninguna garantía del export.
 * 2. `ExportEngineInput.rules` no se usa en `export()`: por diseño, el
 *    Grouping Engine ya resuelve `replacementMode`/`replacementValue` de cada
 *    `EntityGroup` aplicando `Rule[]` en orden de prioridad antes de que
 *    Export reciba los grupos (`Grouping_Engine.md` §2: "Resolver
 *    replacementMode y replacementValue aplicando Rule[]..."). El campo se
 *    preserva en el tipo de entrada porque así lo define §6/§9 del spec (el
 *    Orchestrator lo tiene disponible y lo pasa), pero Export no necesita
 *    reprocesarlo.
 * 3. `ExportOptions.filename` no tiene ningún punto de inserción en el PDF
 *    resultante ni en `ExportEngineOutput`/`ExportFinished` (ninguno de los
 *    dos expone un campo de nombre de archivo — spec §10, Contracts.md §8):
 *    es un dato de conveniencia para que el host arme la descarga (Hito 9/10),
 *    fuera del alcance de Export. Por construcción, ningún valor de
 *    `filename` puede afectar la estructura del PDF (nunca se interpola en
 *    el output) — la propiedad de seguridad de la §13 caso 16 ("se sanitiza
 *    para evitar PDF injection") se cumple trivialmente para `filename` sin
 *    código adicional; `title` sí se embebe (`pdfDoc.setTitle`) y por eso es
 *    el único campo que pasa por `sanitizeMetadataString` (checklist §15.8).
 */

import {
  CancelledError,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type EntityGroup,
  type ExportMetadata,
  type ExportPagePayload,
  type ExportSavePayload,
  type IEngine,
  type Replacement,
} from "@anonly/shared";

import { ExportFailedError, ExportTimeoutError } from "./export.errors.js";
import type {
  EncodedPageImage,
  ExportEngineInput,
  ExportEngineOutput,
  RenderPageProvider,
} from "./export.types.js";
import {
  appendPage,
  discardState,
  savePdf,
  type AssemblerState,
  EMPTY_ASSEMBLER_STATE,
} from "./worker/assembler.js";

const DEFAULT_TIMEOUT_MS = 30_000; // spec §11/§12: "default 30 s por página".
const MAX_RETRIES = 1; // spec §11: "reintentar 1 vez".
const MAX_TITLE_LENGTH = 500; // spec §13 caso 16: "título muy largo".

// ─── Puerto interno de despacho (ADR-047 §2, espejo exacto de
// OcrJobPool/OcrDispatchParams en ocr-engine/src/ocr.engine.ts y
// NerJobPool/NerDispatchParams en ner-engine/src/ner.engine.ts). No
// exportado desde index.ts — detalle de wiring interno. ───

interface ExportDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

interface ExportJobPool {
  dispatch<T>(params: ExportDispatchParams<T>): Promise<T>;
}

/**
 * Fallback in-process trivial: sin `ExportPool` inyectada, ejecuta `run()`
 * directo, sin cola ni reintentos propios (los dos únicos loops de retry son
 * los de `exportPage`/`saveWithRetry`, host-side). Es el comportamiento que
 * este motor tenía antes de ADR-047 (ADR-035 §1) — el que los tests
 * existentes de este paquete ya esperan (`new ExportEngine()` sin argumento).
 */
const IMMEDIATE_POOL: ExportJobPool = {
  dispatch: <T>(params: ExportDispatchParams<T>): Promise<T> => params.run(),
};

/**
 * Corre `dispatch()` en carrera contra un timeout local: `workerPool.timeouts
 * ["export-page"]` (30 s) lo aplica el host envolviendo el despacho — el pool
 * no tiene timeout propio (ADR-047 §5). Mismo patrón que `renderPageWithTimeout`
 * más abajo, generalizado para los dos despachos nuevos (append-page/save).
 */
async function withDispatchTimeout<T>(
  dispatch: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([dispatch(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Normaliza un error emergente del despacho a la subclase concreta que
 * corresponde por `code` (ADR-047 §5, espejo de `normalizeTimeout` de
 * ocr-engine/ADR-045 §2 y `normalizeNerError` de ner-engine/ADR-046 §2): un
 * error local (fallback in-process, lanzado por `worker/assembler.ts` o por
 * el timeout local de `withDispatchTimeout`) ya es la instancia concreta.
 * Uno que cruzó un worker remoto llega deserializado (`EngineError.deserialize`,
 * `Contracts.md` §4) como instancia genérica con el `code` correcto, que NO
 * es `instanceof ExportTimeoutError` ni `instanceof ExportFailedError` — sin
 * esta normalización, el `error.code` final emitido en `EXPORT_FAILED`
 * cambiaría de forma según haya worker real o fallback. `pageIndex` está
 * ausente para el despacho de `save` (sin página asociada): en ese caso un
 * `EXPORT_TIMEOUT` deserializado se trata como `ExportFailedError` (mismo
 * criterio que el timeout local de `saveWithRetry`, que tampoco usa
 * `ExportTimeoutError` — su mensaje es page-specific).
 */
function normalizeExportError(
  err: unknown,
  documentId: string,
  timeoutMs: number,
  pageIndex?: number,
): unknown {
  if (err instanceof ExportTimeoutError || err instanceof ExportFailedError) return err;
  if (!(err instanceof EngineError)) return err;
  if (err.code === EngineErrorCode.EXPORT_TIMEOUT && pageIndex !== undefined) {
    return new ExportTimeoutError(documentId, pageIndex, timeoutMs);
  }
  if (err.code === EngineErrorCode.EXPORT_TIMEOUT || err.code === EngineErrorCode.EXPORT_FAILED) {
    const reason = typeof err.details.reason === "string" ? err.details.reason : err.message;
    return new ExportFailedError(documentId, reason, pageIndex !== undefined ? { pageIndex } : {});
  }
  return err;
}

/**
 * Elimina caracteres de control (incluye NUL, CR, LF) y trunca a un largo
 * razonable. `pdf-lib` ya escapa paréntesis/backslashes al serializar
 * `PDFString`, pero esta capa no depende de esa garantía interna de la
 * librería (spec §13 caso 16, checklist §15.8).
 */
function sanitizeMetadataString(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) result += char;
  }
  return result.length > MAX_TITLE_LENGTH ? result.slice(0, MAX_TITLE_LENGTH) : result;
}

// Nota de implementación 1 (cabecera del archivo): originalValue = canonicalValue.
// Exportada desde index.ts por ADR-044 §4: única excepción sancionada a "index.ts
// exporta solo la clase/tipos/errores" (Export_Engine.md §15.16) — el façade
// (Orchestrator) la importa para computar los reemplazos del preview mediado
// con la MISMA semántica que el export (grupos → Replacement[] por página,
// filtrando enabled === false).
export function buildPageReplacements(
  pageIndex: number,
  groups: ReadonlyArray<EntityGroup>,
): ReadonlyArray<Replacement> {
  const replacements: Replacement[] = [];
  for (const group of groups) {
    if (!group.enabled) continue;
    for (const member of group.members) {
      if (member.pageIndex !== pageIndex) continue;
      replacements.push({
        groupId: group.id,
        occurrenceId: member.occurrenceId,
        pageIndex: member.pageIndex,
        bbox: member.bbox,
        originalValue: group.canonicalValue,
        replacementValue: group.replacementValue,
        mode: group.replacementMode,
      });
    }
  }
  return replacements;
}

async function renderPageWithTimeout(
  provider: RenderPageProvider,
  pageIndex: number,
  replacements: ReadonlyArray<Replacement>,
  abortSignal: AbortSignal,
  documentId: string,
  timeoutMs: number,
): Promise<EncodedPageImage> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ExportTimeoutError(documentId, pageIndex, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.renderFull(pageIndex, replacements, abortSignal),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export class ExportEngine implements IEngine {
  readonly id = EngineId.Export;

  private readonly pool: ExportJobPool;

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;
  // El PDFDocument en construcción del fallback in-process (ADR-047 §1/§4):
  // sin uso cuando `this.pool` despacha a un worker real (ese estado vive
  // del otro lado de la frontera, `worker/entry.ts`).
  private assemblerState: AssemblerState = EMPTY_ASSEMBLER_STATE;

  /**
   * `pool` (ADR-047 §2): inyectada por el façade en `createCore`
   * (`create-core.ts`, espejo de `new OcrEngine(ocrPool)`/`new
   * NerEngine(nerPool)`, sobre un `WorkerPool` de `size: 1`). Sin argumento,
   * cae al fallback in-process trivial (`IMMEDIATE_POOL`) — el comportamiento
   * que este motor tenía antes de ADR-047, usado por sus propios tests.
   */
  constructor(pool?: ExportJobPool) {
    this.pool = pool ?? IMMEDIATE_POOL;
  }

  init(ctx: EngineContext): Promise<void> {
    // §8/ADR-032 §2: sin suscripciones a eventos. EXPORT_REQUESTED lo escucha
    // el Orchestrator, que llama export() directamente.
    this.ctx = ctx;
    this.initialized = true;
    this.disposed = false;
    ctx.logger.info("Export Engine initialized");
    return Promise.resolve();
  }

  async export(input: ExportEngineInput, ctx: EngineContext): Promise<ExportEngineOutput> {
    this.assertNotDisposed();
    this.assertInitialized();

    if (input == null) {
      throw new InvalidInputError("Input es null o undefined.", { engineId: EngineId.Export });
    }

    this.validateInput(input);

    if (ctx.abortSignal.aborted) {
      throw new CancelledError(input.documentId);
    }

    const startedAt = Date.now();
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_STARTED, {
      documentId: input.documentId,
    });

    const enabledGroups = input.groups.filter((group) => group.enabled);
    if (enabledGroups.length === 0) {
      // ADR-032 §3: no lanza, loguea y continúa (export = original reconstruido).
      ctx.logger.warn(
        "Ningún grupo habilitado; el export será idéntico al original reconstruido.",
        { documentId: input.documentId, code: EngineErrorCode.EXPORT_NO_ENABLED_GROUPS },
      );
    }

    const totalPages = input.document.pageCount;
    const timeoutMs = ctx.config.workerPool.timeouts["export-page"] ?? DEFAULT_TIMEOUT_MS;

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }

      await this.exportPage(input, ctx, pageIndex, timeoutMs);

      ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, {
        documentId: input.documentId,
        current: pageIndex + 1,
        total: totalPages,
      });
    }

    const metadata: ExportMetadata = {
      producer: "Anonly",
      creator: "Anonly",
      creationDate: new Date(),
      ...(input.options.title !== undefined
        ? { title: sanitizeMetadataString(input.options.title) }
        : {}),
    };

    const buffer = await this.saveWithRetry(input.documentId, ctx, metadata, timeoutMs);

    const durationMs = Date.now() - startedAt;
    // ADR-047 §6: el blob URL se crea siempre en host, nunca en el worker
    // (que no tiene `createObjectURL` garantizado).
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));

    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: input.documentId,
      blobUrl,
      sizeBytes: buffer.byteLength,
      durationMs,
    });

    return { documentId: input.documentId, buffer, sizeBytes: buffer.byteLength, durationMs };
  }

  dispose(): Promise<void> {
    // ADR-047 §1/§4: libera el ensamblador local del fallback in-process (el
    // de un worker real se libera por el DISPOSE del protocolo,
    // `worker/entry.ts`).
    this.assemblerState = discardState();
    this.ctx = null;
    this.initialized = false;
    this.disposed = true;
    return Promise.resolve();
  }

  // ─── Internos ───

  private validateInput(input: ExportEngineInput): void {
    if (input.document.pageCount <= 0) {
      // §9 restricción / §13 caso 1.
      throw new InvalidInputError("document.pageCount debe ser mayor a 0.", {
        documentId: input.documentId,
        pageCount: input.document.pageCount,
      });
    }
    if (input.renderPageProvider == null) {
      throw new InvalidInputError("renderPageProvider debe estar poblado.", {
        documentId: input.documentId,
      });
    }
    const { dpi, imageFormat, jpegQuality } = input.options;
    if (!(dpi > 0) || dpi > 600) {
      throw new InvalidInputError(`options.dpi debe estar en (0, 600]. Recibido: ${dpi}.`, {
        documentId: input.documentId,
        dpi,
      });
    }
    if (imageFormat === "jpeg" && (jpegQuality < 0.5 || jpegQuality > 1)) {
      throw new InvalidInputError(
        `options.jpegQuality debe estar en [0.5, 1] para JPEG. Recibido: ${jpegQuality}.`,
        { documentId: input.documentId, jpegQuality },
      );
    }
  }

  private async exportPage(
    input: ExportEngineInput,
    ctx: EngineContext,
    pageIndex: number,
    timeoutMs: number,
  ): Promise<void> {
    const page = input.document.pages[pageIndex];
    if (page === undefined) {
      throw new InvalidInputError(
        `document.pages[${pageIndex}] no existe (pageCount=${input.document.pageCount}).`,
        { documentId: input.documentId, pageIndex },
      );
    }

    const replacements = buildPageReplacements(pageIndex, input.groups);

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }
      try {
        const pageImage = await renderPageWithTimeout(
          input.renderPageProvider,
          pageIndex,
          replacements,
          ctx.abortSignal,
          input.documentId,
          timeoutMs,
        );

        if (ctx.abortSignal.aborted) {
          throw new CancelledError(input.documentId);
        }

        // ADR-047 §1/§3: solo la frontera pdf-lib cruza al worker
        // (`append-page`), vía el puerto `ExportJobPool`. `maxRetriesOverride:
        // 0` — el pool nunca reintenta un `export-page`; el único loop de
        // retry es este. La idempotencia por `pageIndex` del ensamblador
        // (ADR-047 §4) reemplaza al guard `pageCountBeforeAttempt` que tenía
        // este método antes de ADR-047.
        const payload: ExportPagePayload = {
          documentId: input.documentId,
          pageIndex,
          pageImage: pageImage.bytes,
          imageFormat: pageImage.format,
          pageWidthPt: page.width,
          pageHeightPt: page.height,
        };

        await withDispatchTimeout(
          () =>
            this.pool.dispatch<void>({
              run: () => this.dispatchAppendPage(payload, ctx.abortSignal),
              signal: ctx.abortSignal,
              payload,
              maxRetriesOverride: 0,
            }),
          timeoutMs,
          () => new ExportTimeoutError(input.documentId, pageIndex, timeoutMs),
        );

        return;
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = normalizeExportError(err, input.documentId, timeoutMs, pageIndex);
      }
    }

    const failure = this.toExportFailure(input.documentId, pageIndex, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId: input.documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  /** `run()` del fallback in-process para `append-page`: invoca el ensamblador directo y reasigna el estado local (ADR-035, bit-idéntico). */
  private async dispatchAppendPage(
    payload: ExportPagePayload,
    abortSignal: AbortSignal,
  ): Promise<void> {
    this.assemblerState = await appendPage(this.assemblerState, payload, { abortSignal });
  }

  private async saveWithRetry(
    documentId: string,
    ctx: EngineContext,
    metadata: ExportMetadata,
    timeoutMs: number,
  ): Promise<ArrayBuffer> {
    const payload: ExportSavePayload = { documentId, metadata };
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }
      try {
        // §12: "Tamaño del PDF... mitigado con save({ useObjectStreams: true })".
        // ADR-047 §1/§3: la serialización cruza al worker vía el mismo puerto
        // (`save`), con `maxRetriesOverride: 0` — este es el único loop de retry.
        return await withDispatchTimeout(
          () =>
            this.pool.dispatch<ArrayBuffer>({
              run: () => this.dispatchSave(payload, ctx.abortSignal),
              signal: ctx.abortSignal,
              payload,
              maxRetriesOverride: 0,
            }),
          timeoutMs,
          () =>
            new ExportFailedError(
              documentId,
              `Timeout esperando el save() del worker (${timeoutMs}ms).`,
            ),
        );
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        lastError = normalizeExportError(err, documentId, timeoutMs);
      }
    }

    const failure = this.toExportFailure(documentId, undefined, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  /** `run()` del fallback in-process para `save`: invoca el ensamblador directo, reasigna el estado local (vacío tras éxito, ADR-047 §4) y devuelve el `ArrayBuffer` final. */
  private async dispatchSave(
    payload: ExportSavePayload,
    abortSignal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const { buffer, state } = await savePdf(this.assemblerState, payload, { abortSignal });
    this.assemblerState = state;
    return buffer;
  }

  private toExportFailure(
    documentId: string,
    pageIndex: number | undefined,
    err: unknown,
  ): ExportFailedError | ExportTimeoutError {
    if (err instanceof ExportTimeoutError || err instanceof ExportFailedError) return err;
    const reason = err instanceof Error ? err.message : String(err);
    return new ExportFailedError(documentId, reason, pageIndex !== undefined ? { pageIndex } : {});
  }

  private assertInitialized(): void {
    if (!this.initialized || this.ctx === null) {
      throw new EngineNotInitializedError(EngineId.Export);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineDisposedError(EngineId.Export);
    }
  }
}
