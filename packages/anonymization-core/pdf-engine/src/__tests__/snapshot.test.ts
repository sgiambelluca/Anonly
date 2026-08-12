import { type EngineContext } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ADR-065 §1 (compuerta 1): el motor bajo prueba lee `OPS` real (save,
// restore, transform, paintImageXObject, ...); `importOriginal` lo preserva
// mientras solo `getDocument` queda mockeado.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});

import { PdfEngine } from "../pdf.engine.js";
import type { PdfEngineInput } from "../pdf.types.js";

import { createEngineContext, mockGetDocumentResult } from "./fixtures/test-helpers.js";

function buildSnapshotInput(): PdfEngineInput {
  const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const body = new Uint8Array(200).fill(0x41);
  const combined = new Uint8Array(pdfHeader.length + body.length);
  combined.set(pdfHeader, 0);
  combined.set(body, pdfHeader.length);

  return { documentId: "snapshot-doc", buffer: combined.buffer };
}

function createSnapshotPdfDocument(): Record<string, unknown> {
  return {
    numPages: 3,
    getPage: vi.fn((pageNum: number) => {
      const pages: Record<string, unknown>[] = [
        {
          getViewport: vi.fn(() => ({ width: 595, height: 842 })),
          getTextContent: vi.fn(() =>
            Promise.resolve({
              items: [
                { str: "First", transform: [1, 0, 0, 1, 50, 800], width: 30, height: 12 },
                { str: "Page", transform: [1, 0, 0, 1, 85, 800], width: 30, height: 12 },
              ],
            }),
          ),
          getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
        },
        {
          getViewport: vi.fn(() => ({ width: 612, height: 792 })),
          getTextContent: vi.fn(() =>
            Promise.resolve({
              items: [
                { str: "Second", transform: [1, 0, 0, 1, 50, 750], width: 40, height: 12 },
                { str: "Page", transform: [1, 0, 0, 1, 100, 750], width: 30, height: 12 },
                { str: "Content", transform: [1, 0, 0, 1, 140, 750], width: 50, height: 12 },
              ],
            }),
          ),
          getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
        },
        {
          getViewport: vi.fn(() => ({ width: 595, height: 842 })),
          getTextContent: vi.fn(() => Promise.resolve({ items: [] })),
          getOperatorList: vi.fn(() => Promise.resolve({ fnArray: [], argsArray: [] })),
        },
      ];
      return Promise.resolve(pages[pageNum - 1]);
    }),
    getMetadata: vi.fn(() =>
      Promise.resolve({
        info: { Title: "Snapshot Doc", Producer: "Test", Creator: "TestRunner" },
        metadata: undefined,
      }),
    ),
    getViewport: vi.fn(),
    destroy: vi.fn(),
    _pdfInfo: { encrypted: false, pdfVersion: "1.7" },
  };
}

describe("PdfEngine — snapshot", () => {
  let engine: PdfEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567_890_000);
    engine = new PdfEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("DocumentModel snapshot stable (3-page deterministic in-memory fixture, 1 textless)", async () => {
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createSnapshotPdfDocument()));

    await engine.init(ctx);
    const input = buildSnapshotInput();
    const output = await engine.process(input, ctx);

    expect(output).toMatchSnapshot();
  });
});
