/**
 * Integración (Hito 10.9, ADR-074 §Validación, PR 11): una entidad Persona
 * partida en dos líneas —"Pablo" cierra un renglón, "Roman" abre el
 * siguiente, el caso real medido en la pericia (ADR-074, Contexto §1)— de la
 * detección al canvas: dos rectángulos pintados, ninguno cubriendo el ancho
 * de la página.
 *
 * Por qué existe: ADR-074 §Contexto último párrafo (y `Render_Engine.md`
 * checklist ítem 29) — "los seis PRs de propagación no son opcionales ni
 * diferibles de a uno... con el 4 y el 5 mergeados y el 9 sin mergear, el
 * campo existe, se puebla y nadie lo pinta". Cada motor prueba su propio
 * eslabón (`mapSpanToWords` en `ner-engine`, la escalera en
 * `grouping-engine`, `buildPageReplacements` en `export-engine`,
 * `expandReplacementToUnits` en `render-engine`) por separado; este es el
 * único test que los recorre los cuatro seguidos y verifica que `fragments`
 * sobrevive de punta a punta — el mismo modo de falla que ADR-066 §6 dejó
 * pasar con todos los tests unitarios en verde.
 *
 * Motores reales (`NerEngine`, `GroupingEngine`, `RenderEngine`) + función
 * pura real (`buildPageReplacements`). Solo se mockean las fronteras pesadas
 * (ADR-021 §5): `@huggingface/transformers` y `pdfjs-dist` (esta última solo
 * para que `RenderEngine.loadDocument` tenga un documento que cargar — el
 * `Document`/`Page` de la detección se construye a mano, mismo criterio que
 * `regex-ner-grouping.test.ts`).
 */
import { createEventBus } from "@anonly/event-system";
import { buildPageReplacements } from "@anonly/export-engine";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { RenderEngine } from "@anonly/render-engine";
import {
  EntityType,
  type Document,
  type EngineConfig,
  type EngineContext,
  type ICache,
  type ILogger,
  type Page,
  type Word,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

import {
  asPipelineMock,
  createMockPdfDocument,
  createMockPdfPage,
  getCreatedCanvasCalls,
  installOffscreenCanvasStub,
  mockGetDocumentResult,
  mockTokenClassificationPipeline,
  resetCreatedCanvases,
} from "./fixtures/mocks.js";

function createLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createCache(): ICache {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: (key: string, value: unknown) => void store.set(key, value),
    delete: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    size: 0,
    bytes: 0,
  };
}

