/**
 * @anonly/export-engine — `ExportEngine` (implementa `IEngine`).
 *
 * Fuente de verdad: docs/core/Export_Engine.md (v1.1.0, ADR-032).
 *
 * ADR-021 (motores inline hasta Hito 9): sin pool propio, sin Worker propio
 * de ensamblado. Corre en el host (main thread) con `pdf-lib`. La
 * cancelación es cooperativa vía `ctx.abortSignal`, con checkpoints entre
 * páginas; el SLA estricto < 200ms se valida en Hito 9/11.
 *
 * ADR-032 (auditoría pre-Hito 8): `RenderPageProvider.renderFull` devuelve
 * `EncodedPageImage` (bytes ya codificados PNG/JPEG, listos para
 * `embedJpg`/`embedPng`); el motor no se suscribe a ningún evento
 * (`EXPORT_REQUESTED` lo escucha el Orchestrator, que arma `ExportEngineInput`
 * y llama `export()` directamente — en Hito 8 el caller directo son los
 * tests); con 0 grupos `enabled`, `export()` **no lanza**: loguea
 * `ctx.logger.warn` con el code `EXPORT_NO_ENABLED_GROUPS` en metadata y
 * continúa (el export resultante es idéntico al original reconstruido).
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
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type EntityGroup,
  type IEngine,
  type Replacement,
} from "@anonly/shared";
import { PDFDocument, type PDFImage } from "pdf-lib";

import { ExportFailedError, ExportTimeoutError } from "./export.errors.js";
import type {
  EncodedPageImage,
  ExportEngineInput,
  ExportEngineOutput,
  RenderPageProvider,
} from "./export.types.js";

const DEFAULT_TIMEOUT_MS = 30_000; // spec §11/§12: "default 30 s por página".
const MAX_RETRIES = 1; // spec §11: "reintentar 1 vez".
const MAX_TITLE_LENGTH = 500; // spec §13 caso 16: "título muy largo".

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

  private ctx: EngineContext | null = null;
  private initialized = false;
  private disposed = false;

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

    const pdfDoc = await PDFDocument.create();
    const totalPages = input.document.pageCount;
    const timeoutMs = ctx.config.workerPool.timeouts["export-page"] ?? DEFAULT_TIMEOUT_MS;

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(input.documentId);
      }

      await this.exportPage(input, ctx, pdfDoc, pageIndex, timeoutMs);

      ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, {
        documentId: input.documentId,
        current: pageIndex + 1,
        total: totalPages,
      });
    }

    pdfDoc.setProducer("Anonly");
    pdfDoc.setCreator("Anonly");
    pdfDoc.setCreationDate(new Date());
    if (input.options.title !== undefined) {
      pdfDoc.setTitle(sanitizeMetadataString(input.options.title));
    }

    const bytes = await this.saveWithRetry(input.documentId, ctx, pdfDoc);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    const durationMs = Date.now() - startedAt;
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
    // Sin estado persistente entre llamadas a export() (cada una arma su
    // propio PDFDocument local); sin pool/worker propio en Hito 8 (ADR-021).
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
    pdfDoc: PDFDocument,
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
      const pageCountBeforeAttempt = pdfDoc.getPageCount();
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

        // §"Flujo de export": embedJpg/embedPng de bytes ya codificados
        // (ADR-032 §1). Nunca copyPages del original (checklist §15.10).
        const embeddedImage: PDFImage =
          pageImage.format === "jpeg"
            ? await pdfDoc.embedJpg(pageImage.bytes)
            : await pdfDoc.embedPng(pageImage.bytes);

        const pdfPage = pdfDoc.addPage([page.width, page.height]);
        pdfPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
        });

        return;
      } catch (err: unknown) {
        if (err instanceof CancelledError) throw err;
        while (pdfDoc.getPageCount() > pageCountBeforeAttempt) {
          pdfDoc.removePage(pdfDoc.getPageCount() - 1);
        }
        lastError = err;
      }
    }

    const failure = this.toExportFailure(input.documentId, pageIndex, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId: input.documentId,
      error: failure.serialize(),
    });
    throw failure;
  }

  private async saveWithRetry(
    documentId: string,
    ctx: EngineContext,
    pdfDoc: PDFDocument,
  ): Promise<Uint8Array> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (ctx.abortSignal.aborted) {
        throw new CancelledError(documentId);
      }
      try {
        // §12: "Tamaño del PDF... mitigado con save({ useObjectStreams: true })".
        return await pdfDoc.save({ useObjectStreams: true });
      } catch (err: unknown) {
        lastError = err;
      }
    }

    const failure = this.toExportFailure(documentId, undefined, lastError);
    ctx.bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, {
      documentId,
      error: failure.serialize(),
    });
    throw failure;
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
