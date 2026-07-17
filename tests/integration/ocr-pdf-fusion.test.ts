/**
 * Integración (Hito 9, ADR-034 §6, par crítico "b"): `OCR_PAGE_FINISHED` →
 * Orchestrator → `PdfEngine.fuseOcrPage` (ADR-014), con `createCore()` real
 * (los 7 motores reales) y solo las fronteras pesadas mockeadas (ADR-021 §5):
 * `pdfjs-dist` (PdfEngine + RenderEngine), `tesseract.js` (OcrEngine) y
 * `@huggingface/transformers` (NerEngine, aunque NER queda desactivado acá:
 * se mockea igual por higiene de import, mismo criterio que los tests
 * propios de ner-engine).
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { EngineEvents, EventChannel, PipelineStage } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest hoistea vi.mock() por encima de todos los imports (incluido
// @anonly/anonymization-core más arriba): el orden textual acá es solo
// legibilidad (mismo criterio que pdf-engine/render-engine/ocr-engine), no
// afecta qué versión (real o mockeada) de estas libs recibe createCore().
vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

import {
  createMockPdfDocument,
  createMockPdfPage,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  mockRecognizeData,
  mockTesseractWorker,
} from "./fixtures/mocks.js";

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

describe("integration — OCR_PAGE_FINISHED -> Orchestrator -> PdfEngine.fuseOcrPage", () => {
  let core: IAnonymizationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
  });

  afterEach(async () => {
    await core?.dispose();
  });

  it("fuses OCR words into the PdfEngine document for a textless page", async () => {
    // Página sin texto -> requiresOCR/textlessPages=[0] (ADR-034 §1).
    const textlessPage = createMockPdfPage([]);
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument([textlessPage])),
    );

    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Escaneado", confidence: 92, bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } },
        ]),
      ),
    );

    core = await createCore({
      ner: {
        modelId: "x",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: false,
      },
    });

    const fuseSpy = vi.spyOn(core.engines.pdf, "fuseOcrPage");
    const ocrPageFinishedSpy = vi.fn();
    core.bus.on(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, ocrPageFinishedSpy);

    await core.orchestrator.importDocument({
      documentId: "doc-ocr-fusion",
      name: "scanned.pdf",
      buffer: pdfBufferWithHeader(),
    });

    expect(ocrPageFinishedSpy).toHaveBeenCalled();
    expect(fuseSpy).toHaveBeenCalledWith(
      "doc-ocr-fusion",
      0,
      expect.arrayContaining([expect.objectContaining({ text: "Escaneado", source: "ocr" })]),
    );

    // El pipeline sigue hasta Ready con el texto fusionado (Regex/Grouping corren sobre él).
    expect(core.orchestrator.getState("doc-ocr-fusion").stage).toBe(PipelineStage.Ready);
  });
});
