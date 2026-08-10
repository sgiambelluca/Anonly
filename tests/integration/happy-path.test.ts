/**
 * Integración (Hito 9, ADR-034 §6, par crítico "c"): happy path completo
 * `createCore()` → `importDocument` → `PIPELINE_READY`, con los 7 motores
 * reales y solo las fronteras pesadas mockeadas (ADR-021 §5, mismo patrón
 * que usó Render en Hito 7 para pdfjs-dist): `pdfjs-dist` (documento con
 * texto, sin páginas sin texto — así no hace falta mockear `tesseract.js`
 * también) y `@huggingface/transformers` (NER activado).
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { EngineEvents, EventChannel, PipelineStage } from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest hoistea vi.mock() por encima de todos los imports (incluido
// @anonly/anonymization-core más arriba): el orden textual acá es solo
// legibilidad (mismo criterio que pdf-engine/render-engine/ner-engine), no
// afecta qué versión (real o mockeada) de estas libs recibe createCore().
// ADR-065 §1 (compuerta 1): `pdf-engine` lee el `OPS` real de pdfjs-dist a
// nivel de módulo para reconocer los ops de pintado de imagen. Un mock que
// solo exponga `getDocument` lo deja sin `OPS` y el motor revienta al
// importarse; `importOriginal` preserva el resto del módulo.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfjsDist>();
  return { ...actual, getDocument: vi.fn() };
});
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

import {
  asPipelineMock,
  createMockPdfDocument,
  createMockPdfPage,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  mockTokenClassificationPipeline,
} from "./fixtures/mocks.js";

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

describe("integration — createCore() -> importDocument -> PIPELINE_READY (happy path)", () => {
  let core: IAnonymizationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
  });

  afterEach(async () => {
    await core?.dispose();
  });

  it("reaches PIPELINE_READY for a text-only PDF with real engines end to end", async () => {
    const page = createMockPdfPage([
      { str: "DNI", x: 50, y: 800, width: 30, height: 12 },
      { str: "34.567.891", x: 90, y: 800, width: 60, height: 12 },
    ]);
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument([page])));
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    core = await createCore();

    const readySpy = vi.fn();
    const stageChangedSpy = vi.fn();
    core.bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);
    core.bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, stageChangedSpy);

    await core.orchestrator.importDocument({
      documentId: "doc-happy-path",
      name: "text.pdf",
      buffer: pdfBufferWithHeader(),
    });

    expect(readySpy).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-happy-path" }),
    );
    expect(core.orchestrator.getState("doc-happy-path").stage).toBe(PipelineStage.Ready);

    const stages = stageChangedSpy.mock.calls.map((call) => (call[0] as { stage: string }).stage);
    expect(stages).toEqual(
      expect.arrayContaining([
        PipelineStage.Importing,
        PipelineStage.Extracting,
        PipelineStage.Detecting,
      ]),
    );
  });
});
