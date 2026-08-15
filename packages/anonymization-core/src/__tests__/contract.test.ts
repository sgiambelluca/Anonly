import { ExportEngine } from "@anonly/export-engine";
import type { RenderPageProvider } from "@anonly/export-engine";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { OcrEngine } from "@anonly/ocr-engine";
import { PdfEngine } from "@anonly/pdf-engine";
import type { PdfEngineOutput } from "@anonly/pdf-engine";
import { RegexEngine } from "@anonly/regex-engine";
import { RenderEngine } from "@anonly/render-engine";
import {
  DetectionSource,
  EngineEvents,
  EntityType,
  EventChannel,
  PipelineStage,
  type Document,
  type EngineContext,
} from "@anonly/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LruCache } from "../cache.js";
import { createCore } from "../index.js";
import { PipelineOrchestrator } from "../orchestrator.js";

import {
  createDocument,
  createEngineConfig,
  createEntityGroup,
  createImageData,
  createImportInput,
  createMockEngines,
  createMockLogger,
  createPage,
  createPdfEngineOutput,
  createRealBus,
  createRenderPageOutput,
  createWord,
  wireHappyPathSpies,
} from "./fixtures/test-helpers.js";

/**
 * Setup para los tests de `addManualEntity` (ADR-061 §6, §10): a diferencia
 * de `wireHappyPathSpies` (mockea los 7 motores con respuestas canned), acá
 * `regex` y `grouping` quedan como instancias **reales**, inicializadas
 * sobre el mismo bus que el Orchestrator — sin eso no hay forma de verificar
 * "produce un grupo nuevo visible en el snapshot" ni el dedup por identidad
 * de ADR-038 §3: un `getSnapshot` mockeado no puede reproducir merge/dedup
 * real sin reimplementarlo en el mock. Los otros cinco motores (pdf, ocr,
 * ner, render, export) siguen mockeados: no aportan nada a estos tests y
 * `ner`/`ocr` reales exigen fronteras de librerías pesadas (tesseract,
 * onnxruntime) fuera de alcance acá. NER queda desactivado para simplificar
 * la cascada de auto-finish de la sesión de Grouping (ADR-034 §2).
 */
async function makeOrchestratorWithRealDetection(pdfOutput?: PdfEngineOutput): Promise<{
  readonly bus: ReturnType<typeof createRealBus>;
  readonly engines: ReturnType<typeof createMockEngines>;
  readonly orchestrator: PipelineOrchestrator;
}> {
  const bus = createRealBus();
  const logger = createMockLogger();
  const cache = new LruCache();
  const config = createEngineConfig({
    ner: {
      modelId: "x",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 1,
      enabled: false,
    },
  });
  const engines = createMockEngines();
  const output = pdfOutput ?? createPdfEngineOutput();

  vi.spyOn(engines.pdf, "process").mockResolvedValue(output);
  vi.spyOn(engines.pdf, "dispose").mockResolvedValue(undefined);
  vi.spyOn(engines.ocr, "processPages").mockResolvedValue([]);
  vi.spyOn(engines.ocr, "dispose").mockResolvedValue(undefined);
  vi.spyOn(engines.ner, "processPages").mockResolvedValue([]);
  vi.spyOn(engines.ner, "dispose").mockResolvedValue(undefined);
  vi.spyOn(engines.render, "loadDocument").mockResolvedValue(undefined);
  vi.spyOn(engines.render, "unloadDocument").mockResolvedValue(undefined);
  vi.spyOn(engines.render, "rasterizePage").mockResolvedValue(createImageData());
  vi.spyOn(engines.render, "renderPage").mockImplementation((input) =>
    Promise.resolve(
      createRenderPageOutput({
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        kind: input.kind,
      }),
    ),
  );
  vi.spyOn(engines.render, "dispose").mockResolvedValue(undefined);
  vi.spyOn(engines.export, "dispose").mockResolvedValue(undefined);

  const ctx: EngineContext = {
    bus,
    logger,
    cache,
    abortSignal: new AbortController().signal,
    config,
  };
  await engines.regex.init(ctx);
  await engines.grouping.init(ctx);

  const orchestrator = new PipelineOrchestrator({ bus, logger, cache, config, engines });
  return { bus, engines, orchestrator };
}

