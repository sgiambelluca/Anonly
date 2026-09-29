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
  decodePng,
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

  // ADR-190 §5, Export_Engine.md §13 caso 26.
  it("covered pages are exported fully black with the same size and no page render", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();
    const document = createDocumentWithPageCount(2, { width: 200, height: 300 });

    await engine.export(
      createExportEngineInput({
        document,
        options: createExportOptions({ coveredPages: [0] }),
        renderPageProvider: provider,
      }),
      ctx,
    );

    // Página 0 (tapada): nunca se pide su render.
    expect(provider.renderFull).not.toHaveBeenCalledWith(0, expect.anything(), expect.anything());
    // Página 1, sin tapar, sigue pidiendo su render como siempre.
    expect(provider.renderFull).toHaveBeenCalledWith(1, expect.anything(), expect.anything());

    // Las dos páginas se agregan con las MISMAS dimensiones del documento —
    // la tapada no cambia de tamaño por ser sintética.
    const pages = mockDoc["pages"] as ReadonlyArray<{
      readonly width: number;
      readonly height: number;
      readonly drawImage: ReturnType<typeof vi.fn>;
    }>;
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ width: 200, height: 300 });
    expect(pages[1]).toMatchObject({ width: 200, height: 300 });
    // `drawImage` estira la imagen embebida al tamaño completo de la
    // página — "rectángulo negro lleno con las mismas dimensiones".
    expect(pages[0]!.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ x: 0, y: 0, width: 200, height: 300 }),
    );

    // La imagen embebida para la página 0 es la sintética (PNG), no la que
    // devolvería el render provider (jpeg, 4 bytes por default). Se decodifica
    // el PNG de verdad: que pese 69 bytes no prueba que sea negro.
    const embedPngCalls = (mockDoc["embedPng"] as ReturnType<typeof vi.fn>).mock.calls;
    expect(embedPngCalls).toHaveLength(1);
    const [coveredBytes] = embedPngCalls[0] as [ArrayBuffer];
    const png = decodePng(coveredBytes);
    // Un píxel RGB opaco (sin canal alfa que lo vuelva translúcido), negro puro.
    expect(png).toMatchObject({ width: 1, height: 1, bitDepth: 8, colorType: 2, channels: 3 });
    expect(Array.from(png.pixels)).toEqual([0, 0, 0]);
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1); // la página 1, sin tapar
  });

  // ADR-190 §5 / Export_Engine.md §9: "los duplicados se ignoran".
  it("duplicate coveredPages entries are ignored", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();

    await engine.export(
      createExportEngineInput({
        document: createDocumentWithPageCount(2, { width: 200, height: 300 }),
        options: createExportOptions({ coveredPages: [0, 0, 0] }),
        renderPageProvider: provider,
      }),
      ctx,
    );

    // Una sola página tapada, no tres: dos páginas en total, un solo PNG negro.
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(2);
    expect(provider.renderFull).toHaveBeenCalledTimes(1);
    expect(provider.renderFull).toHaveBeenCalledWith(1, expect.anything(), expect.anything());
    const embedPngCalls = (mockDoc["embedPng"] as ReturnType<typeof vi.fn>).mock.calls;
    expect(embedPngCalls).toHaveLength(1);
    expect(Array.from(decodePng((embedPngCalls[0] as [ArrayBuffer])[0]).pixels)).toEqual([0, 0, 0]);
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1);
  });

  // ADR-190 §5 / Export_Engine.md §13 caso 26: "con `coveredPages` ausente o
  // vacío, el export es bit a bit el mismo que antes".
  it("empty coveredPages leaves the export identical to an absent one", async () => {
    async function exportWith(coveredPages: ReadonlyArray<number> | undefined): Promise<{
      readonly buffer: ArrayBuffer;
      readonly calls: Record<string, unknown>;
    }> {
      const localEngine = new ExportEngine();
      const localDoc = createMockPdfLibDocument();
      vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(localDoc));
      await localEngine.init(ctx);
      const provider = createMockRenderPageProvider();
      try {
        const output = await localEngine.export(
          createExportEngineInput({
            document: createDocumentWithPageCount(3, { width: 200, height: 300 }),
            options: createExportOptions(coveredPages === undefined ? {} : { coveredPages }),
            renderPageProvider: provider,
          }),
          ctx,
        );
        const pages = localDoc["pages"] as ReadonlyArray<{
          readonly width: number;
          readonly height: number;
          readonly drawImage: ReturnType<typeof vi.fn>;
        }>;
        return {
          buffer: output.buffer,
          calls: {
            renderFull: provider.renderFull.mock.calls.map(([index]) => index),
            addPage: (localDoc["addPage"] as ReturnType<typeof vi.fn>).mock.calls,
            embedJpg: (localDoc["embedJpg"] as ReturnType<typeof vi.fn>).mock.calls,
            embedPng: (localDoc["embedPng"] as ReturnType<typeof vi.fn>).mock.calls,
            drawImage: pages.map((page) => page.drawImage.mock.calls),
          },
        };
      } finally {
        await localEngine.dispose();
      }
    }

    const absent = await exportWith(undefined);
    const empty = await exportWith([]);

    expect(empty.calls).toEqual(absent.calls);
    expect(new Uint8Array(empty.buffer)).toEqual(new Uint8Array(absent.buffer));
    // Sanidad: las tres páginas se renderizaron (ninguna quedó tapada).
    expect(empty.calls["renderFull"]).toEqual([0, 1, 2]);
    expect(empty.calls["embedPng"]).toEqual([]);
  });

  it("absent coveredPages leaves the export unchanged", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);
    const provider = createMockRenderPageProvider();
    const document = createDocumentWithPageCount(2);

    await engine.export(createExportEngineInput({ document, renderPageProvider: provider }), ctx);

    // Sin coveredPages: las dos páginas piden su render, como siempre.
    expect(provider.renderFull).toHaveBeenCalledTimes(2);
    expect(provider.renderFull).toHaveBeenCalledWith(0, expect.anything(), expect.anything());
    expect(provider.renderFull).toHaveBeenCalledWith(1, expect.anything(), expect.anything());
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(2);
  });
});
