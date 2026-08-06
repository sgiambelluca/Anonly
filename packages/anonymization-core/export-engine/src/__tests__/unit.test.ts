import {
  DetectionSource,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  type EngineContext,
  type Replacement,
} from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";
import {
  ExportFailedError,
  ExportNoEnabledGroupsError,
  ExportTimeoutError,
} from "../export.errors.js";
import type { ExportEngineInput } from "../export.types.js";

import {
  asPdfDocument,
  createDocumentWithPageCount,
  createEngineContext,
  createEntityGroup,
  createExportEngineInput,
  createExportOptions,
  createMockPdfLibDocument,
  createMockRenderPageProvider,
  createShapeAwareExportPool,
} from "./fixtures/test-helpers.js";

describe("ExportEngine — unit", () => {
  let engine: ExportEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ExportEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  // ─── Validación de input (§9 restricciones) ───

  it("throws InvalidInputError when input is null", async () => {
    await engine.init(ctx);
    // Cast de frontera contra un caller no tipado (JS/deserializado), mismo
    // patrón que grouping-engine/src/__tests__/edge.test.ts ("throws
    // InvalidInputError when request is null"): un test de un contrato de
    // tipos propios que necesita bypassear el sistema de tipos para construir
    // el input inválido en runtime.
    await expect(engine.export(null as unknown as ExportEngineInput, ctx)).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("throws InvalidInputError when renderPageProvider is missing", async () => {
    await engine.init(ctx);
    const input = createExportEngineInput();
    const invalidInput = {
      ...input,
      renderPageProvider: undefined,
    } as unknown as ExportEngineInput;
    await expect(engine.export(invalidInput, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("throws InvalidInputError when dpi is 0", async () => {
    await engine.init(ctx);
    const input = createExportEngineInput({ options: createExportOptions({ dpi: 0 }) });
    await expect(engine.export(input, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("throws InvalidInputError when dpi exceeds 600", async () => {
    await engine.init(ctx);
    const input = createExportEngineInput({ options: createExportOptions({ dpi: 601 }) });
    await expect(engine.export(input, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("throws InvalidInputError when jpegQuality is below 0.5 for jpeg format", async () => {
    await engine.init(ctx);
    const input = createExportEngineInput({
      options: createExportOptions({ imageFormat: "jpeg", jpegQuality: 0.1 }),
    });
    await expect(engine.export(input, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("allows any jpegQuality when imageFormat is png", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const input = createExportEngineInput({
      options: createExportOptions({ imageFormat: "png", jpegQuality: 0.1 }),
      renderPageProvider: createMockRenderPageProvider({ format: "png" }),
    });
    await expect(engine.export(input, ctx)).resolves.toBeDefined();
  });

  // ─── Resolución de Replacement[] por página (grupos enabled, por página) ───

  it("only includes members of enabled groups for the requested page in replacements", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();

    const enabledGroupPage0 = createEntityGroup({
      id: "group-enabled-p0",
      enabled: true,
      members: [
        {
          occurrenceId: "occ-a",
          pageIndex: 0,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
          source: DetectionSource.Regex,
        },
      ],
    });
    const disabledGroupPage0 = createEntityGroup({
      id: "group-disabled-p0",
      enabled: false,
      members: [
        {
          occurrenceId: "occ-b",
          pageIndex: 0,
          bbox: { x: 5, y: 6, width: 7, height: 8 },
          source: DetectionSource.NER,
        },
      ],
    });
    const enabledGroupPage1 = createEntityGroup({
      id: "group-enabled-p1",
      enabled: true,
      members: [
        {
          occurrenceId: "occ-c",
          pageIndex: 1,
          bbox: { x: 9, y: 10, width: 11, height: 12 },
          source: DetectionSource.Regex,
        },
      ],
    });

    await engine.export(
      createExportEngineInput({
        document: createDocumentWithPageCount(2),
        groups: [enabledGroupPage0, disabledGroupPage0, enabledGroupPage1],
        renderPageProvider: provider,
      }),
      ctx,
    );

    const renderFullMock = provider.renderFull as unknown as ReturnType<typeof vi.fn>;
    const page0Call = renderFullMock.mock.calls.find((call) => call[0] === 0);
    const page1Call = renderFullMock.mock.calls.find((call) => call[0] === 1);
    const page0Replacements = page0Call?.[1] as ReadonlyArray<Replacement>;
    const page1Replacements = page1Call?.[1] as ReadonlyArray<Replacement>;

    expect(page0Replacements).toHaveLength(1);
    expect(page0Replacements[0]?.groupId).toBe("group-enabled-p0");
    expect(page0Replacements[0]?.originalValue).toBe(enabledGroupPage0.canonicalValue);
    expect(page1Replacements).toHaveLength(1);
    expect(page1Replacements[0]?.groupId).toBe("group-enabled-p1");
  });

  // ─── Selección de embedJpg/embedPng por formato ───

  it("uses embedPng when EncodedPageImage.format is png", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(
      createExportEngineInput({
        renderPageProvider: createMockRenderPageProvider({ format: "png" }),
      }),
      ctx,
    );

    expect(mockDoc["embedPng"]).toHaveBeenCalledTimes(1);
    expect(mockDoc["embedJpg"]).not.toHaveBeenCalled();
  });

  it("uses embedJpg when EncodedPageImage.format is jpeg", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(
      createExportEngineInput({
        renderPageProvider: createMockRenderPageProvider({ format: "jpeg" }),
      }),
      ctx,
    );

    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1);
    expect(mockDoc["embedPng"]).not.toHaveBeenCalled();
  });

  // ─── Reintentos (§11/§12: "Export reintenta el ensamblado solo si pdf-lib falla") ───

  it("retries embed once on pdf-lib failure, then succeeds without emitting EXPORT_FAILED", async () => {
    const mockDoc = createMockPdfLibDocument({ embedFailTimes: 1 });
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    const result = await engine.export(createExportEngineInput(), ctx);

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(2);
    expect(emitSpy).not.toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_FAILED,
      expect.anything(),
    );
  });

  it("throws ExportFailedError and emits EXPORT_FAILED after exhausting retries on embed failure", async () => {
    const mockDoc = createMockPdfLibDocument({ embedFailTimes: 5 });
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await expect(engine.export(createExportEngineInput(), ctx)).rejects.toThrow(ExportFailedError);

    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(2); // intento inicial + 1 retry (MAX_RETRIES=1)
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_FAILED,
      expect.objectContaining({
        error: expect.objectContaining({ code: EngineErrorCode.EXPORT_FAILED }),
      }),
    );
  });

  it("removes the stray page added before a drawImage failure, then retries cleanly", async () => {
    const mockDoc = createMockPdfLibDocument({ drawImageFailTimes: 1 });
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    const result = await engine.export(createExportEngineInput(), ctx);

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(mockDoc["removePage"]).toHaveBeenCalledTimes(1);
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(2); // el primero se revierte, el segundo queda.
    expect((mockDoc["pages"] as unknown[]).length).toBe(1);
  });

  it("retries save() once on pdf-lib failure, then succeeds", async () => {
    const mockDoc = createMockPdfLibDocument({ saveFailTimes: 1 });
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    const result = await engine.export(createExportEngineInput(), ctx);

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(mockDoc["save"]).toHaveBeenCalledTimes(2);
  });

  it("throws ExportFailedError after exhausting retries on save() failure", async () => {
    const mockDoc = createMockPdfLibDocument({ saveFailTimes: 5 });
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await expect(engine.export(createExportEngineInput(), ctx)).rejects.toThrow(ExportFailedError);
    expect(mockDoc["save"]).toHaveBeenCalledTimes(2);
  });

  // ─── ADR-047 §5 — normalización por code en el borde del puerto ───

  it("deserialized EXPORT_TIMEOUT is retried like the local one", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);

    // Un EXPORT_TIMEOUT que "cruzó el worker" llega deserializado: instancia
    // genérica con el code correcto, NO instanceof ExportTimeoutError
    // (Contracts.md §4, EngineError.deserialize).
    const localTimeout = new ExportTimeoutError("doc-deserialized-timeout", 0, 30_000);
    const deserialized = EngineError.deserialize(localTimeout.serialize());
    expect(deserialized).not.toBeInstanceOf(ExportTimeoutError);

    const pool = {
      dispatch: <T>(_params: {
        readonly run: () => Promise<T>;
        readonly signal: AbortSignal;
        readonly payload?: unknown;
        readonly maxRetriesOverride?: number;
      }): Promise<T> => Promise.reject(deserialized),
    };
    const pooledEngine = new ExportEngine(pool);
    await pooledEngine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    // Ambos intentos (inicial + 1 retry, MAX_RETRIES=1) fallan con el mismo
    // deserializado: sin la normalización por code, `toExportFailure` lo
    // envolvería como ExportFailedError genérico, perdiendo el code
    // EXPORT_TIMEOUT (ADR-047 §5).
    await expect(
      pooledEngine.export(createExportEngineInput({ documentId: "doc-deserialized-timeout" }), ctx),
    ).rejects.toThrow(ExportTimeoutError);

    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_FAILED,
      expect.objectContaining({
        error: expect.objectContaining({ code: EngineErrorCode.EXPORT_TIMEOUT }),
      }),
    );

    await pooledEngine.dispose();
  });

  it("throws ExportTimeoutError when renderFull exceeds the export-page timeout", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    const shortTimeoutCtx = createEngineContext({
      config: {
        ...ctx.config,
        workerPool: {
          ...ctx.config.workerPool,
          timeouts: { ...ctx.config.workerPool.timeouts, "export-page": 20 },
        },
      },
    });
    await engine.init(shortTimeoutCtx);

    const input = createExportEngineInput({
      renderPageProvider: createMockRenderPageProvider({ neverResolves: true }),
    });
    await expect(engine.export(input, shortTimeoutCtx)).rejects.toThrow(ExportTimeoutError);
  }, 10_000);

  // ─── No-recuperabilidad a nivel de implementación (§13 casos 8-10) ───
  // El artefacto real se valida en tests/security/security.test.ts con pdf-lib real;
  // acá se valida que la implementación nunca invoca las APIs que introducirían
  // bookmarks/JS/forms/contenido copiado del original.

  it("export has no bookmarks (never copies pages/embeds another PDFDocument)", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(createExportEngineInput(), ctx);

    expect(mockDoc["copyPages"]).not.toHaveBeenCalled();
    expect(mockDoc["embedPdf"]).not.toHaveBeenCalled();
  });

  it("export has no JavaScript", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(createExportEngineInput(), ctx);

    expect(mockDoc["addJavaScript"]).not.toHaveBeenCalled();
  });

  it("export has no AcroForm", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(createExportEngineInput(), ctx);

    expect(mockDoc["getForm"]).not.toHaveBeenCalled();
  });

  // ─── Tamaño: DPI y formato (§13 casos 5-6, spec §14) ───
  // Export no recodifica imágenes (dominio del RenderPageProvider); estos tests
  // validan que el tamaño final escala con los bytes que el provider entrega,
  // que es exactamente lo que Export controla (ver comentario en test-helpers.ts).

  it("DPI 300 produces larger file than DPI 150", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const highDpiResult = await engine.export(
      createExportEngineInput({
        options: createExportOptions({ dpi: 300 }),
        renderPageProvider: createMockRenderPageProvider({ bytes: new Uint8Array(8000).buffer }),
      }),
      ctx,
    );

    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(createMockPdfLibDocument()));
    const lowDpiResult = await engine.export(
      createExportEngineInput({
        options: createExportOptions({ dpi: 150 }),
        renderPageProvider: createMockRenderPageProvider({ bytes: new Uint8Array(800).buffer }),
      }),
      ctx,
    );

    expect(highDpiResult.sizeBytes).toBeGreaterThan(lowDpiResult.sizeBytes);
  });

  it("PNG produces larger file than JPEG q 0.85", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const pngResult = await engine.export(
      createExportEngineInput({
        options: createExportOptions({ imageFormat: "png" }),
        renderPageProvider: createMockRenderPageProvider({
          format: "png",
          bytes: new Uint8Array(6000).buffer,
        }),
      }),
      ctx,
    );

    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(createMockPdfLibDocument()));
    const jpegResult = await engine.export(
      createExportEngineInput({
        options: createExportOptions({ imageFormat: "jpeg", jpegQuality: 0.85 }),
        renderPageProvider: createMockRenderPageProvider({
          format: "jpeg",
          bytes: new Uint8Array(1500).buffer,
        }),
      }),
      ctx,
    );

    expect(pngResult.sizeBytes).toBeGreaterThan(jpegResult.sizeBytes);
  });

  // ─── ADR-055 §5 — tests de sobre, obligatorios ───
  //
  // A diferencia de `createTrackingExportPool` (usada arriba en
  // contract.test.ts, que delega en `params.run()` — el camino in-process)
  // `createShapeAwareExportPool` IGNORA `run()` y resuelve directo con el
  // valor dado por operación — es el único fake de este paquete que cruza de
  // verdad el sobre `COMPLETED.result` (ADR-055 Contexto §2). Sin él, ningún
  // test ejercita `decodeSaveResult` de verdad ni demuestra por qué
  // `append-page` no necesita uno (ver la nota "ADR-055" de cabecera de
  // `export.engine.ts`).
  describe("Sobre del dispatch (ADR-055)", () => {
    it("append-page: export() completa igual con result: null (forma que postea worker/entry.ts, ADR-055 §2)", async () => {
      // worker/entry.ts:100 postea `result: null` para append-page ("Sin
      // datos que devolver: el host solo necesita la confirmación de
      // COMPLETED"). El call site de `exportPage` nunca liga ese valor (nota
      // de cabecera de export.engine.ts) — este test demuestra que export()
      // completa exactamente igual con esa forma remota.
      const remoteSaveBuffer = new TextEncoder().encode("%PDF-remote-append").buffer;
      const pool = createShapeAwareExportPool({
        appendResolvedValue: null,
        saveResolvedValue: remoteSaveBuffer,
      });
      const pooledEngine = new ExportEngine(pool);
      await pooledEngine.init(ctx);

      const result = await pooledEngine.export(
        createExportEngineInput({ documentId: "doc-append-envelope" }),
        ctx,
      );

      expect(new Uint8Array(result.buffer)).toEqual(new Uint8Array(remoteSaveBuffer));

      await pooledEngine.dispose();
    });

    it("append-page: export() completa igual con result: undefined (forma in-process, parity — nota la asimetría null/undefined, ADR-055 §2)", async () => {
      // `dispatchAppendPage` (fallback in-process) devuelve `Promise<void>`:
      // el valor resuelto real es `undefined`, una forma DISTINTA de la que
      // postea el worker remoto (`null` — ver test de arriba). A diferencia
      // de las operaciones CON decoder (donde esta clase de asimetría
      // obligaría a que el decoder acepte ambas formas), acá no importa:
      // ninguna de las dos se lee jamás, así que ninguna puede producir un
      // resultado distinto observable.
      const inProcessSaveBuffer = new TextEncoder().encode("%PDF-inprocess-append").buffer;
      const pool = createShapeAwareExportPool({
        appendResolvedValue: undefined,
        saveResolvedValue: inProcessSaveBuffer,
      });
      const pooledEngine = new ExportEngine(pool);
      await pooledEngine.init(ctx);

      const result = await pooledEngine.export(
        createExportEngineInput({ documentId: "doc-append-parity" }),
        ctx,
      );

      expect(new Uint8Array(result.buffer)).toEqual(new Uint8Array(inProcessSaveBuffer));

      await pooledEngine.dispose();
    });

    it("save: decodes the bare COMPLETED.result posted by worker/entry.ts (ArrayBuffer pelado, ADR-055 §2)", async () => {
      // worker/entry.ts:111 postea `result: buffer` sin envolver — el mismo
      // ArrayBuffer que produce savePdf(). decodeSaveResult acepta esa forma
      // y export() devuelve exactamente ese buffer como resultado final.
      const remoteBuffer = new TextEncoder().encode("%PDF-remote-save").buffer;
      const pool = createShapeAwareExportPool({ saveResolvedValue: remoteBuffer });
      const pooledEngine = new ExportEngine(pool);
      await pooledEngine.init(ctx);

      const result = await pooledEngine.export(
        createExportEngineInput({ documentId: "doc-save-envelope" }),
        ctx,
      );

      expect(new Uint8Array(result.buffer)).toEqual(new Uint8Array(remoteBuffer));
      expect(result.sizeBytes).toBe(remoteBuffer.byteLength);

      await pooledEngine.dispose();
    });

    it("save: decodes the identical in-process shape (parity: save has no envelope, ADR-055 §2)", async () => {
      // A diferencia de NER (`{ spans }` remoto vs. array pelado in-process),
      // `dispatchSave` (fallback in-process) resuelve el mismo ArrayBuffer
      // pelado que produce savePdf() — la MISMA forma que worker/entry.ts
      // postea en el camino remoto (ver test de arriba). Este test usa el
      // mismo fake con un buffer distinto para demostrar explícitamente esa
      // paridad: decodeSaveResult no necesita (ni tiene) una rama especial
      // para un segundo caso.
      const inProcessBuffer = new TextEncoder().encode("%PDF-inprocess-save").buffer;
      const pool = createShapeAwareExportPool({ saveResolvedValue: inProcessBuffer });
      const pooledEngine = new ExportEngine(pool);
      await pooledEngine.init(ctx);

      const result = await pooledEngine.export(
        createExportEngineInput({ documentId: "doc-save-parity" }),
        ctx,
      );

      expect(new Uint8Array(result.buffer)).toEqual(new Uint8Array(inProcessBuffer));

      await pooledEngine.dispose();
    });
  });
});

describe("ExportNoEnabledGroupsError", () => {
  // export() nunca la lanza (ADR-032 §3): es el tipo de la validación
  // pre-export del Orchestrator (Hito 9/10). Se prueba su forma acá porque
  // es parte del contrato público del motor (checklist §15.3, §11).
  it("has code EXPORT_NO_ENABLED_GROUPS, engineId export and retryable false", () => {
    const error = new ExportNoEnabledGroupsError("doc-1");
    expect(error.code).toBe(EngineErrorCode.EXPORT_NO_ENABLED_GROUPS);
    expect(error.retryable).toBe(false);
    expect(error.serialize()).toEqual(
      expect.objectContaining({
        code: EngineErrorCode.EXPORT_NO_ENABLED_GROUPS,
        retryable: false,
        details: expect.objectContaining({ documentId: "doc-1" }),
      }),
    );
  });
});