function createConfig(): EngineConfig {
  return {
    workerPool: {
      pdfPoolSize: 2,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 2,
      maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
      timeouts: {
        "pdf-parse": 30000,
        "ocr-page": 60000,
        "ner-page": 20000,
        "render-page": 10000,
        "export-page": 30000,
      },
      maxRetries: {
        "pdf-parse": 1,
        "ocr-page": 2,
        "ner-page": 1,
        "render-page": 1,
        "export-page": 1,
      },
      baseRetryDelayMs: 250,
      maxRetryDelayMs: 2000,
      cancelSlaMs: 200,
      idleDisposeMs: 60000,
    },
    pdf: { maxPageCount: 10000 },
    ner: {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
  };
}

/**
 * "Pablo" al final de un renglón (x=520, cerca del borde derecho de una
 * página de 595 pt), "Roman" al principio del siguiente (x=10, borde
 * izquierdo) — la misma geometría que Contexto §1 mide sobre la pericia
 * real ("Pablo" en x=524,4; "Román Fortes," en x=14,0).
 */
function createPage(): Page {
  const words: Word[] = [
    {
      text: "Pablo",
      bbox: { x: 520, y: 100, width: 40, height: 12 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    },
    {
      text: "Roman",
      bbox: { x: 10, y: 114, width: 45, height: 12 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    },
  ];
  return {
    index: 0,
    width: 595,
    height: 842,
    words,
    text: words.map((w) => w.text).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };
}

function createDocument(): Document {
  return {
    id: "doc-multiline-1",
    name: "multiline.pdf",
    pageCount: 1,
    pages: [createPage()],
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: Date.now(),
  };
}

function pdfBufferWithHeader(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

describe("integración — entidad partida en dos líneas: fragments de punta a punta (ADR-074)", () => {
  let ctx: EngineContext;
  let ner: NerEngine;
  let grouping: GroupingEngine;
  let render: RenderEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetCreatedCanvases();
    installOffscreenCanvasStub();

    ctx = {
      bus: createEventBus({ logger: createLogger() }),
      logger: createLogger(),
      cache: createCache(),
      abortSignal: new AbortController().signal,
      config: createConfig(),
    };

    ner = new NerEngine();
    grouping = new GroupingEngine();
    render = new RenderEngine();

    await ner.init(ctx);
    await grouping.init(ctx);
    await render.init(ctx);
  });

  afterEach(async () => {
    await ner.dispose();
    await grouping.dispose();
    await render.dispose();
  });

  it("paints two rectangles, neither spanning the page width", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline((text) => {
        const pabloIndex = text.indexOf("Pablo");
        const romanIndex = text.indexOf("Roman");
        if (pabloIndex < 0 || romanIndex < 0) return Promise.resolve([]);
        return Promise.resolve([
          { entity: "B-PER", score: 0.95, index: pabloIndex, word: "Pablo" },
          { entity: "I-PER", score: 0.93, index: romanIndex, word: "Roman" },
        ]);
      }),
    );

    const document = createDocument();
    grouping.startSession(document.id);

    const page = document.pages[0];
    if (page === undefined) throw new Error("fixture sin página 0");
    await ner.processPages(
      [{ documentId: document.id, pageIndex: 0, text: page.text, words: page.words }],
      ctx,
    );

    // ─── Eslabón 1: ner-engine — mapSpanToWords fragmenta por línea (PR 6) ───
    const snapshot = grouping.getSnapshot(document.id);
    const personGroup = snapshot.groups.find((g) => g.type === EntityType.Person);
    expect(personGroup, "la entidad partida tiene que producir un grupo de Persona").toBeDefined();
    expect(personGroup?.members).toHaveLength(1);

    const member = personGroup?.members[0];
    // ─── Eslabón 2: grouping-engine — toOccurrenceRef propaga fragments (PR 7) ───
    expect(member?.fragments).toHaveLength(2);
    const [fragA, fragB] = member?.fragments ?? [];
    // Ninguno de los dos fragmentos es más ancho que la propia palabra que
    // representa — la prueba de que NO es la envolvente de 595 pt disfrazada
    // de "fragmento".
    expect(fragA?.width).toBeLessThan(100);
    expect(fragB?.width).toBeLessThan(100);
    // La envolvente sí sigue siendo ancha —cubre desde x=10 hasta x=560—,
    // exactamente lo que hace que el bug preexistente (medir/pintar contra
    // ella) sea invisible a un test que solo mire `bbox`.
    expect(member?.bbox.width).toBeGreaterThan(500);

    // ─── Eslabón 3: export-engine — buildPageReplacements propaga fragments (PR 8) ───
    const replacements = buildPageReplacements(0, snapshot.groups);
    const replacement = replacements.find((r) => r.groupId === personGroup?.id);
    expect(replacement?.fragments).toHaveLength(2);

    // ─── Eslabón 4: render-engine — unidades de pintado por fragmento (PR 9) ───
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument([createMockPdfPage([])])),
    );
    await render.loadDocument(document.id, pdfBufferWithHeader());
    await render.renderPage(
      { documentId: document.id, pageIndex: 0, kind: "anonymized", mode: "preview", replacements },
      ctx,
    );

    const [calls] = getCreatedCanvasCalls();
    const fillRectCalls = calls?.filter((c) => c.op === "fillRect") ?? [];
    // Dos rectángulos tapados — uno por fragmento — nunca uno solo del
    // ancho de la envolvente (que sería la barra negra de Contexto §1).
    expect(fillRectCalls).toHaveLength(2);
    for (const call of fillRectCalls) {
      const width = call.args[2] as number;
      expect(width).toBeLessThan(100);
      expect(width).toBeLessThan(page.width); // nunca el ancho de la página (595pt)
    }

    // El token se pinta una sola vez, en el fragmento más ancho de los dos
    // (ADR-074 §5) — nunca dos veces ni en la envolvente.
    const fillTextCalls = calls?.filter((c) => c.op === "fillText") ?? [];
    expect(fillTextCalls).toHaveLength(1);
  });
});
