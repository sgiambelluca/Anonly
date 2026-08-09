import {
  DetectionSource,
  EngineDisposedError,
  EngineErrorCode,
  EngineEvents,
  EntityType,
  EventChannel,
  InvalidInputError,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";
import { ExportFailedError } from "../export.errors.js";

import {
  asPdfDocument,
  createDocument,
  createDocumentWithPageCount,
  createEngineContext,
  createEntityGroup,
  createExportEngineInput,
  createExportOptions,
  createMockPdfLibDocument,
  createMockRenderPageProvider,
  createResolvedExportPool,
} from "./fixtures/test-helpers.js";

describe("ExportEngine — edge cases", () => {
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

  it("throws EngineDisposedError after dispose", async () => {
    await engine.init(ctx);
    await engine.dispose();
    await expect(engine.export(createExportEngineInput(), ctx)).rejects.toThrow(
      EngineDisposedError,
    );
  });

  it("throws InvalidInputError on 0 pages", async () => {
    await engine.init(ctx);
    const input = createExportEngineInput({
      document: createDocument({ pageCount: 0, pages: [] }),
    });
    await expect(engine.export(input, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("0 enabled groups logs EXPORT_NO_ENABLED_GROUPS warning and continues", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    const input = createExportEngineInput({
      groups: [
        createEntityGroup({ enabled: false }),
        createEntityGroup({ id: "group-2", enabled: false }),
      ],
    });

    const result = await engine.export(input, ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("grupo habilitado"),
      expect.objectContaining({ code: EngineErrorCode.EXPORT_NO_ENABLED_GROUPS }),
    );
    // caso 2: el export continua y produce un PDF igual que el resto (no aborta).
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it("0 groups total (array vacio) also logs EXPORT_NO_ENABLED_GROUPS and continues", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    const result = await engine.export(createExportEngineInput({ groups: [] }), ctx);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("grupo habilitado"),
      expect.objectContaining({ code: EngineErrorCode.EXPORT_NO_ENABLED_GROUPS }),
    );
    expect(result.buffer.byteLength).toBeGreaterThan(0);
  });

  it("filename sanitized for PDF injection", async () => {
    // ExportOptions.filename no tiene ningun punto de insercion en el PDF
    // resultante (spec S10, Contracts.md S8 - ni ExportEngineOutput ni
    // ExportFinished exponen un campo de nombre de archivo). Por
    // construccion, ningun valor de filename puede afectar la estructura del
    // PDF: este test prueba exactamente esa propiedad de seguridad (caso 16)
    // con un filename que intenta inyectar sintaxis PDF.
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    const maliciousFilename =
      ") /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> (";
    const result = await engine.export(
      createExportEngineInput({
        options: createExportOptions({ filename: maliciousFilename }),
      }),
      ctx,
    );

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(mockDoc["setTitle"]).not.toHaveBeenCalled();
    expect(mockDoc["addJavaScript"]).not.toHaveBeenCalled();
  });

  it("title with control characters and excessive length is sanitized before setTitle", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    const filler = "y".repeat(600);
    const longTitleWithControlChars = "Documento Confidencial\r\n" + filler;
    await engine.export(
      createExportEngineInput({
        options: createExportOptions({ title: longTitleWithControlChars }),
      }),
      ctx,
    );

    const setTitleMock = mockDoc["setTitle"] as ReturnType<typeof vi.fn>;
    expect(setTitleMock).toHaveBeenCalledTimes(1);
    const sanitizedTitle = setTitleMock.mock.calls[0]?.[0] as string;
    expect(sanitizedTitle).not.toContain("\r");
    expect(sanitizedTitle).not.toContain("\n");
    expect(sanitizedTitle.startsWith("Documento Confidencial")).toBe(true);
    expect(sanitizedTitle.length).toBeLessThanOrEqual(500);
  });

  // Sobre del dispatch, obligatorio (ADR-055 §5): un `ExportJobPool.dispatch()`
  // que resuelve `save` con una forma no reconocida (ni el ArrayBuffer pelado
  // remoto ni el in-process — en este motor son la misma forma, así que
  // cualquier otra cosa es simplemente inválida) tiene que lanzar
  // `ExportFailedError` en vez de dejar que `export()` reviente con un
  // `TypeError` nativo al tratar la basura como `ArrayBuffer` (`new
  // Blob([buffer], ...)`/`buffer.byteLength`, fuera del try/catch de
  // `saveWithRetry` — Code_Standards.md §7: "Prohibido lanzar... Error
  // genérico"; sin el decoder ESE habría sido el modo de falla real). Cada
  // valor de `garbageValues` se usa como resultado de TODOS los dispatch
  // (`createResolvedExportPool`, no `createShapeAwareExportPool`) a
  // propósito: demuestra que `append-page` tolera la misma basura sin
  // problema (no la consume — ver la nota "ADR-055" de cabecera de
  // `export.engine.ts`) mientras `save` no.
  describe("Sobre del dispatch: forma no reconocida (ADR-055 §5)", () => {
    it("save() throws ExportFailedError and emits EXPORT_FAILED for any unrecognized shape (never a silent default)", async () => {
      const garbageValues: ReadonlyArray<unknown> = [
        {},
        null,
        "not-a-recognized-shape",
        // TypedArray, no ArrayBuffer -- el error real que `savePdf()` evita
        // copiando explícitamente a un ArrayBuffer plano antes de resolver.
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      ];

      for (const garbage of garbageValues) {
        const pool = createResolvedExportPool(garbage);
        const pooledEngine = new ExportEngine(pool);
        await pooledEngine.init(ctx);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");

        const rejection: unknown = await pooledEngine
          .export(createExportEngineInput({ documentId: "doc-save-garbage" }), ctx)
          .catch((err: unknown) => err);

        expect(rejection).toBeInstanceOf(ExportFailedError);
        // Prueba de regresión real (Validación del ADR-055: "revirtiendo el
        // decoder, ese test tiene que fallar"): el mensaje tiene que venir
        // específicamente de `decodeSaveResult`, no de un TypeError
        // accidental al construir el Blob final / leer `.byteLength` de un
        // valor que no es un ArrayBuffer real.
        expect((rejection as ExportFailedError).message).toContain(
          "ExportJobPool.dispatch() resolvió save con una forma no reconocida",
        );

        const failedCall = busEmitSpy.mock.calls.find(
          ([, event]) => event === EngineEvents.EXPORT_FAILED,
        );
        expect(failedCall).toBeDefined();
        // EXPORT_FINISHED nunca se emite para un save que no se pudo
        // decodificar — la falla no se disfraza de export exitoso.
        expect(
          busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.EXPORT_FINISHED),
        ).toBe(false);

        await pooledEngine.dispose();
      }
    });
  });

  // ─── ADR-059 (Hito 10.5, PR 8) — leyenda de marcadores ───

  describe("Leyenda de marcadores (ADR-059)", () => {
    it("legend active with no placeholder groups adds no page, does not call renderLegend, and warns", async () => {
      const mockDoc = createMockPdfLibDocument();
      vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
      await engine.init(ctx);
      const provider = createMockRenderPageProvider();
      const warnSpy = vi.spyOn(ctx.logger, "warn");

      await engine.export(
        createExportEngineInput({
          document: createDocumentWithPageCount(2),
          groups: [createEntityGroup({ replacementMode: ReplacementMode.Mask })],
          options: createExportOptions({ includeMarkerLegend: true }),
          renderPageProvider: provider,
        }),
        ctx,
      );

      expect(provider.renderLegend).not.toHaveBeenCalled();
      // Nunca una página en blanco: exactamente pageCount, sin la extra.
      expect(mockDoc["addPage"]).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("leyenda"),
        expect.objectContaining({ documentId: expect.any(String) }),
      );
    });

    it("all 13 entity types still fit in a single legend page", async () => {
      const mockDoc = createMockPdfLibDocument();
      vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
      await engine.init(ctx);
      const provider = createMockRenderPageProvider();

      const allTypes = Object.values(EntityType);
      const groups = allTypes.map((type, index) =>
        createEntityGroup({
          id: `group-${type}`,
          type,
          replacementValue: `[${type} 01]`,
          members: [
            {
              occurrenceId: `occ-${type}`,
              pageIndex: 0,
              bbox: { x: 0, y: index * 10, width: 10, height: 10 },
              source: DetectionSource.Regex,
            },
          ],
        }),
      );

      await engine.export(
        createExportEngineInput({
          groups,
          options: createExportOptions({ includeMarkerLegend: true }),
          renderPageProvider: provider,
        }),
        ctx,
      );

      expect(provider.renderLegend).toHaveBeenCalledTimes(1);
      const [rows] = provider.renderLegend.mock.calls[0] as [ReadonlyArray<unknown>, AbortSignal];
      expect(rows).toHaveLength(13);
      // Caso 24: la leyenda es SIEMPRE una sola página, sin importar cuántos
      // tipos distintos aparezcan -- 1 página del documento + 1 de leyenda.
      expect(mockDoc["addPage"]).toHaveBeenCalledTimes(2);
    });

    it("renderLegend failure retries and then fails the export; never a half-assembled PDF", async () => {
      const mockDoc = createMockPdfLibDocument();
      vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
      await engine.init(ctx);
      const provider = createMockRenderPageProvider({
        legendError: new Error("renderLegend explotó"),
      });
      const emitSpy = vi.spyOn(ctx.bus, "emit");

      await expect(
        engine.export(
          createExportEngineInput({
            groups: [createEntityGroup()],
            options: createExportOptions({ includeMarkerLegend: true }),
            renderPageProvider: provider,
          }),
          ctx,
        ),
      ).rejects.toThrow(ExportFailedError);

      // Intento inicial + 1 retry (MAX_RETRIES=1) -- mismo patrón que exportPage.
      expect(provider.renderLegend).toHaveBeenCalledTimes(2);
      // Nunca llega a save(): el PDF nunca queda a medio ensamblar ni se
      // emite EXPORT_FINISHED sobre un documento incompleto (caso 25).
      expect(mockDoc["save"]).not.toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(
        EventChannel.Export,
        EngineEvents.EXPORT_FAILED,
        expect.anything(),
      );
      expect(emitSpy.mock.calls.some(([, event]) => event === EngineEvents.EXPORT_FINISHED)).toBe(
        false,
      );
    });
  });
});
