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
  createResolvedRenderBroadcastPool,
  createResolvedRenderDispatchPool,
  createValidBuffer,
  getCreatedCanvases,
  installOffscreenCanvasStub,
  makeAnnotation,
  makeReplacement,
  mockGetDocumentFailure,
  mockGetDocumentResult,
  readProtectedPdfFixtureBuffer,
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

  // ─── ADR-058 §1 (Hito 10.5, PR 1): shrink-to-fit — casos límite ───

  it("token much wider than its bbox is drawn at the 8px floor without overflow", async () => {
    const docId = "doc-shrink-extreme";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const text = "X".repeat(300);
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({
            mode: ReplacementMode.Placeholder,
            replacementValue: text,
            bbox: { x: 5, y: 5, width: 20, height: 14 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();
    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(1);
    // Piso: nunca baja de 8px, aunque el token siga sin entrar (ADR-058 §1).
    expect(fillTextCalls[0]!.font).toBe("8px monospace, sans-serif");
    // Red de seguridad final: `maxWidth` = bbox.width, siempre presente.
    expect(fillTextCalls[0]!.args[3]).toBe(20);
    // Y lo que de verdad se dibuja (post-clamp de `fillText`) nunca se derrama.
    expect(fillTextCalls[0]!.drawnWidth).toBeLessThanOrEqual(20);
  });

  it("all three text modes respect the fit; redact is unchanged", async () => {
    const docId = "doc-shrink-modes";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    // mask (IBAN-like, 26 caracteres fijos — ADR-058 Contexto §2: "el mask de
    // IBAN son 24 caracteres, quepan o no") en una caja angosta: ni al piso
    // entra. synthetic: entra directo al tamaño inicial, sin encoger.
    // placeholder: encoge a un tamaño intermedio (no al piso) y entra.
    await engine.renderPage(
      createRenderPageInput({
        documentId: docId,
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          makeReplacement({
            groupId: "g-redact",
            occurrenceId: "occ-redact",
            mode: ReplacementMode.Redact,
            replacementValue: "",
            bbox: { x: 0, y: 0, width: 30, height: 10 },
          }),
          makeReplacement({
            groupId: "g-mask",
            occurrenceId: "occ-mask",
            mode: ReplacementMode.Mask,
            replacementValue: "XX.XXX.XXX.XX.XXXXXXXXXXXX",
            bbox: { x: 40, y: 0, width: 45, height: 14 },
          }),
          makeReplacement({
            groupId: "g-synth",
            occurrenceId: "occ-synth",
            mode: ReplacementMode.Synthetic,
            replacementValue: "39.123.456",
            bbox: { x: 90, y: 0, width: 100, height: 14 },
          }),
          makeReplacement({
            groupId: "g-place",
            occurrenceId: "occ-place",
            mode: ReplacementMode.Placeholder,
            replacementValue: "[PERSONA 01]",
            bbox: { x: 200, y: 0, width: 65, height: 14 },
          }),
        ],
      }),
      ctx,
    );

    const [canvas] = getCreatedCanvases();

    // redact: sin fillText, fill opaco sin cambios (ADR-058 §1: inmune).
    const redactRect = canvas!.calls.find((c) => c.op === "fillRect" && c.fillStyle === "#000000");
    expect(redactRect?.args).toEqual([0, 0, 30, 10]);

    const fillTextCalls = canvas!.calls.filter((c) => c.op === "fillText");
    expect(fillTextCalls).toHaveLength(3); // redact no dibuja texto

    const textCases: ReadonlyArray<{ readonly text: string; readonly bboxWidth: number }> = [
      { text: "XX.XXX.XXX.XX.XXXXXXXXXXXX", bboxWidth: 45 },
      { text: "39.123.456", bboxWidth: 100 },
      { text: "[PERSONA 01]", bboxWidth: 65 },
    ];
    for (const { text, bboxWidth } of textCases) {
      const call = fillTextCalls.find((c) => c.args[0] === text);
      expect(call).toBeDefined();
      // `maxWidth` (ADR-058 §1: red de seguridad final) va siempre, entre o no.
      expect(call!.args[3]).toBe(bboxWidth);
      // Lo que de verdad se dibuja (post-clamp) nunca se derrama.
      expect(call!.drawnWidth).toBeLessThanOrEqual(bboxWidth);
    }

    // mask (IBAN-like): el loop llega al piso sin bajar más, no entra ni ahí.
    const maskCall = fillTextCalls.find((c) => c.args[0] === "XX.XXX.XXX.XX.XXXXXXXXXXXX");
    expect(maskCall!.font).toBe("8px sans-serif");

    // synthetic: entra directo al tamaño inicial (sin encoger).
    const synthCall = fillTextCalls.find((c) => c.args[0] === "39.123.456");
    expect(synthCall!.font).toBe("10px sans-serif");

    // placeholder: encoge a un tamaño intermedio real (no al piso) — demuestra
    // que el mecanismo se activa de verdad, no solo cuando hace falta el piso.
    const placeholderCall = fillTextCalls.find((c) => c.args[0] === "[PERSONA 01]");
    expect(placeholderCall!.font).toBe("9px monospace, sans-serif");
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
      kind: "original",
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

  // ─── Caso 22 (ADR-050): password de un PDF protegido en loadDocument ───

  it("loadDocument with password opens an encrypted PDF", async () => {
    const docId = "doc-protected-with-password";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 10 })),
    );
    await engine.init(ctx);

    const buffer = readProtectedPdfFixtureBuffer();
    await engine.loadDocument(docId, buffer, "test1234");

    // objectContaining (no igualdad estricta): getDocument() también recibe
    // las cinco opciones de fuentes/CMaps de ADR-053 (assert exacto y
    // exhaustivo de esas cinco en kernel.test.ts) — acá solo interesa que
    // data/password lleguen intactos junto a ellas.
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: buffer, password: "test1234" }),
    );
    // ADR-050 §2: el host retiene { buffer, pageCount, password } — verificado
    // acá porque es lo que después usa reprimeWorkers (ver unit.test.ts).
    expect(engine["documents"].get(docId)).toEqual(
      expect.objectContaining({ pageCount: 10, password: "test1234" }),
    );
  });

  it("loadDocument without password on an encrypted PDF fails with RenderFailedError", async () => {
    // Bug que motivó ADR-050: antes del fix, un PDF protegido abierto sin
    // password moría acá con el mismo tratamiento que cualquier otro fallo
    // de getDocument en loadDocument (§11) — no es un camino nuevo (§13 caso 22).
    const pwdErr = new Error("No password given");
    pwdErr.name = "PasswordException";
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentFailure(pwdErr));
    await engine.init(ctx);

    const buffer = readProtectedPdfFixtureBuffer();
    await expect(engine.loadDocument("doc-protected-no-password", buffer)).rejects.toThrow(
      RenderFailedError,
    );
    // objectContaining por el mismo motivo que el test anterior (ADR-053: más
    // opciones en la llamada real, exhaustivas en kernel.test.ts).
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: buffer, password: undefined }),
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
      kind: "original",
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
      kind: "original",
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

    // Request A pide render de las páginas 0 y 1 a escala 1, kind "original".
    // renderPages procesa secuencialmente: cuando llega el segundo emit
    // (síncrono, el bus despacha en línea), A todavía no llamó getPage para
    // la página 1 — sigue "en cola" dentro de su propio batch.
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0, 1],
      mode: "preview",
      kind: "original",
      scale: 1,
    });

    // Request B, mismo kind "original" (ADR-056 §4: el supersede está acotado
    // por (documentId, pageIndex, kind) — kinds distintos no se pisarían
    // entre sí, ver caso 24 más abajo), supersede la página 1 con otra escala
    // antes de que el batch de A llegue a ejecutarla (ADR-037 §4: descarta el
    // pendiente en cola).
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [1],
      mode: "preview",
      kind: "original",
      scale: 2,
    });

    await vi.waitFor(() => {
      // pageNumber 2 = pageIndex 1 + 1, invocado por B.
      expect(getPageSpy).toHaveBeenCalledWith(2);
    });
    // Deja asentar cualquier microtask restante del batch de A antes de contar.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Con ADR-056 cada evento trae un solo kind: un pedido de la página 1
    // produce un solo getPage(2). Si el intento en cola de A NO se hubiera
    // descartado, habría 2 llamadas en total (1 de A + 1 de B) en vez de 1.
    const page1Calls = getPageSpy.mock.calls.filter((call) => call[0] === 2);
    expect(page1Calls).toHaveLength(1); // solo B; A se descartó sin ejecutar.
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
      kind: "original",
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
      kind: "original",
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
      kind: "anonymized",
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

  // ─── Caso 24 (ADR-056 §4): el supersede se registra SOLO para el kind pedido ───

  it("RENDER_REQUESTED registers a supersede entry only for the requested kind", async () => {
    const docId = "doc-supersede-scoped-kind";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );
    const realCtx = createEngineContextWithRealBus();
    await engine.init(realCtx);
    await engine.loadDocument(docId, createValidBuffer());

    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      kind: "original",
      scale: 2,
    });

    // registerPendingRender corre síncrono dentro de handleRenderRequested,
    // antes de despachar el batch async — el estado ya es observable acá.
    // Es la implementación mecánica incorrecta lo que este test previene:
    // registrar TAMBIÉN "anonymized" "porque antes se registraban los dos".
    expect(engine["pendingRenders"].has(`${docId}:0:original`)).toBe(true);
    expect(engine["pendingRenders"].has(`${docId}:0:anonymized`)).toBe(false);
  });

  it("an in-flight anonymized render is not aborted by an original request at another scale", async () => {
    const docId = "doc-cross-kind-immune";
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

    // A: el panel "anonymized" pide render a escala 1 — queda en vuelo,
    // bloqueado esperando la promesa de render().
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      kind: "anonymized",
      scale: 1,
    });

    await vi.waitFor(() => {
      expect(renderSpy).toHaveBeenCalled();
    });

    // B: el OTRO panel ("original") pide la misma página a otra escala.
    // ADR-056 §4: el supersede se registra solo para "original" — NO debe
    // abortar el render "anonymized" en vuelo de A. Antes de este fix, B
    // también registraba una entrada de supersede para "anonymized" y
    // abortaba a A espuriamente — exactamente el error que ADR-056 §4 previene.
    realCtx.bus.emit(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
      documentId: docId,
      pageIndices: [0],
      mode: "preview",
      kind: "original",
      scale: 2,
    });

    resolvePage0Render?.();

    await vi.waitFor(() => {
      const anonymizedUpdates = previewUpdates.filter(
        (u) => u.pageIndex === 0 && u.kind === "anonymized",
      );
      expect(anonymizedUpdates).toHaveLength(1);
    });
  });

  // ─── ADR-055 §5 — sobre del dispatch/broadcast: forma no reconocida ───
  //
  // Un `RenderJobPool.dispatch()`/`broadcast()` que resuelve una forma no
  // reconocida (ni remota ni in-process — en este motor son la misma forma,
  // así que cualquier otra cosa es simplemente inválida) tiene que lanzar en
  // vez de devolver un default en silencio (`[]`/`undefined`/una `ImageData`
  // vacía). Decisión de este motor (ver la sección "ADR-055" del comentario
  // de cabecera de `render.engine.ts`): las fallas de decodificación de
  // `renderPage`/`rasterizePage` se tratan como un fallo más de ESA página
  // (`RenderPageFailedError`, mismo camino que "PDF.js lanza, OOM en
  // canvas") — no abortan `renderPages` entero, mismo criterio que
  // `ocr-engine`. La de `loadDocument` (`RenderFailedError`) sí aborta la
  // carga completa del documento — ahí no hay noción de "página" que
  // tolerar.
  describe("Sobre del dispatch/broadcast: forma no reconocida (ADR-055 §5)", () => {
    beforeEach(() => {
      vi.mocked(getDocument).mockReturnValue(
        mockGetDocumentResult(createMockPdfDocument({ pageCount: 3 })),
      );
    });

    it("renderPage throws RenderPageFailedError for each garbage dispatch result (never a silent default)", async () => {
      const garbageValues: ReadonlyArray<unknown> = [{}, null, "not-a-recognized-shape"];

      for (const garbage of garbageValues) {
        const pool = createResolvedRenderDispatchPool(garbage);
        const pooledEngine = new RenderEngine(pool);
        await pooledEngine.init(ctx);
        await pooledEngine.loadDocument("doc-garbage-render", createValidBuffer());

        const rejection: unknown = await pooledEngine
          .renderPage(
            createRenderPageInput({ documentId: "doc-garbage-render", pageIndex: 0 }),
            ctx,
          )
          .catch((err: unknown) => err);

        expect(rejection).toBeInstanceOf(RenderPageFailedError);
        // Prueba de regresión real (Validación del ADR-055: "revirtiendo el
        // decoder, ese test tiene que fallar"): el mensaje tiene que venir
        // específicamente de `decodeKernelRenderResult`, no de un TypeError
        // accidental al desestructurar `imageData`/`encoded` de un valor
        // mal formado.
        expect((rejection as RenderPageFailedError).message).toContain(
          "RenderJobPool.dispatch() resolvió con una forma no reconocida",
        );

        await pooledEngine.dispose();
      }
    });

    // Regresión de referencia (mismo criterio que Code_Standards.md §7,
    // párrafo final, para el canal de errores): un test que solo verifica
    // "se lanza algo" pasa igual con el bug vivo, porque un cast ciego sobre
    // una forma parcialmente válida no siempre explota con una excepción.
    // Acá: un `ImageData` sin `width` — `isImageData` lo rechaza por el
    // guard de tipo explícito, no porque leer `.width` lance.
    it("renderPage throws even when the malformed shape would NOT crash a blind destructure (ImageData without width, ADR-055 §3)", async () => {
      const pool = createResolvedRenderDispatchPool({
        imageData: { data: new Uint8ClampedArray(4), height: 1, colorSpace: "srgb" },
        encoded: { bytes: new ArrayBuffer(1), format: "png", widthPx: 1, heightPx: 1 },
      });
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-garbage-partial-render", createValidBuffer());

      await expect(
        pooledEngine.renderPage(
          createRenderPageInput({ documentId: "doc-garbage-partial-render", pageIndex: 0 }),
          ctx,
        ),
      ).rejects.toBeInstanceOf(RenderPageFailedError);

      await pooledEngine.dispose();
    });

    it("renderPages treats the decode failure as a tolerable page failure and continues (mismo criterio que ocr-engine, ADR-055)", async () => {
      const pool = createResolvedRenderDispatchPool("not-a-recognized-shape");
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-garbage-batch-render", createValidBuffer());
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const outputs = await pooledEngine.renderPages(
        [
          createRenderPageInput({ documentId: "doc-garbage-batch-render", pageIndex: 0 }),
          createRenderPageInput({ documentId: "doc-garbage-batch-render", pageIndex: 1 }),
        ],
        ctx,
      );

      expect(outputs).toEqual([]);
      const pageFailedCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.PREVIEW_PAGE_FAILED,
      );
      expect(pageFailedCalls.length).toBe(2);
      // RENDER_FAILED (fatal de batch) NUNCA se emite para un dispatch que
      // no se pudo decodificar: no es "no recuperable, aborta el batch" — es
      // un fallo puntual, retryable, de cada página.
      expect(busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.RENDER_FAILED)).toBe(
        false,
      );
      // RENDER_FINISHED sigue emitiéndose al final del batch: el documento
      // no se cuelga, aunque ninguna página haya producido una imagen real.
      expect(
        busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.RENDER_FINISHED),
      ).toBe(true);

      await pooledEngine.dispose();
    });

    it("rasterizePage throws RenderPageFailedError for each garbage dispatch result (never a silent default)", async () => {
      const garbageValues: ReadonlyArray<unknown> = [{}, null, "not-a-recognized-shape"];

      for (const garbage of garbageValues) {
        const pool = createResolvedRenderDispatchPool(garbage);
        const pooledEngine = new RenderEngine(pool);
        await pooledEngine.init(ctx);
        await pooledEngine.loadDocument("doc-garbage-rasterize", createValidBuffer());

        const rejection: unknown = await pooledEngine
          .rasterizePage("doc-garbage-rasterize", 0, 1, ctx)
          .catch((err: unknown) => err);

        expect(rejection).toBeInstanceOf(RenderPageFailedError);
        expect((rejection as RenderPageFailedError).message).toContain(
          "RenderJobPool.dispatch() resolvió con una forma no reconocida",
        );

        await pooledEngine.dispose();
      }
    });

    it("rasterizePage throws even when the malformed shape would NOT crash a blind destructure (ImageData without height, ADR-055 §3)", async () => {
      const pool = createResolvedRenderDispatchPool({
        data: new Uint8ClampedArray(4),
        width: 2,
        colorSpace: "srgb",
      });
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);
      await pooledEngine.loadDocument("doc-garbage-partial-rasterize", createValidBuffer());

      await expect(
        pooledEngine.rasterizePage("doc-garbage-partial-rasterize", 0, 1, ctx),
      ).rejects.toBeInstanceOf(RenderPageFailedError);

      await pooledEngine.dispose();
    });

    it("loadDocument throws RenderFailedError for each garbage broadcast result (never a silent default)", async () => {
      const garbageValues: ReadonlyArray<unknown> = [{}, null, "not-a-recognized-shape"];

      for (const garbage of garbageValues) {
        const pool = createResolvedRenderBroadcastPool([garbage]);
        const pooledEngine = new RenderEngine(pool);
        await pooledEngine.init(ctx);

        const rejection: unknown = await pooledEngine
          .loadDocument("doc-garbage-load", createValidBuffer())
          .catch((err: unknown) => err);

        expect(rejection).toBeInstanceOf(RenderFailedError);
        expect((rejection as RenderFailedError).message).toContain(
          "RenderJobPool.broadcast() resolvió load-document con una forma no reconocida",
        );
        // El documento nunca queda retenido con una forma inválida.
        expect(pooledEngine["documents"].has("doc-garbage-load")).toBe(false);

        await pooledEngine.dispose();
      }
    });

    it("loadDocument throws even when the malformed shape would NOT crash a blind destructure (pageCount as string, ADR-055 §3)", async () => {
      // Sin decoder, `result.pageCount` ("7", un string) pasaría intacto a
      // `RetainedDocument.pageCount` (tipado `number`, pero JS no lo valida
      // en runtime) y cualquier guard posterior de `pageIndex < doc.pageCount`
      // se comportaría de forma impredecible (comparación number < string) —
      // exactamente la clase de corrupción silenciosa que ADR-055 prohíbe.
      const pool = createResolvedRenderBroadcastPool([{ pageCount: "7" }]);
      const pooledEngine = new RenderEngine(pool);
      await pooledEngine.init(ctx);

      await expect(
        pooledEngine.loadDocument("doc-garbage-partial-load", createValidBuffer()),
      ).rejects.toBeInstanceOf(RenderFailedError);

      await pooledEngine.dispose();
    });
  });
});
