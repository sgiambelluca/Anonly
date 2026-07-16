import {
  AnnotationKind,
  EngineDisposedError,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { RenderEngine } from "../render.engine.js";
import { RenderFailedError, RenderPageFailedError, RenderTimeoutError } from "../render.errors.js";

import {
  createEngineContext,
  createEngineContextWithRealBus,
  createMockConfig,
  createMockPage,
  createMockPdfDocument,
  createRenderPageInput,
  createValidBuffer,
  getCreatedCanvases,
  installOffscreenCanvasStub,
  makeAnnotation,
  makeReplacement,
  mockGetDocumentFailure,
  mockGetDocumentResult,
  removeOffscreenCanvasStub,
  resetCreatedCanvases,
  setStubCanvasContextAvailable,
} from "./fixtures/test-helpers.js";

describe("RenderEngine — edge cases", () => {
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
    installOffscreenCanvasStub();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("anonymized kind with empty replacements = original", async () => {
    const docId = "doc-empty-replacements";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const drawOps = canvas!.calls.filter((c) => c.op !== "getImageData");
    expect(drawOps).toHaveLength(0);
    expect(output.kind).toBe("anonymized");
  });

  it("disabled group's occurrences appear as original text", async () => {
    const docId = "doc-toggle-disabled";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1", replacementValue: "[DNI 01]" })],
      }),
      realCtx,
    );
    resetCreatedCanvases();

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED, {
      documentId: docId,
      groupId: "g1",
      enabled: false,
    });

    await vi.waitFor(() => {
      expect(getCreatedCanvases().length).toBeGreaterThan(0);
    });

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(0);
  });

  it("redact mode paints opaque black over bbox", async () => {
    const docId = "doc-redact";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({
            mode: ReplacementMode.Redact,
            replacementValue: "",
            bbox: { x: 1, y: 2, width: 30, height: 8 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillRectCalls = canvas!.calls.filter((c) => c.op === "fillRect");
    expect(fillRectCalls).toHaveLength(1);
    expect(fillRectCalls[0]!.args).toEqual([1, 2, 30, 8]);
    expect(fillRectCalls[0]!.fillStyle).toBe("#000000");
    expect(canvas!.calls.some((c) => c.op === "fillText")).toBe(false);
  });

  it("mask mode renders censored text over bbox", async () => {
    const docId = "doc-mask";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({ mode: ReplacementMode.Mask, replacementValue: "XX.XXX.XXX" }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillRectCalls = canvas!.calls.filter((c) => c.op === "fillRect");
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillRectCalls).toHaveLength(1);
    expect(fillRectCalls[0]!.fillStyle).toBe("#ffffff"); // fondo blanco (§13 caso 4)
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("XX.XXX.XXX");
    expect(fillTextCalls[0]!.fillStyle).toBe("#000000"); // texto negro
  });

  it("placeholder mode renders [TYPE NN] over bbox", async () => {
    const docId = "doc-placeholder";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({ mode: ReplacementMode.Placeholder, replacementValue: "[DNI 01]" }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("[DNI 01]");
    expect(fillTextCalls[0]!.font).toContain("monospace");
  });

  it("synthetic mode renders synthetic value over bbox", async () => {
    const docId = "doc-synthetic";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({ mode: ReplacementMode.Synthetic, replacementValue: "39.123.456" }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("39.123.456");
  });

  it("conflict marker on original kind", async () => {
    const docId = "doc-conflict";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "original",
        mode: "preview",
        annotations: [
          makeAnnotation({
            kind: AnnotationKind.Conflict,
            bbox: { x: 3, y: 4, width: 20, height: 9 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const strokeCalls = canvas!.calls.filter((c) => c.op === "strokeRect");
    expect(strokeCalls).toHaveLength(1);
    expect(strokeCalls[0]!.strokeStyle).toBe("#dc2626");
  });

  it("throws EngineDisposedError after dispose", async () => {
    await engine.init(ctx);
    await engine.dispose();
    await expect(
      engine.renderPage(createRenderPageInput({ documentId: "doc-x" }), ctx),
    ).rejects.toThrow(EngineDisposedError);
  });

  it("rotated page renders with correct orientation", async () => {
    const docId = "doc-rotated";
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => createMockPage({ width: 842, height: 595 }), // A4 apaisado (rotada 90°)
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    expect(output.imageData.width).toBe(842);
    expect(output.imageData.height).toBe(595);
  });

  it("throws InvalidInputError when document not loaded", async () => {
    await engine.init(ctx);
    await expect(
      engine.renderPage(createRenderPageInput({ documentId: "doc-not-loaded" }), ctx),
    ).rejects.toThrow(InvalidInputError);
  });

  it("throws InvalidInputError when pageIndex is out of range", async () => {
    const docId = "doc-range";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await expect(
      engine.renderPage(createRenderPageInput({ documentId: docId, pageIndex: 5 }), ctx),
    ).rejects.toThrow(InvalidInputError);
  });

  it("throws InvalidInputError when loadDocument buffer is empty", async () => {
    await engine.init(ctx);
    await expect(engine.loadDocument("doc-empty-buffer", new ArrayBuffer(0))).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("RENDER_REQUESTED for unloaded document warns and no-ops", async () => {
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    const warnSpy = vi.spyOn(realCtx.logger, "warn");

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: "doc-unloaded",
      pageIndices: [0],
      mode: "preview",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("doc-unloaded"),
      expect.objectContaining({ documentId: "doc-unloaded" }),
    );
  });

  it("loadDocument twice replaces previous proxy", async () => {
    const docId = "doc-reload";
    const mockDocA = createMockPdfDocument({ pageCount: 1 });
    const mockDocB = createMockPdfDocument({ pageCount: 2 });
    vi.mocked(getDocument)
      .mockReturnValueOnce(mockGetDocumentResult(mockDocA))
      .mockReturnValueOnce(mockGetDocumentResult(mockDocB));

    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    expect(mockDocA.destroy).not.toHaveBeenCalled();

    await engine.loadDocument(docId, createValidBuffer());

    expect(mockDocA.destroy).toHaveBeenCalledTimes(1);
    expect(engine["documents"].get(docId)).toBe(mockDocB);
  });

  it("unloadDocument on unknown id is a no-op", async () => {
    await engine.init(ctx);
    await expect(engine.unloadDocument("doc-nunca-cargado")).resolves.toBeUndefined();
  });

  it("OffscreenCanvas fallback when unavailable", async () => {
    const docId = "doc-no-offscreen";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    removeOffscreenCanvasStub();
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    await expect(
      engine.renderPage(createRenderPageInput({ documentId: docId, pageIndex: 0 }), ctx),
    ).rejects.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("throws RenderPageFailedError when a 2D context is unavailable", async () => {
    const docId = "doc-no-2d-context";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    setStubCanvasContextAvailable(false);
    try {
      await expect(
        engine.renderPage(createRenderPageInput({ documentId: docId, pageIndex: 0 }), ctx),
      ).rejects.toThrow(RenderPageFailedError);
    } finally {
      setStubCanvasContextAvailable(true);
    }
  });

  it("throws RenderFailedError when getDocument fails in loadDocument", async () => {
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentFailure(new Error("PDF corrupto")));
    await engine.init(ctx);

    await expect(engine.loadDocument("doc-getdocument-fails", createValidBuffer())).rejects.toThrow(
      RenderFailedError,
    );
  });

  it("throws RenderTimeoutError when render exceeds the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const docId = "doc-timeout";
      const mockDoc = createMockPdfDocument({
        pageCount: 1,
        pageFactory: () => ({
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: vi.fn(() => ({ promise: new Promise<void>(() => undefined) })), // nunca resuelve
        }),
      });
      vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

      const shortTimeoutConfig = createMockConfig();
      const shortTimeoutCtx = createEngineContext({
        config: {
          ...shortTimeoutConfig,
          workerPool: {
            ...shortTimeoutConfig.workerPool,
            timeouts: { ...shortTimeoutConfig.workerPool.timeouts, "render-page": 50 },
          },
        },
      });
      await engine.init(shortTimeoutCtx);
      await engine.loadDocument(docId, createValidBuffer());

      const assertion = expect(
        engine.renderPage(
          createRenderPageInput({ documentId: docId, pageIndex: 0 }),
          shortTimeoutCtx,
        ),
      ).rejects.toThrow(RenderTimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("paintAnnotations skips non highlight/conflict annotation kinds on original render", async () => {
    const docId = "doc-annotation-kind-skip";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "original",
        mode: "preview",
        annotations: [makeAnnotation({ kind: AnnotationKind.Replacement })],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    expect(canvas!.calls.some((c) => c.op === "strokeRect")).toBe(false);
  });

  it("loadDocument reload clears cached render state for the previous load", async () => {
    const docId = "doc-reload-state";
    const mockDocA = createMockPdfDocument({ pageCount: 1 });
    const mockDocB = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument)
      .mockReturnValueOnce(mockGetDocumentResult(mockDocA))
      .mockReturnValueOnce(mockGetDocumentResult(mockDocB));

    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      ctx,
    );
    expect(engine["cache"].size).toBeGreaterThan(0);

    await engine.loadDocument(docId, createValidBuffer());

    expect(engine["cache"].size).toBe(0);
    expect(engine["pageGroupIndex"].size).toBe(0);
    expect(engine["lastAnonymizedInputs"].size).toBe(0);
    expect(engine["lastOriginalInputs"].size).toBe(0);
  });

  it("unloadDocument clears cached render state", async () => {
    const docId = "doc-unload-state";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "original",
        mode: "preview",
        annotations: [makeAnnotation({ groupId: "g1" })],
      }),
      ctx,
    );
    expect(engine["cache"].size).toBeGreaterThan(0);

    await engine.unloadDocument(docId);

    expect(engine["cache"].size).toBe(0);
    expect(engine["pageGroupIndex"].size).toBe(0);
    expect(engine["lastOriginalInputs"].size).toBe(0);
  });

  it("GROUP_REPLACEMENT_CHANGED for unloaded document warns and no-ops", async () => {
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    const warnSpy = vi.spyOn(realCtx.logger, "warn");

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: "doc-unloaded-2",
      groupId: "g1",
      mode: ReplacementMode.Redact,
      value: "",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("doc-unloaded-2"),
      expect.objectContaining({ documentId: "doc-unloaded-2" }),
    );
  });

  it("GROUP_TOGGLED for unloaded document warns and no-ops", async () => {
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    const warnSpy = vi.spyOn(realCtx.logger, "warn");

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED, {
      documentId: "doc-unloaded-3",
      groupId: "g1",
      enabled: false,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("doc-unloaded-3"),
      expect.objectContaining({ documentId: "doc-unloaded-3" }),
    );
  });
});
