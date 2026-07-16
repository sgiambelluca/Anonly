/**
 * Test de stress (Render_Engine.md §14: "1000 pages only render visible +
 * adjacent", `stress.test.ts` — spec sugiere `tests/stress/`, ver nota de
 * ubicación más abajo).
 *
 * Nota de ubicación: `tests/stress/` (raíz del repo) no tiene, a diferencia
 * de `tests/fixtures/` (que sí declara `pdf-lib` como devDependency propia
 * del root package.json para `generate.ts`), una dependencia raíz hacia
 * `pdfjs-dist` — pnpm no lo hoistea al `node_modules` de la raíz (se
 * verificó: solo existe en el store de pdf-engine/render-engine, que sí lo
 * declaran como dependency). Agregarlo al `package.json` raíz solo para este
 * test excede el alcance de un PR de un solo módulo (R-1/R-5) y no está
 * pedido por el spec. Este test vive en `src/__tests__/` (donde `pdfjs-dist`
 * SÍ resuelve, al ser dependency directa de este paquete) preservando el
 * mismo caso de prueba y el mismo nombre de test que exige la tabla §14.
 * Ubicación aceptada explícitamente por ADR-031 §5; se mueve a `tests/stress/`
 * cuando esa infra exista (Hito 9/11).
 */
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

describe("RenderEngine — stress", () => {
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

  it("1000 pages only render visible + adjacent", async () => {
    const docId = "doc-1000-pages";
    const totalPages = 1000;
    const mockDoc = createMockPdfDocument({
      pageCount: totalPages,
      pageFactory: () => createMockPage({ width: 100, height: 100 }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    const ctx = createEngineContext();
    await engine.init(ctx);
    await engine.loadDocument(docId, createValidBuffer());

    const getPageSpy = mockDoc["getPage"] as ReturnType<typeof vi.fn>;

    // Virtualización (spec §12): el host/caller solo pide render de las
    // páginas visibles + 1 antes + 1 después — nunca las 1000 completas.
    const visiblePageIndex = 500;
    const requestedIndices = [visiblePageIndex - 1, visiblePageIndex, visiblePageIndex + 1];

    await engine.renderPages(
      requestedIndices.map((pageIndex) =>
        createRenderPageInput({ documentId: docId, pageIndex, kind: "original", mode: "preview" }),
      ),
      ctx,
    );

    expect(getPageSpy).toHaveBeenCalledTimes(3);
    for (const pageIndex of requestedIndices) {
      expect(getPageSpy).toHaveBeenCalledWith(pageIndex + 1);
    }
    // Ninguna página fuera del rango visible +/-1 se renderizó.
    expect(getPageSpy).not.toHaveBeenCalledWith(1);
    expect(getPageSpy).not.toHaveBeenCalledWith(totalPages);
  });
});
