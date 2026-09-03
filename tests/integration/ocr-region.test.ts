/**
 * Integración (ADR-065, Validación): la cadena COMPLETA del OCR por región,
 * con `createCore()` real (los 7 motores reales) y solo las fronteras pesadas
 * mockeadas (ADR-021 §5): `pdfjs-dist`, `tesseract.js` y
 * `@huggingface/transformers`.
 *
 * Es el único test del Hito 10.8 que ejercita las siete piezas juntas —
 * compuerta 1 (`getOperatorList`) → compuerta 2 (rectángulo vacío) →
 * `rasterizePage` con recorte → OCR → conversión px→pt (ADR-064) →
 * traslación por el origen de la región (`fuseOcrRegion`, ADR-065 §6) →
 * Regex → Grouping. Cada una tiene sus tests unitarios contra una frontera
 * mockeada; las costuras entre ellas solo se ven acá.
 *
 * El escenario reproduce la geometría del documento real que motivó el ADR:
 * una página con texto nativo en el encabezado y una imagen de 449×599 pt
 * en (142, 186) cuyo interior ningún texto explica. El dato sensible existe
 * ÚNICAMENTE dentro de esa imagen: si la cadena se corta en cualquier punto,
 * no aparece ningún grupo.
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import {
  EngineEvents,
  EventChannel,
  PipelineStage,
  type BoundingBox,
  type EntityFound,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-065 §1: `pdf-engine` lee el `OPS` real a nivel de módulo; `importOriginal`
// lo preserva mientras solo `getDocument` queda mockeado.
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

const PAGE_HEIGHT = 842;
const OCR_DPI = 300; // default de EngineConfig; el factor px→pt es 72/300 = 0.24
const PX_TO_PT = 72 / OCR_DPI;

/** Imagen en espacio de usuario PDF; equivale a (142, 186, 449, 599) arriba-izquierda. */
const IMAGE_USER_SPACE = { x: 142, y: PAGE_HEIGHT - 186 - 599, width: 449, height: 599 };
const IMAGE_TOP_LEFT: BoundingBox = { x: 142, y: 186, width: 449, height: 599 };

/**
 * Palabra que Tesseract "lee" dentro del RECORTE, en píxeles del recorte.
 * 300×60 px → 72×14.4 pt tras la conversión de ADR-064.
 */
const OCR_WORD_PX = { x0: 100, y0: 200, x1: 400, y1: 260 };

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

