import {
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  type EngineContext,
} from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";

import {
  asPdfDocument,
  createDocumentWithPageCount,
  createEngineContext,
  createExportEngineInput,
  createMockPdfLibDocument,
} from "./fixtures/test-helpers.js";

describe("ExportEngine — contract tests", () => {
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

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Export);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("export() before init() throws EngineNotInitializedError", async () => {
    const input = createExportEngineInput();
    await expect(engine.export(input, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("dispose() can be called multiple times safely", async () => {
    await engine.init(ctx);
    await engine.dispose();
    await engine.dispose();
    expect(engine["disposed"]).toBe(true);
    expect(engine["initialized"]).toBe(false);
  });

  it("emits EXPORT_STARTED at beginning", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.export(createExportEngineInput({ documentId: "doc-started" }), ctx);

    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_STARTED,
      expect.objectContaining({ documentId: "doc-started" }),
    );
  });

  it("emits EXPORT_PROGRESS per page", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.export(
      createExportEngineInput({
        documentId: "doc-progress",
        document: createDocumentWithPageCount(3),
      }),
      ctx,
    );

    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_PROGRESS,
      expect.objectContaining({ documentId: "doc-progress", current: 1, total: 3 }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_PROGRESS,
      expect.objectContaining({ documentId: "doc-progress", current: 2, total: 3 }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_PROGRESS,
      expect.objectContaining({ documentId: "doc-progress", current: 3, total: 3 }),
    );
  });

  it("emits EXPORT_FINISHED with non-empty buffer", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    const result = await engine.export(
      createExportEngineInput({ documentId: "doc-finished" }),
      ctx,
    );

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Export,
      EngineEvents.EXPORT_FINISHED,
      expect.objectContaining({
        documentId: "doc-finished",
        blobUrl: expect.any(String),
        sizeBytes: expect.any(Number),
        durationMs: expect.any(Number),
      }),
    );
  });

  it("output buffer is a valid PDF (%PDF- header)", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);

    const result = await engine.export(createExportEngineInput(), ctx);

    const header = new Uint8Array(result.buffer.slice(0, 5));
    const headerText = String.fromCharCode(...header);
    expect(headerText).toBe("%PDF-");
  });

  it("export metadata has producer = Anonly", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    await engine.export(createExportEngineInput(), ctx);

    expect(mockDoc["setProducer"]).toHaveBeenCalledWith("Anonly");
    expect(mockDoc["setCreator"]).toHaveBeenCalledWith("Anonly");
    expect(mockDoc["setCreationDate"]).toHaveBeenCalledWith(expect.any(Date));
  });
});
