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
});