describe("integración — OCR por región: imagen con texto que ningún texto nativo explica", () => {
  let core: IAnonymizationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
  });

  afterEach(async () => {
    await core?.dispose();
  });

  it("rescata el dato que sólo existe dentro de la imagen y lo ubica en coordenadas de página", async () => {
    // Texto nativo en el encabezado, FUERA de la imagen (la imagen ocupa
    // y ∈ [186, 785] arriba-izquierda; este item cae en y ≈ 30). Con esto la
    // página tiene texto nativo -> requiresOCR = false -> antes de ADR-065
    // jamás habría ido a OCR, y el dato de la imagen se exportaba en claro.
    // Lleva un DNI propio: es la sonda de que `fuseOcrRegion` CONCATENA y no
    // reemplaza (si reemplazara, este dato desaparecería de `Page.words` y
    // Regex no lo encontraría).
    const page = createMockPdfPage(
      [{ str: "Expediente DNI 11.222.333", x: 70, y: 800, width: 140, height: 12 }],
      [IMAGE_USER_SPACE],
    );
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument([page])));

    // El DNI existe SOLO acá: ninguna palabra nativa lo contiene.
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([{ text: "34.567.891", confidence: 92, bbox: OCR_WORD_PX }]),
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

    const entityFoundSpy = vi.fn();
    core.bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, entityFoundSpy);
    const groupCreatedSpy = vi.fn();
    core.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, groupCreatedSpy);

    // La región efectiva la decide la compuerta 2 sobre una grilla de 64×64, así
    // que su bbox está cuantizado: en vez de fijar números que dependen de esa
    // grilla, se captura lo que el Orchestrator realmente pidió rasterizar y se
    // afirma la RELACIÓN que garantiza el ADR.
    const rasterizeSpy = vi.spyOn(core.engines.render, "rasterizePage");

    await core.orchestrator.importDocument({
      documentId: "doc-ocr-region",
      name: "pericia.pdf",
      buffer: pdfBufferWithHeader(),
    });

    expect(core.orchestrator.getState("doc-ocr-region").stage).toBe(PipelineStage.Ready);

    // ─── 1. La cadena entera corrió: el dato de la imagen llegó a Grouping ───
    // Si cualquiera de las siete piezas falla, este assert es el que se cae.
    expect(groupCreatedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-ocr-region",
        group: expect.objectContaining({ canonicalValue: "34.567.891" }),
      }),
    );

    // ─── 2. Se rasterizó el RECORTE, no la página entera (ADR-065 §3) ───
    const found = entityFoundSpy.mock.calls
      .map(([payload]) => payload as EntityFound)
      .find((p) => p.occurrence.value === "34.567.891");
    expect(found).toBeDefined();

    expect(rasterizeSpy).toHaveBeenCalledTimes(1);
    const rawRegion = rasterizeSpy.mock.calls[0]?.[4];
    expect(rawRegion).toBeDefined();
    const region: BoundingBox = rawRegion!;
    expect(region.x).toBeGreaterThanOrEqual(IMAGE_TOP_LEFT.x - 1);
    expect(region.y).toBeGreaterThanOrEqual(IMAGE_TOP_LEFT.y - 1);
    expect(region.x + region.width).toBeLessThanOrEqual(
      IMAGE_TOP_LEFT.x + IMAGE_TOP_LEFT.width + 1,
    );
    expect(region.y + region.height).toBeLessThanOrEqual(
      IMAGE_TOP_LEFT.y + IMAGE_TOP_LEFT.height + 1,
    );
    const imageArea = IMAGE_TOP_LEFT.width * IMAGE_TOP_LEFT.height;
    expect((region.width * region.height) / imageArea).toBeGreaterThanOrEqual(0.4);

    // ─── 3. La ocurrencia quedó en coordenadas de PÁGINA ───
    // Tesseract devolvió píxeles del recorte; ADR-064 los pasó a puntos y
    // ADR-065 §6 los trasladó por el origen de la región. Sin la conversión el
    // bbox sería ~4,17× más grande; sin la traslación caería en el origen de
    // la página en vez de adentro de la imagen.
    const bbox = found!.occurrence.bbox;
    expect(bbox.x).toBeCloseTo(region.x + OCR_WORD_PX.x0 * PX_TO_PT, 4);
    expect(bbox.y).toBeCloseTo(region.y + OCR_WORD_PX.y0 * PX_TO_PT, 4);
    expect(bbox.width).toBeCloseTo((OCR_WORD_PX.x1 - OCR_WORD_PX.x0) * PX_TO_PT, 4);
    expect(bbox.height).toBeCloseTo((OCR_WORD_PX.y1 - OCR_WORD_PX.y0) * PX_TO_PT, 4);

    // Y cae DENTRO de la imagen, que es la comprobación de sentido común:
    // el dato estaba ahí y la caja de censura tiene que ir ahí.
    expect(bbox.x).toBeGreaterThanOrEqual(IMAGE_TOP_LEFT.x);
    expect(bbox.y).toBeGreaterThanOrEqual(IMAGE_TOP_LEFT.y);
    expect(bbox.x + bbox.width).toBeLessThanOrEqual(IMAGE_TOP_LEFT.x + IMAGE_TOP_LEFT.width);
    expect(bbox.y + bbox.height).toBeLessThanOrEqual(IMAGE_TOP_LEFT.y + IMAGE_TOP_LEFT.height);

    // ─── 4. El texto nativo sobrevivió: fuseOcrRegion CONCATENA (ADR-065 §6) ───
    // `fuseOcrPage` REEMPLAZA las palabras de la página. Si el ruteo hubiera
    // elegido esa función, el DNI del encabezado —que es texto nativo— habría
    // desaparecido de `Page.words` y Regex no lo habría encontrado. Que
    // aparezcan los DOS grupos es la prueba de que se concatenó.
    expect(groupCreatedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        group: expect.objectContaining({ canonicalValue: "11.222.333" }),
      }),
    );
  });
});
