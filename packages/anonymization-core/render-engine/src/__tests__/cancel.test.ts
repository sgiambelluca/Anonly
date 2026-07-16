/**
 * Cancelación cooperativa (Render_Engine.md §12: "entre operaciones de Canvas
 * (fill, drawImage, convertToBlob). SLA < 200 ms"; ADR-021 §1: el SLA
 * estricto se valida en Hito 9/11, pero el checkpoint cooperativo ya se
 * implementa acá — `ctx.abortSignal.aborted` se chequea entre páginas de un
 * batch y entre operaciones de canvas dentro de una página). Mismo patrón de
 * estructura que grouping-engine/src/__tests__/cancel.test.ts.
 */
import { CancelledError, type EngineContext } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));

import { RenderEngine } from "../render.engine.js";

import {
  createEngineContext,
  createMockPage,
  createMockPdfDocument,
  createRenderPageInput,
  createValidBuffer,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  resetCreatedCanvases,
} from "./fixtures/test-helpers.js";

describe("RenderEngine — cancellation", () => {
  let engine: RenderEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
    resetCreatedCanvases();
    engine = new RenderEngine();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("cancel within 200ms", async () => {
    const docId = "doc-cancel";
    let resolvePage0Render: (() => void) | undefined;
    const page0RenderPromise = new Promise<void>((resolve) => {
      resolvePage0Render = resolve;
    });

    const mockDoc = createMockPdfDocument({
      pageCount: 3,
      pageFactory: (pageIndex) => {
        if (pageIndex === 0) {
          return {
            getViewport: vi.fn(() => ({ width: 100, height: 100 })),
            render: vi.fn(() => ({ promise: page0RenderPromise })),
          };
        }
        return createMockPage({ width: 100, height: 100 });
      },
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    const abortController = new AbortController();
    const cancelCtx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(cancelCtx);
    await engine.loadDocument(docId, createValidBuffer());

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    const renderPromise = engine.renderPages(
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
        createRenderPageInput({
          documentId: docId,
          pageIndex: 2,
          kind: "original",
          mode: "preview",
        }),
      ],
      cancelCtx,
    );

    // Espera a que el render de la página 0 haya arrancado (getPage ya se
    // llamó) y quede bloqueado esperando `page0RenderPromise`.
    await vi.waitFor(() => {
      expect(getPageSpy).toHaveBeenCalledTimes(1);
    });

    const startedAt = Date.now();
    abortController.abort();
    resolvePage0Render?.();

    await expect(renderPromise).rejects.toThrow(CancelledError);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(200);
    // El checkpoint cooperativo corta antes de pedir la página 1: getPage
    // nunca se llama para las páginas 1/2.
    expect(getPageSpy).toHaveBeenCalledTimes(1);
  });

  it("renderPage throws CancelledError immediately when abortSignal is already aborted", async () => {
    const docId = "doc-already-aborted";
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 1 })),
    );

    const abortController = new AbortController();
    const ctx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    abortController.abort();

    const startedAt = Date.now();
    await expect(
      engine.renderPage(createRenderPageInput({ documentId: docId, pageIndex: 0 }), ctx),
    ).rejects.toThrow(CancelledError);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });
});
