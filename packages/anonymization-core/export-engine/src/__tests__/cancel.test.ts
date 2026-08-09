/**
 * Cancelación cooperativa (Export_Engine.md §12: "Cancelación: entre páginas.
 * SLA < 200 ms. El PDFDocument parcial se descarta."; ADR-021 §1: el SLA
 * estricto se valida en Hito 9/11, pero el checkpoint cooperativo ya se
 * implementa acá). Mismo patrón de estructura que render-engine/src/__tests__/cancel.test.ts.
 */
import { CancelledError, EngineEvents, type EngineContext } from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";
import type { EncodedPageImage, RenderPageProvider } from "../export.types.js";

import {
  asPdfDocument,
  createDocumentWithPageCount,
  createEngineContext,
  createExportEngineInput,
  createMockPdfLibDocument,
} from "./fixtures/test-helpers.js";

const SAMPLE_IMAGE: EncodedPageImage = {
  bytes: new Uint8Array([1, 2, 3, 4]).buffer,
  format: "jpeg",
  widthPx: 100,
  heightPx: 100,
};

describe("ExportEngine — cancellation", () => {
  let engine: ExportEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ExportEngine();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("cancel within 200ms", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));

    let resolvePage0: ((image: EncodedPageImage) => void) | undefined;
    const page0Promise = new Promise<EncodedPageImage>((resolve) => {
      resolvePage0 = resolve;
    });
    const renderFull = vi.fn((pageIndex: number) => {
      if (pageIndex === 0) return page0Promise;
      return Promise.resolve(SAMPLE_IMAGE);
    });
    // includeMarkerLegend es false por defecto (createExportOptions): renderLegend
    // nunca debería invocarse en este test — el reject explícito lo demuestra.
    const provider: RenderPageProvider = {
      renderFull,
      renderLegend: vi.fn(() =>
        Promise.reject(new Error("renderLegend no debería invocarse en este test")),
      ),
    };

    const abortController = new AbortController();
    const cancelCtx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(cancelCtx);

    const exportPromise = engine.export(
      createExportEngineInput({
        document: createDocumentWithPageCount(3),
        renderPageProvider: provider,
      }),
      cancelCtx,
    );

    // Espera a que el render de la página 0 haya arrancado y quede bloqueado
    // esperando `page0Promise`.
    await vi.waitFor(() => {
      expect(renderFull).toHaveBeenCalledTimes(1);
    });

    const startedAt = Date.now();
    abortController.abort();
    resolvePage0?.(SAMPLE_IMAGE);

    await expect(exportPromise).rejects.toThrow(CancelledError);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(200);
    // El checkpoint cooperativo corta apenas se resuelve la página 0, antes
    // de tocar pdf-lib y antes de pedir la página 1.
    expect(renderFull).toHaveBeenCalledTimes(1);
    expect(mockDoc["addPage"]).not.toHaveBeenCalled();
  });

  it("export throws CancelledError immediately when abortSignal is already aborted", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));
    const abortController = new AbortController();
    const ctx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(ctx);
    abortController.abort();

    const startedAt = Date.now();
    await expect(engine.export(createExportEngineInput(), ctx)).rejects.toThrow(CancelledError);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("cancel between pages discards the in-progress PDFDocument (no EXPORT_FINISHED)", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));

    const abortController = new AbortController();
    const cancelCtx: EngineContext = createEngineContext({ abortSignal: abortController.signal });
    await engine.init(cancelCtx);
    const emitSpy = vi.spyOn(cancelCtx.bus, "emit");

    let pagesRendered = 0;
    const renderFull = vi.fn(() => {
      pagesRendered++;
      if (pagesRendered === 2) abortController.abort();
      return Promise.resolve(SAMPLE_IMAGE);
    });

    await expect(
      engine.export(
        createExportEngineInput({
          document: createDocumentWithPageCount(5),
          renderPageProvider: {
            renderFull,
            renderLegend: vi.fn(() =>
              Promise.reject(new Error("renderLegend no debería invocarse en este test")),
            ),
          },
        }),
        cancelCtx,
      ),
    ).rejects.toThrow(CancelledError);

    expect(emitSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      EngineEvents.EXPORT_FINISHED,
      expect.anything(),
    );
  });
});
