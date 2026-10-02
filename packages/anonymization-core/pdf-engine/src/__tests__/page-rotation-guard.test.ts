/**
 * ADR-140 — una página con `/Rotate` (heredado o propio) que produce al
 * menos una palabra nativa bloquea el documento. `parsePage` mezcla el marco
 * de `viewport` (que ya aplicó la rotación) con el de `item.transform` (que
 * no); el error medido va de 130 a 268 pt en una página de 200×300, a veces
 * fuera de página (ADR-140, Contexto §1).
 *
 * Contención, no solución: ADR-141 es la que retira este guard por ángulo.
 */
import { EngineErrorCode, type EngineContext } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});

import { PdfEngine } from "../pdf.engine.js";
import { PdfPageRotatedError } from "../pdf.errors.js";

import {
  createEngineContext,
  createMockPage,
  createMockPdfDocument,
  createValidInput,
  mockGetDocumentResult,
  type MockAnnotationSpec,
} from "./fixtures/test-helpers.js";

describe("PdfEngine — página rotada con texto nativo (ADR-140)", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) await engine.dispose();
  });

  it.each([90, 180, 270])("rechaza una página con /Rotate %i y texto nativo", async (rotation) => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument(1, () =>
          createMockPage(0, undefined, [], undefined, [], [], undefined, rotation),
        ),
      ),
    );

    await engine.init(ctx);
    const err = await engine.process(createValidInput("doc-rotated"), ctx).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PdfPageRotatedError);
    if (!(err instanceof PdfPageRotatedError)) throw new Error("expected PdfPageRotatedError");
    // ADR-140 §1: solo documentId/pageIndex/rotation — nada de texto de la
    // página, nombre de archivo real ni contraseña.
    expect(err.code).toBe(EngineErrorCode.PDF_PAGE_ROTATED);
    expect(err.retryable).toBe(false);
    expect(err.details).toEqual({ documentId: "doc-rotated", pageIndex: 0, rotation });
  });

  it("no rechaza una página con rotate === 0 y texto nativo normal", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument(1, () => createMockPage(0))),
    );

    await engine.init(ctx);
    const output = await engine.process(createValidInput("doc-flat"), ctx);

    expect(output.document.pages[0]!.words.length).toBeGreaterThan(0);
  });

  it("no rechaza una página rotada SIN texto nativo — va entera por OCR (ADR-140 §3)", async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument(1, () => createMockPage(0, [], [], undefined, [], [], undefined, 90)),
      ),
    );

    await engine.init(ctx);
    const output = await engine.process(createValidInput("doc-scan-rotated"), ctx);
    const page = output.document.pages[0]!;

    expect(page.requiresOCR).toBe(true);
    expect(page.words).toHaveLength(0);
    expect(output.textlessPages).toEqual([0]);
  });

  it("rechaza una página rotada cuyo único texto nativo viene de una anotación", async () => {
    // Mismos valores medidos que "annotation text runs become words inside
    // the annotation rect" (unit.test.ts) — el rect y las transformaciones
    // que garantizan que el word cae dentro del rect de la anotación.
    const annotationSpec: MockAnnotationSpec = {
      id: "1R",
      rect: [10, 60, 60, 560],
      transform: [1, 0, 0, 1, 10, 60],
      innerOps: [
        { kind: "transform", matrix: [0, 1, -1, 0, 50, 0] },
        {
          kind: "textRun",
          textMatrix: [8, 0, 0, 8, 0, 42.66],
          glyphs: [
            { unicode: "A", width: 500 },
            { unicode: "B", width: 500 },
          ],
        },
      ],
    };

    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument(1, () =>
          createMockPage(0, [], [], undefined, [annotationSpec], [], undefined, 90),
        ),
      ),
    );

    await engine.init(ctx);
    const err = await engine
      .process(createValidInput("doc-rotated-annotation"), ctx)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PdfPageRotatedError);
  });

  it("una página rotada en cualquier posición aborta la extracción completa del documento", async () => {
    // La página 2 (última de 3) es la rotada — ADR-140 §3: un expediente con
    // una hoja apaisada al final no se exporta "con todas menos esa".
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(
        createMockPdfDocument(3, (i) =>
          i === 2
            ? createMockPage(i, undefined, [], undefined, [], [], undefined, 90)
            : createMockPage(i),
        ),
      ),
    );

    await engine.init(ctx);
    const err = await engine
      .process(createValidInput("doc-rotated-last-page"), ctx)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PdfPageRotatedError);
    if (!(err instanceof PdfPageRotatedError)) throw new Error("expected PdfPageRotatedError");
    expect(err.details.pageIndex).toBe(2);
  });
});
