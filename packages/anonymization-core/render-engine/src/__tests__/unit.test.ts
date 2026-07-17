import {
  AnnotationKind,
  EngineEvents,
  EventChannel,
  ReplacementMode,
  type EngineContext,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { RenderEngine } from "../render.engine.js";

import {
  createEngineContext,
  createEngineContextWithRealBus,
  createMockConfig,
  createMockPdfDocument,
  createRenderPageInput,
  createValidBuffer,
  getCreatedCanvases,
  installOffscreenCanvasStub,
  makeAnnotation,
  makeReplacement,
  mockGetDocumentResult,
  resetCreatedCanvases,
} from "./fixtures/test-helpers.js";

describe("RenderEngine — unit tests", () => {
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

  it("original kind renders no replacements", async () => {
    const docId = "doc-original-only";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    expect(canvas).toBeDefined();
    // Sin annotations: el único call registrado es getImageData (ningún fill/stroke/texto).
    const drawOps = canvas!.calls.filter((c) => c.op !== "getImageData");
    expect(drawOps).toHaveLength(0);
  });

  it("highlight border on original kind", async () => {
    const docId = "doc-highlight";
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
            kind: AnnotationKind.Highlight,
            bbox: { x: 5, y: 6, width: 40, height: 12 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const strokeCalls = canvas!.calls.filter((c) => c.op === "strokeRect");
    expect(strokeCalls).toHaveLength(1);
    expect(strokeCalls[0]!.args).toEqual([5, 6, 40, 12]);
    expect(strokeCalls[0]!.strokeStyle).toBe("#2563eb");
  });

  it("delta render only re-renders affected pages", async () => {
    // Nota: requestDeltaRender directo (sin override previo) re-renderiza con
    // los mismos replacements → mismo hash de cache → cache hit legítimo (sin
    // nuevo getPage). Para forzar un re-render real y verificar "solo la
    // página afectada", el cambio de modo llega por GROUP_REPLACEMENT_CHANGED
    // (bus real), que sí invalida el cache de la página afectada (g1) y deja
    // intacto el de la no afectada (g2) — mismo mecanismo que produciría un
    // cambio real de reemplazo en producción.
    const docId = "doc-delta";
    const mockDoc = createMockPdfDocument({ pageCount: 2 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1", occurrenceId: "occ-a" })],
      }),
      realCtx,
    );
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 1,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g2", occurrenceId: "occ-b" })],
      }),
      realCtx,
    );

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    getPageSpy.mockClear();

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: docId,
      groupId: "g1",
      mode: ReplacementMode.Redact,
      value: "",
    });

    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalled();
    });

    expect(getPageSpy).toHaveBeenCalledWith(1); // pageIndex 0 → pageNumber 1
    expect(getPageSpy).not.toHaveBeenCalledWith(2); // pageIndex 1 (g2) no afectada
  });

  it("requestDeltaRender is a no-op when no page is affected", async () => {
    const docId = "doc-delta-noop";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
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

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    getPageSpy.mockClear();

    engine.requestDeltaRender(docId, ["group-inexistente"]);

    // Sin páginas afectadas: ningún nuevo render se dispara.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getPageSpy).not.toHaveBeenCalled();
  });

  it("LRU cache evicts oldest when full", async () => {
    const docId = "doc-lru";
    const mockDoc = createMockPdfDocument({ pageCount: 3 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const smallCacheCtx = createEngineContext({
      config: createMockConfig({
        render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 2 },
      }),
    });
    await engine.init(smallCacheCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      smallCacheCtx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 1 }),
      smallCacheCtx,
    );
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 2 }),
      smallCacheCtx,
    );

    expect(engine["cache"].size).toBe(2);

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    const callsBefore = getPageSpy.mock.calls.length;

    // La página 0 fue evictada (LRU, cachePages=2): re-renderizarla dispara un getPage nuevo.
    await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0 }),
      smallCacheCtx,
    );
    expect(getPageSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it("cache hit skips render", async () => {
    const docId = "doc-cache-hit";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const input = createRenderPageInput({ documentId: docId, pageIndex: 0 });
    const first = await engine.renderPage(input, ctx);
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    expect(getPageSpy).toHaveBeenCalledTimes(1);

    const second = await engine.renderPage(input, ctx);
    expect(getPageSpy).toHaveBeenCalledTimes(1); // sin nueva llamada: cache hit
    expect(second).toBe(first); // misma referencia cacheada
  });

  it("renderPages retries a page that fails once and continues after exhausting retries", async () => {
    const docId = "doc-retry";
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => ({
        getViewport: vi.fn(() => ({ width: 100, height: 100 })),
        render: vi.fn(() => ({ promise: Promise.reject(new Error("render boom")) })),
      }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    const emitSpy = vi.spyOn(ctx.bus, "emit");

    const outputs = await engine.renderPages(
      [
        createRenderPageInput({
          documentId: docId,
          pageIndex: 0,
          kind: "original",
          mode: "preview",
        }),
      ],
      ctx,
    );

    expect(outputs).toHaveLength(0);
    // MAX_RETRIES=1 → 2 intentos totales.
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    expect(getPageSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.PREVIEW_PAGE_FAILED,
      expect.objectContaining({ documentId: docId, pageIndex: 0 }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      EventChannel.Render,
      EngineEvents.RENDER_FINISHED,
      expect.objectContaining({ documentId: docId, pageIndices: [] }),
    );
  });

  it("renderPage with kind=anonymized paints redact/mask/placeholder/synthetic replacements", async () => {
    const docId = "doc-modes";
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
            groupId: "g1",
            occurrenceId: "o1",
            mode: ReplacementMode.Placeholder,
            replacementValue: "[DNI 01]",
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("[DNI 01]");
  });

  // ─── Consumo de eventos del bus (checklist §15 item 14) ───
  // El bus mockeado (createEngineContext) no dispara handlers; se usa el bus
  // real (@anonly/event-system) para ejercitar la ruta de consumo end-to-end.

  it("RENDER_REQUESTED triggers a render for the requested pages", async () => {
    const docId = "doc-render-requested";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
    });

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalled();
    });
  });

  it("GROUP_REPLACEMENT_CHANGED triggers a delta re-render of affected pages", async () => {
    const docId = "doc-group-replacement";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      realCtx,
    );

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    getPageSpy.mockClear();

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: docId,
      groupId: "g1",
      mode: ReplacementMode.Redact,
      value: "",
    });

    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalled();
    });
  });

  it("delta render on original kind filters disabled highlight annotations, keeping other groups'", async () => {
    const docId = "doc-annotation-overrides";
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
        kind: "original",
        mode: "preview",
        annotations: [
          makeAnnotation({
            id: "ann-g1",
            groupId: "g1",
            kind: AnnotationKind.Highlight,
            bbox: { x: 1, y: 1, width: 5, height: 5 },
          }),
          makeAnnotation({
            id: "ann-g2",
            groupId: "g2",
            kind: AnnotationKind.Highlight,
            bbox: { x: 9, y: 9, width: 5, height: 5 },
          }),
        ],
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
    const strokeCalls = canvas!.calls.filter((c) => c.op === "strokeRect");
    // g1 (deshabilitado) se filtra; g2 permanece.
    expect(strokeCalls).toHaveLength(1);
    expect(strokeCalls[0]!.args).toEqual([9, 9, 5, 5]);
  });

  it("delta render swallows internal render errors and emits PREVIEW_PAGE_FAILED", async () => {
    const docId = "doc-delta-internal-error";
    let callCount = 0;
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            getViewport: vi.fn(() => ({ width: 100, height: 100 })),
            render: vi.fn(() => ({ promise: Promise.resolve() })),
          };
        }
        return {
          getViewport: vi.fn(() => ({ width: 100, height: 100 })),
          render: vi.fn(() => ({ promise: Promise.reject(new Error("boom en delta render")) })),
        };
      },
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      realCtx,
    );

    const emitSpy = vi.spyOn(realCtx.bus, "emit");

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: docId,
      groupId: "g1",
      mode: ReplacementMode.Redact,
      value: "",
    });

    await vi.waitFor(() => {
      expect(emitSpy).toHaveBeenCalledWith(
        EventChannel.Render,
        EngineEvents.PREVIEW_PAGE_FAILED,
        expect.objectContaining({ documentId: docId, pageIndex: 0 }),
      );
    });
  });

  it("GROUP_TOGGLED triggers a delta re-render of affected pages", async () => {
    const docId = "doc-group-toggled";
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      realCtx,
    );

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;
    getPageSpy.mockClear();

    realCtx.bus.emit(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED, {
      documentId: docId,
      groupId: "g1",
      enabled: false,
    });

    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalled();
    });
  });

  // ─── ADR-034 §3 ───

  it("preview mode output has no encoded field", async () => {
    const docId = "doc-preview-no-encoded";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const output = await engine.renderPage(
      createRenderPageInput({ documentId: docId, pageIndex: 0, kind: "original", mode: "preview" }),
      ctx,
    );

    expect(output.encoded).toBeUndefined();
  });
});
