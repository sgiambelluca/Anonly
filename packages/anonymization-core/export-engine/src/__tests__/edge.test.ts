import {
  EngineDisposedError,
  EngineErrorCode,
  InvalidInputError,
  type EngineContext,
} from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";

import {
  asPdfDocument,
  createDocument,
  createEngineContext,
  createEntityGroup,
  createExportEngineInput,
  createExportOptions,
  createMockPdfLibDocument,
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
});
