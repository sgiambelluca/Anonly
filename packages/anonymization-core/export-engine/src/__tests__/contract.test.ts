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
  createEntityGroup,
  createExportEngineInput,
  createExportOptions,
  createMockPdfLibDocument,
  createMockRenderPageProvider,
  createTrackingExportPool,
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

  // ─── ADR-047 §2/§5/§6 — puerto interno ExportJobPool ───

  it("every dispatch uses maxRetriesOverride: 0", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    const pool = createTrackingExportPool();
    const pooledEngine = new ExportEngine(pool);
    await pooledEngine.init(ctx);

    await pooledEngine.export(
      createExportEngineInput({
        documentId: "doc-max-retries-override",
        document: createDocumentWithPageCount(2),
      }),
      ctx,
    );

    // 2 páginas (append-page) + 1 save = 3 despachos.
    expect(pool.calls.length).toBe(3);
    for (const call of pool.calls) {
      expect(call.maxRetriesOverride).toBe(0);
    }

    await pooledEngine.dispose();
  });

  it("same events, order and output bytes with and without injected pool", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    await engine.init(ctx);
    const emitSpyA = vi.spyOn(ctx.bus, "emit");
    const resultA = await engine.export(createExportEngineInput({ documentId: "doc-parity" }), ctx);
    const eventsA = emitSpyA.mock.calls.map((call) => call[1]);

    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    const pool = createTrackingExportPool();
    const pooledEngine = new ExportEngine(pool);
    const ctxB = createEngineContext();
    await pooledEngine.init(ctxB);
    const emitSpyB = vi.spyOn(ctxB.bus, "emit");
    const resultB = await pooledEngine.export(
      createExportEngineInput({ documentId: "doc-parity" }),
      ctxB,
    );
    const eventsB = emitSpyB.mock.calls.map((call) => call[1]);

    expect(eventsB).toEqual(eventsA);
    expect(resultB.sizeBytes).toBe(resultA.sizeBytes);
    expect(new Uint8Array(resultB.buffer)).toEqual(new Uint8Array(resultA.buffer));

    await pooledEngine.dispose();
  });

  it("blob URL is created in host, never in the worker", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    const pool = createTrackingExportPool();
    const pooledEngine = new ExportEngine(pool);
    await pooledEngine.init(ctx);
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");

    const result = await pooledEngine.export(
      createExportEngineInput({ documentId: "doc-bloburl" }),
      ctx,
    );

    // Un único createObjectURL, en host: ninguno de los closures despachados
    // al pool (ver ExportPoolDispatchParams.run en el fixture) toca
    // createObjectURL — solo invocan el ensamblador (ADR-047 §6).
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(result.buffer.byteLength).toBeGreaterThan(0);

    await pooledEngine.dispose();
  });

  // ─── ADR-059 (Hito 10.5, PR 8) — leyenda de marcadores ───

  it("includeMarkerLegend: false yields exactly pageCount pages and never calls renderLegend", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();

    await engine.export(
      createExportEngineInput({
        document: createDocumentWithPageCount(3),
        options: createExportOptions({ includeMarkerLegend: false }),
        renderPageProvider: provider,
      }),
      ctx,
    );

    // No-regresión de todos los exports existentes (default apagado, ADR-059 §1).
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(3);
    expect(provider.renderLegend).not.toHaveBeenCalled();
  });

  it("includeMarkerLegend: true yields pageCount + 1 pages", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();

    await engine.export(
      createExportEngineInput({
        document: createDocumentWithPageCount(3),
        groups: [createEntityGroup()], // DNI, placeholder, enabled -> produce una fila de leyenda.
        options: createExportOptions({ includeMarkerLegend: true }),
        renderPageProvider: provider,
      }),
      ctx,
    );

    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(4);
    expect(provider.renderLegend).toHaveBeenCalledTimes(1);
  });
});
