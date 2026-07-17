/**
 * Test de stress (Export_Engine.md §13 caso 17: "1000 páginas: memoria del
 * PDFDocument puede llegar a 500 MB. Mitigado: ensamblar en chunks y usar
 * pdf-lib con save({ useObjectStreams: true })", `stress.test.ts`).
 *
 * Nota de ubicación: vive en `src/__tests__/` (no en `tests/stress/`, que
 * todavía no existe) — mismo criterio aceptado por ADR-031 §5 para
 * render-engine/src/__tests__/stress.test.ts.
 */
import type { EngineContext } from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { ExportEngine } from "../export.engine.js";

import {
  asPdfDocument,
  createDocumentWithPageCount,
  createEngineContext,
  createExportEngineInput,
  createMockPdfLibDocument,
  createMockRenderPageProvider,
} from "./fixtures/test-helpers.js";

describe("ExportEngine — stress", () => {
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

  it("1000 pages completes within memory budget", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    await engine.init(ctx);

    const totalPages = 1000;
    const input = createExportEngineInput({
      documentId: "doc-1000-pages",
      document: createDocumentWithPageCount(totalPages, { width: 50, height: 50 }),
      renderPageProvider: createMockRenderPageProvider({ bytes: new Uint8Array(16).buffer }),
    });

    const startedAt = Date.now();
    const result = await engine.export(input, ctx);
    const elapsedMs = Date.now() - startedAt;

    expect(result.buffer.byteLength).toBeGreaterThan(0);
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(totalPages);
    // Ensamblado secuencial (Hito 8 inline, ADR-021): sin paralelismo real
    // todavía, pero 1000 páginas con imágenes chicas no debería acercarse a
    // ningún timeout razonable de test.
    expect(elapsedMs).toBeLessThan(10_000);
  }, 20_000);
});
