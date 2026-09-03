/**
 * Integración (Hito 9, ADR-034 §6, par crítico "b"): `OCR_PAGE_FINISHED` →
 * Orchestrator → `fuseOcrPage` (ADR-014), con `createCore()` real (los 7
 * motores reales) y solo las fronteras pesadas mockeadas (ADR-021 §5):
 * `pdfjs-dist` (PdfEngine + RenderEngine), `tesseract.js` (OcrEngine) y
 * `@huggingface/transformers` (NerEngine, aunque NER queda desactivado acá:
 * se mockea igual por higiene de import, mismo criterio que los tests
 * propios de ner-engine).
 *
 * ADR-041: `fuseOcrPage` pasa a ser una función pura sin instancia (no un
 * método espiable de `PdfEngine`); la fusión corre host-side, síncrona, en
 * el Orchestrator. Este test verifica el efecto observable en vez de espiar
 * la llamada: el texto OCR fusionado ("34.567.891", un DNI) llega al
 * `Document` que Regex procesa a continuación, y Grouping crea el grupo
 * correspondiente — prueba de caja negra de que la fusión realmente ocurrió.
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { EngineEvents, EventChannel, PipelineStage, type EntityFound } from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest hoistea vi.mock() por encima de todos los imports (incluido
// @anonly/anonymization-core más arriba): el orden textual acá es solo
// legibilidad (mismo criterio que pdf-engine/render-engine/ocr-engine), no
// afecta qué versión (real o mockeada) de estas libs recibe createCore().
// ADR-065 §1 (compuerta 1): `pdf-engine` lee el `OPS` real de pdfjs-dist a
// nivel de módulo para reconocer los ops de pintado de imagen. Un mock que
// solo exponga `getDocument` lo deja sin `OPS` y el motor revienta al
// importarse; `importOriginal` preserva el resto del módulo.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  // ADR-112 §1: el kernel de OCR lee `PSM.SPARSE_TEXT` a nivel de módulo.
  PSM: { AUTO: "3", SPARSE_TEXT: "11" },
  // ADR-119 §1: el kernel lee `OEM.TESSERACT_ONLY` al crear el worker de OSD.
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
}));
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

  it("fuses OCR words into the retained Document so Regex/Grouping detect them", async () => {
    // Página sin texto -> requiresOCR/textlessPages=[0] (ADR-034 §1).
    const textlessPage = createMockPdfPage([]);
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument([textlessPage])),
    );

    // "34.567.891" matchea el patrón DNI de regex-engine (\b\d{1,2}\.?\d{3}\.?\d{3}\b) —
    // prueba observable de que el texto OCR llegó al Document que Regex procesa.
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "34.567.891", confidence: 92, bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } },
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

    const ocrPageFinishedSpy = vi.fn();
    core.bus.on(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, ocrPageFinishedSpy);
    const groupCreatedSpy = vi.fn();
    core.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, groupCreatedSpy);
    const entityFoundSpy = vi.fn();
    core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, entityFoundSpy);

    await core.orchestrator.importDocument({
      documentId: "doc-ocr-fusion",
      name: "scanned.pdf",
      buffer: pdfBufferWithHeader(),
    });

    expect(ocrPageFinishedSpy).toHaveBeenCalled();
    expect(groupCreatedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-ocr-fusion",
        group: expect.objectContaining({ canonicalValue: "34.567.891" }),
      }),
    );

    // ADR-064: la ocurrencia detectada sobre el texto fusionado tiene que quedar
    // en PUNTOS de página, no en píxeles del raster. El bbox mockeado es
    // (10,10)-(100,30) px y el default de OCR es 300 DPI, así que el factor es
    // 72/300 = 0.24. Regex arma el bbox de la ocurrencia como unión de los
    // Word.bbox que la cubren, y acá la cubre una sola palabra. Antes de
    // ADR-064 este test pasaba con cualquier espacio de coordenadas: no
    // verificaba ninguno.
    expect(entityFoundSpy).toHaveBeenCalled();
    const found = entityFoundSpy.mock.calls
      .map(([payload]) => payload as EntityFound)
      .find((p) => p.occurrence.value === "34.567.891");
    expect(found).toBeDefined();
    expect(found!.occurrence.bbox.x).toBeCloseTo(2.4, 5);
    expect(found!.occurrence.bbox.y).toBeCloseTo(2.4, 5);
    expect(found!.occurrence.bbox.width).toBeCloseTo(21.6, 5);
    expect(found!.occurrence.bbox.height).toBeCloseTo(4.8, 5);

    // El pipeline sigue hasta Ready con el texto fusionado (Regex/Grouping corren sobre él).
    expect(core.orchestrator.getState("doc-ocr-fusion").stage).toBe(PipelineStage.Ready);
  });
});
