/**
 * Integración (Hito 9, ADR-034 §6, par crítico "a"): Regex + NER → Grouping
 * vía `ENTITY_FOUND`, con motores reales (`RegexEngine`, `NerEngine`,
 * `GroupingEngine`) y un `EventBus` real. Solo se mockea la frontera pesada
 * de `@huggingface/transformers` (ADR-021 §5) — Regex y Grouping son puro
 * TypeScript, sin dependencias externas.
 */
import { createEventBus } from "@anonly/event-system";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { RegexEngine } from "@anonly/regex-engine";
import {
  DetectionSource,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: { allowRemoteModels: true, localModelPath: "/models/", backends: { onnx: { wasm: {} } } },
}));

import { mockTokenClassificationPipeline } from "./fixtures/mocks.js";

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
 * Construye `Word[]` a partir de tokens separados por espacio (mismo criterio
 * que `Page.text = words.map(w => w.text).join(" ")`, 03_Data_Model.md §4):
 * `NerEngine` deriva sus chunks de inferencia de `Page.words`, no de `text`
 * directamente (`computeWordChunks`, ner.engine.ts) — sin `words` reales no
 * hay chunks y el clasificador nunca se invoca.
 */
function wordsFromTokens(pageIndex: number, tokens: ReadonlyArray<string>): Word[] {
  return tokens.map((text, i) => ({
    text,
    bbox: { x: i * 40, y: 10, width: 35, height: 12 },
    pageIndex,
    confidence: 1,
    source: "pdf" as const,
  }));
}

function createPage(index: number, tokens: ReadonlyArray<string>): Page {
  const words = wordsFromTokens(index, tokens);
  return {
    index,
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
    id: "doc-integration-1",
    name: "integration.pdf",
    pageCount: 1,
    pages: [createPage(0, ["Juan", "Perez", "tiene", "DNI", "34.567.891"])],
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: Date.now(),
  };
}

describe("integration — Regex + NER -> Grouping via ENTITY_FOUND", () => {
  let ctx: EngineContext;
  let regex: RegexEngine;
  let ner: NerEngine;
  let grouping: GroupingEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    const bus = createEventBus({ logger: createLogger() });
    ctx = {
      bus,
      logger: createLogger(),
      cache: createCache(),
      abortSignal: new AbortController().signal,
      config: createConfig(),
    };

    regex = new RegexEngine();
    ner = new NerEngine();
    grouping = new GroupingEngine();

    await regex.init(ctx);
    await ner.init(ctx);
    await grouping.init(ctx);
  });

  afterEach(async () => {
    await regex.dispose();
    await ner.dispose();
    await grouping.dispose();
  });

  it("both detectors' ENTITY_FOUND land in the same session and produce groups per type", async () => {
    vi.mocked(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline((text) => {
        const index = text.indexOf("Juan");
        if (index < 0) return Promise.resolve([]);
        return Promise.resolve([
          { entity: "B-PER", score: 0.95, index, word: "Juan" },
          { entity: "I-PER", score: 0.93, index: index + 5, word: "Perez" },
        ]);
      }) as any,
    );

    const document = createDocument();
    grouping.startSession(document.id);

    await regex.process({ document }, ctx);

    const words = document.pages[0]?.words ?? [];
    await ner.processPages(
      [{ documentId: document.id, pageIndex: 0, text: document.pages[0]?.text ?? "", words }],
      ctx,
    );

    const snapshot = grouping.getSnapshot(document.id);
    expect(snapshot.groups.length).toBeGreaterThanOrEqual(1);

    const dniGroup = snapshot.groups.find((g) => g.type === EntityType.DNI);
    expect(dniGroup).toBeDefined();
    expect(dniGroup?.members[0]?.source).toBe(DetectionSource.Regex);

    const personGroup = snapshot.groups.find((g) => g.type === EntityType.Person);
    expect(personGroup).toBeDefined();
    expect(personGroup?.members[0]?.source).toBe(DetectionSource.NER);
  });
});