describe("Orchestrator — contract tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── createCore() façade ───

  it("createCore returns wired IAnonymizationCore", async () => {
    const core = await createCore();
    try {
      expect(core.bus).toBeDefined();
      expect(core.engines.pdf).toBeInstanceOf(PdfEngine);
      expect(core.engines.ocr).toBeInstanceOf(OcrEngine);
      expect(core.engines.regex).toBeInstanceOf(RegexEngine);
      expect(core.engines.ner).toBeInstanceOf(NerEngine);
      expect(core.engines.grouping).toBeInstanceOf(GroupingEngine);
      expect(core.engines.render).toBeInstanceOf(RenderEngine);
      expect(core.engines.export).toBeInstanceOf(ExportEngine);
      expect(core.orchestrator).toBeInstanceOf(PipelineOrchestrator);
    } finally {
      await core.dispose();
    }
  });

  // ─── Transporte de workers (Hito 10, ADR-036 §2, Contracts.md §3.5) ───

  it("createCore acepta runtime (CoreRuntimeOptions) sin romper el façade", async () => {
    const pdfFactory = vi.fn(() => ({
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      terminate: vi.fn(),
    }));
    const core = await createCore(undefined, { workers: { pdf: pdfFactory } });
    try {
      expect(core.bus).toBeDefined();
      expect(core.orchestrator).toBeInstanceOf(PipelineOrchestrator);
      // Los pools son perezosos (05_Worker_Architecture.md §8): sin
      // importDocument, la factory inyectada nunca se invoca todavía.
      expect(pdfFactory).not.toHaveBeenCalled();
    } finally {
      await core.dispose();
    }
  });

  it("createCore() sin runtime sigue siendo 100% in-process (comportamiento del Hito 9)", async () => {
    const core = await createCore();
    try {
      expect(core.orchestrator).toBeInstanceOf(PipelineOrchestrator);
    } finally {
      await core.dispose();
    }
  });

  // ─── Secuencia feliz ───

  it("importDocument emits DOCUMENT_IMPORTED then PIPELINE_STAGE_CHANGED", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const events: string[] = [];
    bus.on(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, () =>
      events.push("DOCUMENT_IMPORTED"),
    );
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, () =>
      events.push("PIPELINE_STAGE_CHANGED"),
    );

    await orchestrator.importDocument(createImportInput());

    expect(events[0]).toBe("DOCUMENT_IMPORTED");
    expect(events[1]).toBe("PIPELINE_STAGE_CHANGED");
  });

  it("pipeline reaches Ready on GROUPING_FINISHED", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    const readySpy = vi.fn();
    bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, readySpy);

    await orchestrator.importDocument(createImportInput());

    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    expect(readySpy).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1", groupCount: 0, conflictCount: 0 }),
    );
  });

  // ─── Casos 1/2 (OCR condicional) ───

  it("textless pages trigger OCR stage", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pages: [createPage({ index: 0, requiresOCR: true })],
      }),
      textlessPages: [0],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    // ADR-050 §4: `loadDocument` recibe el password retenido como tercer
    // argumento (`undefined` acá — el documento de este test no tiene uno,
    // `createImportInput()` no lo setea).
    expect(engines.render.loadDocument).toHaveBeenCalledWith(
      "doc-1",
      expect.any(ArrayBuffer),
      undefined,
    );
    expect(engines.render.rasterizePage).toHaveBeenCalledWith(
      "doc-1",
      0,
      expect.any(Number),
      expect.anything(),
    );
    expect(engines.ocr.processPages).toHaveBeenCalled();
  });

  it("no textless pages skip OCR stage", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus); // pdfOutput default: textlessPages: []
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(engines.ocr.processPages).not.toHaveBeenCalled();
    expect(engines.render.rasterizePage).not.toHaveBeenCalled();
  });

  // ─── Caso 1 (ADR-065 §4): ocrRegions por sí solo NO deja que la etapa se salte ───

  it("no textless pages but ocrRegions still runs the OCR stage (ADR-065 §4/§13 case 1)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const region = { pageIndex: 0, bbox: { x: 100, y: 50, width: 200, height: 300 } };
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pages: [createPage({ index: 0, requiresOCR: false })],
      }),
      // El documento que motivó el ADR: texto nativo en todas las páginas
      // (textlessPages vacío) pero una imagen que ningún texto explica.
      textlessPages: [],
      ocrRegions: [region],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    // ADR-065 §5: rasterizePage recibe el bbox de la región como quinto
    // argumento — es el recorte, no la página completa, lo que se manda a OCR.
    expect(engines.render.rasterizePage).toHaveBeenCalledWith(
      "doc-1",
      0,
      expect.any(Number),
      expect.anything(),
      region.bbox,
    );
    expect(engines.ocr.processPages).toHaveBeenCalled();
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
  });

  // ─── Mediación OCR→PDF (ADR-014) ───

  it("OCR_PAGE_FINISHED triggers fuseOcrPage with cached words", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const cache = new LruCache();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({ pages: [createPage({ index: 0, requiresOCR: true })] }),
      textlessPages: [0],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });

    const words = [
      {
        text: "hola",
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        pageIndex: 0,
        confidence: 0.9,
        source: "ocr" as const,
      },
    ];
    vi.spyOn(engines.ocr, "processPages").mockImplementation(async (inputs) => {
      cache.set(`ocr-words:${inputs[0]?.documentId}:${inputs[0]?.pageIndex}`, words);
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
        documentId: inputs[0]?.documentId ?? "",
        pageIndex: inputs[0]?.pageIndex ?? 0,
        wordCount: words.length,
        confidence: 0.9,
      });
      return inputs.map((i) => ({
        documentId: i.documentId,
        pageIndex: i.pageIndex,
        words,
        confidence: 0.9,
        durationMs: 1,
      }));
    });

    // ADR-041: fuseOcrPage ya no es un método espiable de PdfEngine (función
    // pura host-side); se verifica el efecto observable — Regex recibe el
    // Document ya fusionado (mediación ADR-014 intacta, solo cambia la forma
    // de la invocación).
    let regexInputDocument: Document | undefined;
    vi.spyOn(engines.regex, "process").mockImplementation((input) => {
      regexInputDocument = input.document;
      bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: input.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
      return Promise.resolve({
        documentId: input.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache,
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(regexInputDocument?.pages[0]?.words).toEqual(words);
    expect(regexInputDocument?.pages[0]?.ocrCompleted).toBe(true);
  });

  // ─── Enrutamiento de las dos formas de OCR (ADR-065) ───

  it("OCR_PAGE_FINISHED for a retained region triggers fuseOcrRegion (translated, concatenated with native words)", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const cache = new LruCache();
    const nativeWord = createWord({
      text: "visible",
      bbox: { x: 10, y: 10, width: 40, height: 12 },
    });
    const region = { pageIndex: 0, bbox: { x: 100, y: 50, width: 200, height: 300 } };
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({
        pages: [
          createPage({ index: 0, requiresOCR: false, words: [nativeWord], text: nativeWord.text }),
        ],
      }),
      // ADR-065 §4: la página tiene texto nativo (no está en textlessPages) y
      // trae una región candidata — el camino que este ADR agrega.
      textlessPages: [],
      ocrRegions: [region],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });

    // Palabra de OCR en puntos RELATIVOS al recorte (ADR-064 + ADR-065 §6):
    // fuseOcrRegion tiene que sumarle region.x/region.y.
    const ocrWord = createWord({
      text: "oculto",
      bbox: { x: 5, y: 5, width: 30, height: 12 },
      source: "ocr",
      confidence: 0.85,
    });
    vi.spyOn(engines.ocr, "processPages").mockImplementation(async (inputs) => {
      cache.set(`ocr-words:${inputs[0]?.documentId}:${inputs[0]?.pageIndex}`, [ocrWord]);
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
        documentId: inputs[0]?.documentId ?? "",
        pageIndex: inputs[0]?.pageIndex ?? 0,
        wordCount: 1,
        confidence: 0.85,
      });
      return inputs.map((i) => ({
        documentId: i.documentId,
        pageIndex: i.pageIndex,
        words: [ocrWord],
        confidence: 0.85,
        durationMs: 1,
      }));
    });

    // ADR-041/ADR-065: ni fuseOcrPage ni fuseOcrRegion son métodos espiables
    // (funciones puras host-side) — se verifica el efecto observable, mismo
    // patrón que el test de fuseOcrPage de arriba.
    let regexInputDocument: Document | undefined;
    vi.spyOn(engines.regex, "process").mockImplementation((input) => {
      regexInputDocument = input.document;
      bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: input.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
      return Promise.resolve({
        documentId: input.document.id,
        occurrenceCount: 0,
        durationMs: 1,
      });
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache,
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    const fusedPage = regexInputDocument?.pages[0];
    // Concatena (§3/§6): la nativa se conserva, la de OCR se suma traducida.
    expect(fusedPage?.words).toContainEqual(nativeWord);
    expect(fusedPage?.words).toContainEqual(
      expect.objectContaining({
        text: "oculto",
        bbox: { x: 105, y: 55, width: 30, height: 12 },
        source: "ocr",
      }),
    );
    expect(fusedPage?.words).toHaveLength(2);
    // Guard invertido (§6): la página sigue con requiresOCR=false — a
    // diferencia de fuseOcrPage, fuseOcrRegion nunca lo toca.
    expect(fusedPage?.requiresOCR).toBe(false);
    expect(fusedPage?.ocrCompleted).toBe(true);
  });

  // ─── Invariantes de la matriz (04_Event_System.md §11, ADR-034 §4) ───

  it("PdfEngine has no bus subscriptions", async () => {
    const bus = createRealBus();
    const pdfEngine = new PdfEngine();
    const ctx: EngineContext = {
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      abortSignal: new AbortController().signal,
      config: createEngineConfig(),
    };

    await pdfEngine.init(ctx);

    expect(bus.channelCount()).toBe(0);
  });

  it("matrix emitter→receiver holds for all subscriptions", async () => {
    const bus = createRealBus();
    const cache = new LruCache();
    const config = createEngineConfig();
    const ctx: EngineContext = {
      bus,
      logger: createMockLogger(),
      cache,
      abortSignal: new AbortController().signal,
      config,
    };

    const pdf = new PdfEngine();
    const ocr = new OcrEngine();
    const regex = new RegexEngine();
    const ner = new NerEngine();
    const grouping = new GroupingEngine();
    const render = new RenderEngine();
    const exportEngine = new ExportEngine();

    // PDF/OCR/Regex/NER/Export no registran ninguna suscripción (ADR-014, ADR-032).
    await pdf.init(ctx);
    await ocr.init(ctx);
    await regex.init(ctx);
    await ner.init(ctx);
    await exportEngine.init(ctx);
    expect(bus.channelCount()).toBe(0);

    // Grouping: ENTITY_FOUND + REGEX_FINISHED/NER_FINISHED (regex/ner) + canal ui + DOCUMENT_CLOSED.
    await grouping.init(ctx);
    expect(bus.subscriberCount(EventChannel.Regex, EngineEvents.ENTITY_FOUND)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Ner, EngineEvents.ENTITY_FOUND)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Regex, EngineEvents.REGEX_FINISHED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Ner, EngineEvents.NER_FINISHED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED)).toBeGreaterThan(0);

    // Render: solo RENDER_REQUESTED (ui) desde ADR-044 — GROUP_REPLACEMENT_CHANGED/
    // GROUP_TOGGLED ya no tienen suscriptor en Render (retiro del delta render).
    await render.init(ctx);
    expect(bus.subscriberCount(EventChannel.UI, EngineEvents.RENDER_REQUESTED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED)).toBe(
      0,
    );
    expect(bus.subscriberCount(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED)).toBe(0);

    // Orchestrator: todas las filas de §8 del spec.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- construir alcanza para wireSubscriptions()
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache,
      config,
      engines: { pdf, ocr, regex, ner, grouping, render, export: exportEngine },
    });

    expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PAGE_PARSED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED)).toBeGreaterThan(0);
    expect(
      bus.subscriberCount(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED),
    ).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PDF_INVALID)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED)).toBeGreaterThan(
      0,
    );
    expect(bus.subscriberCount(EventChannel.Regex, EngineEvents.REGEX_FINISHED)).toBeGreaterThan(1); // grouping + orchestrator
    expect(bus.subscriberCount(EventChannel.Ner, EngineEvents.NER_FINISHED)).toBeGreaterThan(1); // grouping + orchestrator
    expect(
      bus.subscriberCount(EventChannel.Grouping, EngineEvents.GROUPING_FINISHED),
    ).toBeGreaterThan(0);
    // ADR-044: mediación grupos→Render del preview — únicamente el Orchestrator
    // registra suscripción (Render ya no escucha el canal grouping, ver arriba).
    expect(
      bus.subscriberCount(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED),
    ).toBeGreaterThan(0);
    expect(
      bus.subscriberCount(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED),
    ).toBeGreaterThan(0);
    expect(
      bus.subscriberCount(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED),
    ).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Render, EngineEvents.PREVIEW_UPDATED)).toBeGreaterThan(
      0,
    );
    expect(bus.subscriberCount(EventChannel.Export, EngineEvents.EXPORT_FINISHED)).toBeGreaterThan(
      0,
    );
    expect(bus.subscriberCount(EventChannel.Export, EngineEvents.EXPORT_FAILED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.UI, EngineEvents.EXPORT_REQUESTED)).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED)).toBeGreaterThan(1); // grouping + orchestrator
    expect(
      bus.subscriberCount(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED),
    ).toBeGreaterThan(0);
    expect(
      bus.subscriberCount(EventChannel.Workers, EngineEvents.WORKER_POOL_SATURATED),
    ).toBeGreaterThan(0);

    // Invariante: ningún motor de detección/extracción/export se suscribe a otro motor.
    expect(bus.subscriberCount(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED)).toBe(1); // solo Orchestrator
  });

  // ─── ADR-034 §2 / §1 ───

  it("startSession invoked before dispatching detection", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const callOrder: string[] = [];
    (engines.grouping.startSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("startSession");
    });
    (engines.regex.process as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { document: { id: string } }) => {
        callOrder.push("regex.process");
        bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
          documentId: input.document.id,
          occurrenceCount: 0,
          durationMs: 1,
        });
        return { documentId: input.document.id, occurrenceCount: 0, durationMs: 1 };
      },
    );

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig({
        ner: {
          modelId: "x",
          quantization: "q8",
          confidenceThreshold: 0.7,
          batchSize: 1,
          enabled: false,
        },
      }),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(callOrder).toEqual(["startSession", "regex.process"]);
  });

  it("textless pages rasterized via RenderEngine before OCR dispatch", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const pdfOutput = createPdfEngineOutput({
      document: createDocument({ pages: [createPage({ index: 0, requiresOCR: true })] }),
      textlessPages: [0],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput });
    const callOrder: string[] = [];
    (engines.render.rasterizePage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("rasterizePage");
      return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: "srgb" as const };
    });
    (engines.ocr.processPages as ReturnType<typeof vi.fn>).mockImplementation(
      async (inputs: ReadonlyArray<{ documentId: string; pageIndex: number }>) => {
        callOrder.push("ocr.processPages");
        return inputs.map((i) => ({
          documentId: i.documentId,
          pageIndex: i.pageIndex,
          words: [],
          confidence: 1,
          durationMs: 1,
        }));
      },
    );

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(callOrder).toEqual(["rasterizePage", "ocr.processPages"]);
    expect(engines.render.loadDocument).toHaveBeenCalledBefore(
      engines.render.rasterizePage as ReturnType<typeof vi.fn>,
    );
  });

  // ─── Export (ADR-032 §2) ───

  it("EXPORT_REQUESTED builds provider and calls export directly", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: false,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => {
      expect(engines.export.export).toHaveBeenCalled();
    });

    const call = (engines.export.export as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.renderPageProvider).toBeDefined();
    expect(typeof call.renderPageProvider.renderFull).toBe("function");
  });

  // ─── Mediación grupos→Render del preview (ADR-044, §13 casos 26-27) ───

  it("GROUPING_FINISHED seeds anonymized preview with snapshot replacements", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);

    const group = createEntityGroup({
      id: "group-seed",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    expect(engines.render.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        pageIndex: 0,
        kind: "anonymized",
        mode: "preview",
        replacements: [
          expect.objectContaining({
            groupId: "group-seed",
            occurrenceId: "occ-1",
            pageIndex: 0,
          }),
        ],
        // ADR-058 §5 / Orchestrator.md v1.7.1: `[DNI 01]` no entra en un bbox
        // de 3x4 (estimateTokenWidth desborda), así que `renderMediatedPreview`
        // adjunta `lineWords` -- vacío acá porque el documento de fixture no
        // tiene palabras en esa página, pero el campo está presente (no
        // `undefined`), que es lo que prueba que el seed quedó cableado.
        lineWords: [],
      }),
      expect.anything(),
    );
  });

  it("renderFull attaches the same lineWords as the preview for the same page", async () => {
    // v1.7.1 -- el test del falso positivo del gate: sin esto, el repintado
    // de línea (ADR-058 §2-§6) podría quedar solo en el preview mientras el
    // PDF exportado sigue con el shrink-to-fit de §1, en silencio.
    const bus = createRealBus();
    const engines = createMockEngines();

    const neighborWord = createWord({
      text: "vecino",
      bbox: { x: 30, y: 0, width: 30, height: 12 },
    });
    const document = createDocument({
      pages: [createPage({ index: 0, words: [neighborWord] })],
    });
    wireHappyPathSpies(engines, bus, { pdfOutput: createPdfEngineOutput({ document }) });

    const group = createEntityGroup({
      id: "group-line",
      // bbox angosto + "[DNI 01]" (8 caracteres): estimateTokenWidth lo hace
      // desbordar (ADR-057 §5), así que selectLineWords adjunta la vecina.
      members: [
        {
          occurrenceId: "occ-line",
          pageIndex: 0,
          bbox: { x: 0, y: 0, width: 20, height: 12 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    // El seed de GROUPING_FINISHED (ADR-044) ya disparó el único render
    // "preview" de este test para la página 0.
    const previewCall = (engines.render.renderPage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => (input as { mode: string }).mode === "preview",
    );
    expect(previewCall).toBeDefined();
    const previewInput = previewCall![0] as {
      readonly replacements: ReadonlyArray<unknown>;
      readonly lineWords: ReadonlyArray<unknown> | undefined;
    };
    // No-vacuo: si esto viniera ausente o vacío, la comparación de abajo
    // pasaría igual sin haber probado nada.
    expect(previewInput.lineWords).toEqual([neighborWord]);

    (engines.render.renderPage as ReturnType<typeof vi.fn>).mockClear();

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: false,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => {
      expect(engines.export.export).toHaveBeenCalled();
    });
    const exportCall = (engines.export.export as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      renderPageProvider: {
        renderFull(
          pageIndex: number,
          replacements: ReadonlyArray<unknown>,
          abortSignal: AbortSignal,
        ): Promise<unknown>;
      };
    };

    // Mismos reemplazos que recibió el preview: Orchestrator.md v1.7.1 pide
    // comparar "para la misma página/reemplazos", no dos implementaciones
    // que coincidan por casualidad.
    await exportCall.renderPageProvider.renderFull(
      0,
      previewInput.replacements,
      new AbortController().signal,
    );

    const fullCall = (engines.render.renderPage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => (input as { mode: string }).mode === "full",
    );
    expect(fullCall).toBeDefined();
    const fullInput = fullCall![0] as { readonly lineWords: ReadonlyArray<unknown> | undefined };
    expect(fullInput.lineWords).toEqual(previewInput.lineWords);
    expect(fullInput.lineWords).toEqual([neighborWord]);
  });

  // ─── Mediación de la leyenda de marcadores (ADR-059 §5) ───

  it("renderLegend delegates to RenderEngine.renderLegendPage and returns its EncodedPageImage", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    const document = createDocument({ pages: [createPage({ index: 0, width: 595, height: 842 })] });
    wireHappyPathSpies(engines, bus, { pdfOutput: createPdfEngineOutput({ document }) });

    const legendImage = {
      bytes: new Uint8Array([1, 2, 3]).buffer,
      format: "png" as const,
      widthPx: 595,
      heightPx: 842,
    };
    vi.spyOn(engines.render, "renderLegendPage").mockResolvedValue(legendImage);

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    const options = {
      imageFormat: "jpeg" as const,
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false as const,
      includeMarkerLegend: true,
      filename: "out.pdf",
    };
    bus.emit(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, { documentId: "doc-1", options });

    await vi.waitFor(() => {
      expect(engines.export.export).toHaveBeenCalled();
    });
    const exportCall = (engines.export.export as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      renderPageProvider: RenderPageProvider;
    };

    const rows = [{ prefixes: "DNI", typeName: "DNI", countLabel: "1 marcador" }];
    const result = await exportCall.renderPageProvider.renderLegend(
      rows,
      new AbortController().signal,
    );

    expect(engines.render.renderLegendPage).toHaveBeenCalledWith(rows, 595, 842, expect.anything());
    expect(result).toEqual(legendImage);
  });

  it("group events during detection accumulate without rendering", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);

    const group = createEntityGroup({
      id: "group-mid-detect",
      members: [
        {
          occurrenceId: "occ-1",
          pageIndex: 0,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
          source: DetectionSource.Regex,
        },
      ],
    });
    vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
      documentId: docId,
      groups: [group],
      conflicts: [],
      rules: [],
    }));
    vi.spyOn(engines.regex, "process").mockImplementation((input) => {
      // caso 26: el evento llega durante Detecting (pre-Ready) — se acumula
      // en el mapa retenido, sin disparar ningún render todavía.
      bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
        documentId: input.document.id,
        group,
      });
      expect(engines.render.renderPage).not.toHaveBeenCalled();
      bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
        documentId: input.document.id,
        occurrenceCount: 1,
        durationMs: 1,
      });
      return Promise.resolve({
        documentId: input.document.id,
        occurrenceCount: 1,
        durationMs: 1,
      });
    });

    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.importDocument(createImportInput());

    // El seed de GROUPING_FINISHED sí recoge el grupo acumulado durante detección.
    expect(engines.render.renderPage).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1", pageIndex: 0, kind: "anonymized" }),
      expect.anything(),
    );
  });

  // ─── dispose() global (caso 17) ───

  it("dispose cleans all subscriptions and pools", async () => {
    const bus = createRealBus();
    const engines = createMockEngines();
    wireHappyPathSpies(engines, bus);
    const orchestrator = new PipelineOrchestrator({
      bus,
      logger: createMockLogger(),
      cache: new LruCache(),
      config: createEngineConfig(),
      engines,
    });

    await orchestrator.dispose();

    expect(engines.pdf.dispose).toHaveBeenCalled();
    expect(engines.ocr.dispose).toHaveBeenCalled();
    expect(engines.regex.dispose).toHaveBeenCalled();
    expect(engines.ner.dispose).toHaveBeenCalled();
    expect(engines.grouping.dispose).toHaveBeenCalled();
    expect(engines.render.dispose).toHaveBeenCalled();
    expect(engines.export.dispose).toHaveBeenCalled();

    // Unsubscrito: emitir después de dispose() no debería ejecutar handlers del Orchestrator.
    expect(() =>
      bus.emit(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, { documentId: "doc-x" }),
    ).not.toThrow();
  });

  // ─── addManualEntity (ADR-061 §6, §10) ───

  it("addManualEntity produces a new group visible in the grouping snapshot", async () => {
    const document = createDocument({
      pageCount: 1,
      pages: [
        createPage({
          index: 0,
          text: "Jose Perez",
          words: [
            createWord({ text: "Jose", bbox: { x: 0, y: 0, width: 30, height: 12 } }),
            createWord({ text: "Perez", bbox: { x: 35, y: 0, width: 35, height: 12 } }),
          ],
        }),
      ],
    });
    const { engines, orchestrator } = await makeOrchestratorWithRealDetection(
      createPdfEngineOutput({ document }),
    );

    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    expect(engines.grouping.getSnapshot("doc-1").groups).toHaveLength(0);

    await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });

    const snapshot = engines.grouping.getSnapshot("doc-1");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({ type: EntityType.Person });
    expect(snapshot.groups[0]?.members).toHaveLength(1);
  });

  it("adding an already-detected value merges instead of duplicating", async () => {
    const document = createDocument({
      pageCount: 1,
      pages: [
        createPage({
          index: 0,
          text: "Contacto test@example.com fin",
          words: [
            createWord({ text: "Contacto", bbox: { x: 0, y: 0, width: 50, height: 12 } }),
            createWord({
              text: "test@example.com",
              bbox: { x: 55, y: 0, width: 100, height: 12 },
            }),
            createWord({ text: "fin", bbox: { x: 160, y: 0, width: 20, height: 12 } }),
          ],
        }),
      ],
    });
    const { engines, orchestrator } = await makeOrchestratorWithRealDetection(
      createPdfEngineOutput({ document }),
    );

    // La detección automática (regex real) ya encuentra el email — es "un
    // valor ya detectado" antes de que el usuario lo agregue a mano.
    await orchestrator.importDocument(createImportInput());
    expect(orchestrator.getState("doc-1").stage).toBe(PipelineStage.Ready);
    const before = engines.grouping.getSnapshot("doc-1");
    expect(before.groups).toHaveLength(1);
    expect(before.groups[0]?.members).toHaveLength(1);

    await orchestrator.addManualEntity("doc-1", {
      value: "test@example.com",
      entityType: EntityType.Email,
    });

    // El dedup por identidad de ADR-038 §3 descarta la ocurrencia manual
    // (misma entityType/pageIndex/bbox/normalizedValue que la ya
    // registrada): ni grupo nuevo ni member nuevo, se fusiona en silencio.
    const after = engines.grouping.getSnapshot("doc-1");
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0]?.id).toBe(before.groups[0]?.id);
    expect(after.groups[0]?.members).toHaveLength(1);
  });

  it("adding the same value twice is idempotent", async () => {
    const document = createDocument({
      pageCount: 1,
      pages: [
        createPage({
          index: 0,
          text: "Jose Perez",
          words: [
            createWord({ text: "Jose", bbox: { x: 0, y: 0, width: 30, height: 12 } }),
            createWord({ text: "Perez", bbox: { x: 35, y: 0, width: 35, height: 12 } }),
          ],
        }),
      ],
    });
    const { engines, orchestrator } = await makeOrchestratorWithRealDetection(
      createPdfEngineOutput({ document }),
    );

    await orchestrator.importDocument(createImportInput());

    await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });
    const firstGroupId = engines.grouping.getSnapshot("doc-1").groups[0]?.id;

    await orchestrator.addManualEntity("doc-1", {
      value: "Jose Perez",
      entityType: EntityType.Person,
    });

    const snapshot = engines.grouping.getSnapshot("doc-1");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]?.id).toBe(firstGroupId);
    expect(snapshot.groups[0]?.members).toHaveLength(1);
  });
});
