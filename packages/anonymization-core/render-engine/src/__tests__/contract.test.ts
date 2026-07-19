import {
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  type EngineContext,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { RenderEngine } from "../render.engine.js";

import {
  createEngineContext,
  createEngineContextWithRealBus,
  createMockPage,
  createMockPdfDocument,
  createRenderPageInput,
  createValidBuffer,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  resetCreatedCanvases,
} from "./fixtures/test-helpers.js";

describe("RenderEngine — contract tests", () => {
  let engine: RenderEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    resetCreatedCanvases();
    engine = new RenderEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Render);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("renderPage() before init() throws EngineNotInitializedError", async () => {
    const input = createRenderPageInput({ documentId: "doc-1" });
    await expect(engine.renderPage(input, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("renderPage() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    const input = createRenderPageInput({ documentId: "doc-1" });
    await expect(engine.renderPage(input, ctx)).rejects.toThrow(EngineDisposedError);
  });

  it("renderPage returns ImageData with correct dimensions", async () => {
    const docId = "doc-dimensions";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    expect(output.imageData.width).toBe(595); // width mock * previewScale (1)
    expect(output.imageData.height).toBe(842);
    expect(output.imageData.data.length).toBe(595 * 842 * 4);
    expect(output.documentId).toBe(docId);
    expect(output.pageIndex).toBe(0);
    expect(output.kind).toBe("original");
    expect(typeof output.durationMs).toBe("number");
  });

  it("emits PREVIEW_UPDATED after preview render", async () => {
    const docId = "doc-preview-updated";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.PREVIEW_UPDATED,
      expect.objectContaining({
        documentId: docId,
        pageIndex: 0,
        kind: "original",
        canvasBlobUrl: expect.any(String),
      }),
    );
  });

  it("emits RENDER_FINISHED after batch", async () => {
    const docId = "doc-render-finished";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 2 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.renderPages(
      [
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "original",
          mode: "preview",
        }),
        createRenderPageInput({
          documentId: docId,
          pageIndex: 1,
          kind: "original",
          mode: "preview",
        }),
      ],
      ctx,
    );

    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.RENDER_FINISHED,
      expect.objectContaining({
        documentId: docId,
        pageIndices: [0, 1],
        durationMs: expect.any(Number),
      }),
    );
  });

  it("dispose destroys loaded PDFDocumentProxies", async () => {
    const mockDocA = createMockPdfDocument({ pageCount: 1 });
    const mockDocB = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument)
      .mockReturnValueOnce(mockGetDocumentResult(mockDocA))
      .mockReturnValueOnce(mockGetDocumentResult(mockDocB));

    await engine.init(ctx);
    await engine.loadDocument("doc-a", createValidBuffer());
    await engine.loadDocument("doc-b", createValidBuffer());

    expect(engine["documents"].size).toBe(2);

    await engine.dispose();

    expect(mockDocA.destroy).toHaveBeenCalledTimes(1);
    expect(mockDocB.destroy).toHaveBeenCalledTimes(1);
    expect(engine["documents"].size).toBe(0);
    expect(engine["initialized"]).toBe(false);
    expect(engine["disposed"]).toBe(true);
  });

  it("loadDocument then unloadDocument round-trip", async () => {
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    await engine.init(ctx);
    await engine.loadDocument("doc-roundtrip", createValidBuffer());
    expect(engine["documents"].has("doc-roundtrip")).toBe(true);

    await engine.unloadDocument("doc-roundtrip");
    expect(engine["documents"].has("doc-roundtrip")).toBe(false);
    expect(mockDoc.destroy).toHaveBeenCalledTimes(1);
  });

  // ─── ADR-034 §1/§3 (Hito 9): rasterizePage + RenderPageOutput.encoded ───

  it("rasterizePage returns ImageData without emitting events nor touching cache", async () => {
    const docId = "doc-rasterize";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument({
          pageCount: 1,
          pageFactory: () => createMockPage({ width: 200, height: 300 }),
        }),
      ),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    const imageData = await engine.rasterizePage(docId, 0, 2, ctx);

    expect(imageData.width).toBe(400); // 200 * scale(2)
    expect(imageData.height).toBe(600);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(engine["cache"].size).toBe(0);
  });

  it("full mode output includes encoded bytes with effective format and quality", async () => {
    const docId = "doc-encoded-full";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "full" }),
      ctx,
    );

    expect(output.encoded).toBeDefined();
    expect(output.encoded?.format).toBe("jpeg"); // default full imageFormat (§9)
    expect(output.encoded?.bytes.byteLength).toBeGreaterThan(0);
    expect(output.encoded?.widthPx).toBe(output.imageData.width);
    expect(output.encoded?.heightPx).toBe(output.imageData.height);
  });

  // ─── ADR-037 §1 (Hito 10): RENDER_REQUESTED.scale ───

  it("RENDER_REQUESTED propagates scale to renderPages", async () => {
    const docId = "doc-scale-propagate";
    // Se observa la propagación en su efecto contractual (la escala con la que
    // se construye el viewport de cada página del batch), no espiando el
    // método por el que pasa: desde el fix del supersede (nota 6c de
    // render.engine.ts) el handler despacha por la vía interna
    // `renderPagesInternal` (con supersede), no por el `renderPages` público.
    const getViewportSpy = vi.fn(({ scale }: { scale: number }) => ({
      width: 100 * scale,
      height: 100 * scale,
    }));
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => ({
        getViewport: getViewportSpy,
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: 3,
    });

    await vi.waitFor(() => {
      expect(getViewportSpy).toHaveBeenCalledWith({ scale: 3 });
    });

    // El batch reconstruye "original" y "anonymized" por página (nota 1 de
    // render.engine.ts): TODOS los renders del request usan la escala del evento.
    expect(getViewportSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of getViewportSpy.mock.calls) {
      expect(call[0]?.scale).toBe(3);
    }
  });
});
