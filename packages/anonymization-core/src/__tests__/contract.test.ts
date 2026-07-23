import { ExportEngine } from "@anonly/export-engine";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { OcrEngine } from "@anonly/ocr-engine";
import { PdfEngine } from "@anonly/pdf-engine";
import { RegexEngine } from "@anonly/regex-engine";
import { RenderEngine } from "@anonly/render-engine";
import {
  EngineEvents,
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
  createImportInput,
  createMockEngines,
  createMockLogger,
  createPage,
  createPdfEngineOutput,
  createRealBus,
  wireHappyPathSpies,
} from "./fixtures/test-helpers.js";

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

    expect(engines.render.loadDocument).toHaveBeenCalledWith("doc-1", expect.any(ArrayBuffer));
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

    // Render: RENDER_REQUESTED (ui) + GROUP_REPLACEMENT_CHANGED/GROUP_TOGGLED (grouping).
    await render.init(ctx);
    expect(bus.subscriberCount(EventChannel.UI, EngineEvents.RENDER_REQUESTED)).toBeGreaterThan(0);
    expect(
      bus.subscriberCount(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED),
    ).toBeGreaterThan(0);
    expect(bus.subscriberCount(EventChannel.Grouping, EngineEvents.GROUP_TOGGLED)).toBeGreaterThan(
      0,
    );

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
});
