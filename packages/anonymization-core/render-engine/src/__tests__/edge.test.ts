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
    // ADR-044: RenderEngine ya no filtra grupos deshabilitados por sí mismo
    // (el delta render por GROUP_TOGGLED/GROUP_REPLACEMENT_CHANGED se retiró,
    // junto con `Replacement`, que nunca tuvo un campo `enabled`). El filtro
    // vive en el caller autoritativo (`buildPageReplacements`, export-engine,
    // invocado por el Orchestrator — Render_Engine.md §13 caso 2): un grupo
    // deshabilitado simplemente no llega en `replacements`. Se verifica acá
    // que ese grupo ausente no deja ningún rastro pintado, mientras uno
    // presente sí se pinta.
    const docId = "doc-toggle-disabled";
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
        replacements: [makeReplacement({ groupId: "g-enabled", replacementValue: "[DNI 01]" })],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    expect(fillTextCalls[0]!.args[0]).toBe("[DNI 01]"); // solo el grupo habilitado se pinta
    expect(output.kind).toBe("anonymized");
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
    // ADR-043 §3: `documents` host-side ya no guarda el `PDFDocumentProxy`
    // (vive en el kernel/worker) — retiene `{ buffer, pageCount }`. La
    // recarga determinística (mismo comportamiento, ADR-030 §1) se verifica
    // acá por el `pageCount` reflejando el segundo proxy (mockDocB, 2
    // páginas) en vez de por identidad de referencia del proxy.
    expect(engine["documents"].get(docId)).toEqual(expect.objectContaining({ pageCount: 2 }));
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
    expect(engine["lastOriginalInputs"].size).toBe(0);
  });

  it("loadDocument reload and unloadDocument also clear pendingRenders (ADR-037 §4)", async () => {
    const docId = "doc-reload-pending";
    const mockDocA = createMockPdfDocument({ pageCount: 1 });
    const mockDocB = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument)
      .mockReturnValueOnce(mockGetDocumentResult(mockDocA))
      .mockReturnValueOnce(mockGetDocumentResult(mockDocB));

    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());
    // Registra un estado de supersede directo (mismo helper que usa
    // handleRenderRequested), sin depender de un round-trip completo del bus.
    engine["registerPendingRender"](docId, 0, "original", 1);
    expect(engine["pendingRenders"].size).toBeGreaterThan(0);

    await engine.loadDocument(docId, createValidBuffer());
    expect(engine["pendingRenders"].size).toBe(0);

    engine["registerPendingRender"](docId, 0, "anonymized", 1);
    expect(engine["pendingRenders"].size).toBeGreaterThan(0);

    await engine.unloadDocument(docId);
    expect(engine["pendingRenders"].size).toBe(0);
  });

  // ─── ADR-034 §1: rasterizePage validaciones ───

  it("rasterizePage throws InvalidInputError when document not loaded", async () => {
    await engine.init(ctx);
    await expect(engine.rasterizePage("doc-not-loaded", 0, 2, ctx)).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("rasterizePage throws InvalidInputError when scale <= 0", async () => {
    const docId = "doc-rasterize-bad-scale";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await expect(engine.rasterizePage(docId, 0, 0, ctx)).rejects.toThrow(InvalidInputError);
    await expect(engine.rasterizePage(docId, 0, -1, ctx)).rejects.toThrow(InvalidInputError);
  });

  it("rasterizePage throws InvalidInputError when pageIndex out of range", async () => {
    const docId = "doc-rasterize-bad-page";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    await expect(engine.rasterizePage(docId, 5, 2, ctx)).rejects.toThrow(InvalidInputError);
  });

  // ─── ADR-037 §2/§4 (Hito 10): guard de scale + supersede por página ───

  it("scale out of range warns and no-ops via event, throws InvalidInputError via direct call", async () => {
    const docId = "doc-scale-range";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());
    const warnSpy = vi.spyOn(realCtx.logger, "warn");

    // Vía evento: fuera de rango (> MAX_RENDER_SCALE = 4) → warn + no-op.
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: 5,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("scale"),
      expect.objectContaining({ documentId: docId, scale: 5 }),
    );

    // Vía evento: no finito → warn + no-op.
    warnSpy.mockClear();
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: Number.POSITIVE_INFINITY,
    });
    expect(warnSpy).toHaveBeenCalled();

    // Vía invocación directa: InvalidInputError (fuera de rango, <= 0, no finito).
    await expect(
      engine.renderPage(
        createRenderPageInput({ documentId: docId, pageIndex: 0, scale: 5 }),
        realCtx,
      ),
    ).rejects.toThrow(InvalidInputError);
    await expect(
      engine.renderPage(
        createRenderPageInput({ documentId: docId, pageIndex: 0, scale: 0 }),
        realCtx,
      ),
    ).rejects.toThrow(InvalidInputError);
    await expect(
      engine.renderPage(
        createRenderPageInput({ documentId: docId, pageIndex: 0, scale: Number.NaN }),
        realCtx,
      ),
    ).rejects.toThrow(InvalidInputError);
  });

  it("superseded render in queue is discarded without PREVIEW_UPDATED", async () => {
    const docId = "doc-superseded-queue";
    const mockDoc = createMockPdfDocument({ pageCount: 2 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());
    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    // Request A pide render de las páginas 0 y 1 a escala 1. renderPages
    // procesa secuencialmente: cuando llega el segundo emit (síncrono, el bus
    // despacha en línea), A todavía no llamó getPage para la página 1 — sigue
    // "en cola" dentro de su propio batch.
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0, 1],
      mode: "preview",
      scale: 1,
    });

    // Request B supersede la página 1 con otra escala antes de que el batch de
    // A llegue a ejecutarla (ADR-037 §4: descarta el pendiente en cola).
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [1],
      mode: "preview",
      scale: 2,
    });

    await vi.waitFor(() => {
      // pageNumber 2 = pageIndex 1 + 1, invocado por B.
      expect(getPageSpy).toHaveBeenCalledWith(2);
    });
    // Deja asentar cualquier microtask restante del batch de A antes de contar.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // handleRenderRequested reconstruye "original" y "anonymized" por página
    // (06_Pipeline.md §10): B por sí solo llama getPage(2) dos veces (una por
    // kind). Si el intento en cola de A NO se hubiera descartado, habría 4
    // llamadas en total (2 de A + 2 de B) en vez de 2.
    const page1Calls = getPageSpy.mock.calls.filter((call) => call[0] === 2);
    expect(page1Calls).toHaveLength(2); // solo B (ambos kinds); A se descartó sin ejecutar.
  });

  it("superseded render in flight aborts at next checkpoint without PREVIEW_UPDATED", async () => {
    const docId = "doc-superseded-flight";
    let resolvePage0Render: (() => void) | undefined;
    const page0RenderPromise = new Promise<void>((resolve) => {
      resolvePage0Render = resolve;
    });
    const renderSpy = vi.fn(() => ({ promise: page0RenderPromise }));
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => ({
        getViewport: vi.fn(() => ({ width: 100, height: 100 })),
        render: renderSpy,
      }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    const previewUpdates: Array<{ pageIndex: number; kind: string }> = [];
    realCtx.bus.on(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, (payload) => {
      previewUpdates.push({ pageIndex: payload.pageIndex, kind: payload.kind });
    });

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: 1,
    });

    // Espera a que el render de A haya arrancado su render() (pasó getPage,
    // entró a renderPageOntoContext) y quede bloqueado esperando la promesa.
    await vi.waitFor(() => {
      expect(renderSpy).toHaveBeenCalled();
    });

    // Supersede: misma página/kind, otra escala. Aborta el AbortController del
    // render en vuelo de A (ADR-037 §4).
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: 2,
    });

    resolvePage0Render?.();

    await vi.waitFor(() => {
      const originalUpdates = previewUpdates.filter(
        (u) => u.pageIndex === 0 && u.kind === "original",
      );
      expect(originalUpdates).toHaveLength(1);
    });

    // Deja asentar cualquier microtask restante antes de la aserción final —
    // si el render superseded de A hubiera emitido, ya habría llegado acá.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finalOriginalUpdates = previewUpdates.filter(
      (u) => u.pageIndex === 0 && u.kind === "original",
    );
    expect(finalOriginalUpdates).toHaveLength(1); // solo B: A se descartó sin emitir.
  });

  // ─── Caso 21 (hallazgo de revisión Hito 10 PR4): el supersede solo aplica al
  // flujo por eventos; las invocaciones directas son inmunes a sus entradas ───

  it("direct full render (export) ignores supersede entry left by a completed event render at another scale", async () => {
    const docId = "doc-export-immune";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    // Preview vía RENDER_REQUESTED a escala 1: completa con éxito y deja su
    // entrada de supersede registrada (las entradas no se limpian al completar,
    // deliberadamente — ver nota 6c de render.engine.ts).
    let renderFinished = false;
    realCtx.bus.on(EventChannel.Render, EngineEvents.RENDER_FINISHED, () => {
      renderFinished = true;
    });
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      scale: 1,
    });
    await vi.waitFor(() => {
      expect(renderFinished).toBe(true);
    });
    // Premisa del bug: la entrada del preview sigue registrada tras completar.
    expect(engine["pendingRenders"].size).toBeGreaterThan(0);

    // Export directo del Orchestrator (RenderPageProvider.renderFull →
    // renderPage con mode "full" y otra escala): antes del fix, la entrada
    // residual del preview (escala 1 ≠ 2) lo cancelaba espuriamente con
    // CancelledError. La invocación directa no participa del supersede.
    const output = await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "full",
        scale: 2,
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      realCtx,
    );

    expect(output.pageIndex).toBe(0);
    expect(output.kind).toBe("anonymized");
    expect(output.encoded).toBeDefined(); // mode "full" → bytes para el export (ADR-034 §3).
  });

  it("direct preview render (mediated) ignores supersede entry at another scale (group change is not lost)", async () => {
    // Reformulado por ADR-044 (el delta render por GROUP_TOGGLED se retira):
    // el re-render por cambio de grupo lo dispara ahora el Orchestrator con
    // una invocación DIRECTA de renderPage (mode "preview", reemplazos del
    // snapshot) — mismo camino que el export, inmune al supersede de
    // RENDER_REQUESTED (Render_Engine.md §13 caso 21).
    const docId = "doc-mediated-immune";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    // Render mediado previo (equivalente al seed/flush del Orchestrator):
    // página a escala 2 con un reemplazo habilitado.
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        scale: 2,
        replacements: [makeReplacement({ groupId: "g1" })],
      }),
      realCtx,
    );

    // Simula un RENDER_REQUESTED vigente a OTRA escala para la misma clave
    // (mismo helper que usa handleRenderRequested; mismo patrón white-box que
    // el test de reload de pendingRenders de arriba).
    engine["registerPendingRender"](docId, 0, "anonymized", 1);
    resetCreatedCanvases();

    // Invocación directa mediada (ADR-044 §Decisión 1/3): un cambio de grupo
    // (deshabilitar g1) recomputa `replacements: []` desde el snapshot de
    // Grouping y vuelve a invocar renderPage directo, a la MISMA escala (2)
    // que ya tenía la página. Antes del fix (hallazgo PR4), la entrada de
    // supersede residual a escala 1 lo habría cancelado espuriamente (caso
    // 21) y el cambio de grupo se hubiera perdido visualmente.
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        scale: 2,
        replacements: [], // g1 deshabilitado: ya filtrado por el caller (buildPageReplacements)
      }),
      realCtx,
    );

    const [canvas] = getCreatedCanvases();
    // Grupo deshabilitado → sin texto de reemplazo (§13 caso 2): la
    // invocación directa corrió de verdad (inmune al supersede) y aplicó el
    // cambio.
    expect(canvas!.calls.filter((c) => c.op === "fillText")).toHaveLength(0);
  });
});
