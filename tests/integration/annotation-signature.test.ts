/**
 * Integración (Hito 10.8, ADR-066 §Validación): un documento con una anotación
 * de firma produce grupo de **Persona** y de **Fecha**, con el bbox dentro del
 * `rect` de la anotación — y con `rotation` intacta hasta el `Replacement`.
 *
 * Por qué existe: el handoff del hito (`roadmap/Hito10.8_Handoff.md` §4)
 * documenta que la pérdida de `rotation` en `mapSpanToWords` llegó a prueba
 * manual **con todos los tests unitarios en verde**, precisamente porque nada
 * cubría la cadena `Word.bbox.rotation → Occurrence → Replacement` de punta a
 * punta. Los tests por motor verifican cada eslabón por separado; este
 * verifica que el campo sobrevive los cinco: `pdf-engine` (que lo puebla),
 * `regex-engine`/`ner-engine` (que lo propagan por la unión de bboxes),
 * `grouping-engine` (que lo pasa por referencia al miembro) y `export-engine`
 * (que arma el `Replacement` que el render consume).
 *
 * Motores reales vía `createCore()`; solo se mockean las fronteras pesadas
 * (ADR-021 §5): `pdfjs-dist` y `@huggingface/transformers`.
 */
import { createCore, type IAnonymizationCore } from "@anonly/anonymization-core";
import { buildPageReplacements } from "@anonly/export-engine";
import {
  EngineEvents,
  EntityType,
  EventChannel,
  type EntityGroup,
  type EntityGroupCreated,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { getDocument } from "pdfjs-dist";
import type * as PdfjsDist from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-065 §1: `pdf-engine` lee el `OPS` real a nivel de módulo; `importOriginal`
// lo preserva mientras solo `getDocument` queda mockeado.
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
  type MockSignatureAnnotation,
} from "./fixtures/mocks.js";

/*
 * La firma medida sobre la pericia real (ADR-066, Contexto §3): rect
 * [10,60,60,560], `beginAnnotation.transform` [1,0,0,1,10,60] y un giro
 * interno de 90° [0,1,-1,0,50,0]. Los runs se emiten con `setFont` + `moveText`
 * —el idioma normal de PDF— porque es el del documento original (ADR-066 §2,
 * corrección); `moveText` desplaza la COLUMNA, porque a 90° el eje de avance
 * del texto es el `y` de página.
 */
const SIGNATURE: MockSignatureAnnotation = {
  id: "72R",
  rect: [10, 60, 60, 560],
  transform: [1, 0, 0, 1, 10, 60],
  innerTransform: [0, 1, -1, 0, 50, 0],
  fontSize: 8,
  runs: [
    { offset: 0, text: "Echeverria, Marta" },
    { offset: 20, text: "Date: 07/07/2026" },
  ],
};

/** `rect` de la anotación en el espacio de `Word.bbox` (origen arriba-izquierda). */
const RECT_TOP_LEFT = { x: 10, y: 842 - 560, width: 50, height: 500 } as const;

function isInsideAnnotationRect(bbox: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): boolean {
  return (
    bbox.x >= RECT_TOP_LEFT.x &&
    bbox.y >= RECT_TOP_LEFT.y &&
    bbox.x + bbox.width <= RECT_TOP_LEFT.x + RECT_TOP_LEFT.width &&
    bbox.y + bbox.height <= RECT_TOP_LEFT.y + RECT_TOP_LEFT.height
  );
}

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

describe("integración — anotación de firma: Persona + Fecha con rotation hasta el Replacement", () => {
  let core: IAnonymizationCore;

  beforeEach(() => {
    vi.clearAllMocks();
    installOffscreenCanvasStub();
  });

  afterEach(async () => {
    await core?.dispose();
  });

  it("produce grupo de Persona y de Fecha con bbox dentro del rect y rotation 90", async () => {
    // Página sin texto de content stream: TODO el texto viene de la anotación,
    // que es exactamente el agujero que ADR-066 cerró (`getTextContent()` no
    // lee appearance streams).
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument([createMockPdfPage([], [], [SIGNATURE])])),
    );

    // ADR-067: los dos runs salen contiguos y en orden de avance, así que
    // `Page.text` es "Echeverria, Marta Date: 07/07/2026". Antes del ADR el
    // nombre llegaba disperso y NER no producía ninguna entidad.
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline((text) => {
        const apellido = text.indexOf("Echeverria,");
        const nombre = text.indexOf("Marta");
        if (apellido < 0 || nombre < 0) return Promise.resolve([]);
        return Promise.resolve([
          { entity: "B-PER", score: 0.95, index: apellido, word: "Echeverria," },
          { entity: "I-PER", score: 0.93, index: nombre, word: "Marta" },
        ]);
      }),
    );

    core = await createCore({
      ner: {
        modelId: "x",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 256,
        enabled: true,
      },
    });

    const groups: EntityGroup[] = [];
    core.bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, (payload) => {
      groups.push((payload as EntityGroupCreated).group);
    });

    await core.orchestrator.importDocument({
      documentId: "doc-firma",
      name: "pericia.pdf",
      buffer: pdfBufferWithHeader(),
    });

    const personGroup = groups.find((g) => g.type === EntityType.Person);
    const dateGroup = groups.find((g) => g.type === EntityType.Date);

    expect(personGroup, "la firma tiene que producir un grupo de Persona").toBeDefined();
    expect(dateGroup, "la firma tiene que producir un grupo de Fecha").toBeDefined();
    expect(dateGroup?.canonicalValue).toContain("07/07/2026");

    // ADR-066 §3: todo word de la anotación cae dentro de su `rect`.
    for (const group of [personGroup, dateGroup]) {
      for (const member of group?.members ?? []) {
        expect(isInsideAnnotationRect(member.bbox)).toBe(true);
      }
    }

    // ADR-066 §6 + los fixes de `mapSpanToWords`: el ángulo sobrevive la unión
    // de bboxes de la ocurrencia y el pase por Grouping.
    expect(personGroup?.members[0]?.bbox.rotation).toBe(90);
    expect(dateGroup?.members[0]?.bbox.rotation).toBe(90);

    // ADR-066 §7: y llega al `Replacement`, que es lo que el render consume
    // para decidir si pinta rotado. Este es el eslabón que ningún test por
    // motor cubría, y por el que el defecto llegó a prueba manual.
    const replacements = buildPageReplacements(0, groups);
    expect(replacements.length).toBeGreaterThanOrEqual(2);
    for (const replacement of replacements) {
      expect(replacement.bbox.rotation).toBe(90);
      expect(isInsideAnnotationRect(replacement.bbox)).toBe(true);
    }
  });
});
