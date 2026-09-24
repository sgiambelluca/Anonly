import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createEventBus } from "@anonly/event-system";
import { GroupingEngine } from "@anonly/grouping-engine";
import {
  DetectionSource,
  EngineEvents,
  EntityType,
  EventChannel,
  type EngineContext,
  type ILogger,
  type ICache,
  type Occurrence,
} from "@anonly/shared";

const COUNTS = [250, 500, 1000, 2000] as const;
type Corpus = "distinct" | "repeated";

const nullLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const nullCache: ICache = {
  get: () => undefined,
  set: () => undefined,
  delete: () => undefined,
  clear: () => undefined,
  size: 0,
  bytes: 0,
};

function config(): EngineContext["config"] {
  return {
    workerPool: {
      pdfPoolSize: 1,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 1,
      maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
      timeouts: {
        "pdf-parse": 30_000,
        "ocr-page": 60_000,
        "ocr-orient": 60_000,
        "ner-page": 20_000,
        "render-page": 10_000,
        "export-page": 30_000,
      },
      maxRetries: {
        "pdf-parse": 0,
        "ocr-page": 0,
        "ocr-orient": 0,
        "ner-page": 0,
        "render-page": 0,
        "export-page": 0,
      },
      baseRetryDelayMs: 0,
      maxRetryDelayMs: 0,
      cancelSlaMs: 200,
      idleDisposeMs: 60_000,
      nerIdleDisposeMs: 15_000,
    },
    pdf: { maxPageCount: 10_000 },
    ner: {
      modelId: "benchmark",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 1,
      enabled: true,
    },
    ocr: { languages: ["spa"], dpi: 300, maxLiveImageBytes: 128 * 1024 * 1024 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
  };
}

function syntheticValue(index: number, corpus: Corpus): string {
  const bucket = corpus === "repeated" ? index % 24 : index;
  const neutralToken = createHash("sha256").update(`entity-${bucket}`).digest("hex").slice(0, 16);
  return `persona adversarial ${neutralToken}`;
}

function makeOccurrence(index: number, corpus: Corpus): Occurrence {
  const value = syntheticValue(index, corpus);
  return {
    id: `bench-${index}`,
    value,
    normalizedValue: value,
    bbox: { x: 10, y: index + 1, width: 60, height: 12 },
    pageIndex: 0,
    source: DetectionSource.NER,
    confidence: 0.99,
    entityType: EntityType.Person,
  };
}

interface Report {
  readonly profile: "synthetic";
  readonly corpus: Corpus;
  readonly entityCount: number;
  readonly round: number;
  readonly processMs: number;
  readonly fuzzyLookupMs: number;
  readonly fuzzyLookupCalls: number;
  readonly groupCount: number;
  readonly aliasCount: number;
  readonly memberCount: number;
  readonly entityValueChars: number;
  readonly entityValueLengthMax: number;
  readonly eventLoopDelayMs: number;
  readonly cancellationTimerDelayMs: number;
  readonly cancellationObservedBeforeFinish: boolean;
  readonly groupsFingerprint: string;
  readonly orderFingerprint: string;
}

async function runSynthetic(entityCount: number, corpus: Corpus, round: number): Promise<Report> {
  const controller = new AbortController();
  const bus = createEventBus({ logger: nullLogger });
  const context: EngineContext = {
    bus,
    logger: nullLogger,
    cache: nullCache,
    abortSignal: controller.signal,
    config: config(),
  };
  const engine = new GroupingEngine();
  await engine.init(context);
  const documentId = `grouping-${corpus}-${entityCount}-${round}`;
  engine.startSession(documentId);

  let memberCount = 0;
  const groupSignatures: string[] = [];
  const orderSignatures: string[] = [];
  bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, ({ group }) => {
    groupSignatures.push(`${group.type}:${group.canonicalValue}:${group.members.length}`);
    orderSignatures.push(`${group.type}:${group.indexInType}:${group.canonicalValue}`);
  });
  bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, ({ group }) => {
    const index = groupSignatures.findIndex((signature) => signature.startsWith(`${group.type}:`));
    if (index >= 0)
      groupSignatures[index] = `${group.type}:${group.canonicalValue}:${group.members.length}`;
  });

  const original = Reflect.get(engine, "findMatchingGroup");
  if (typeof original !== "function")
    throw new Error("Grouping lookup instrumentation unavailable");
  let fuzzyLookupMs = 0;
  let fuzzyLookupCalls = 0;
  const wrapped = function (this: unknown, ...args: ReadonlyArray<unknown>): unknown {
    const started = performance.now();
    try {
      return Reflect.apply(original, this, args);
    } finally {
      fuzzyLookupMs += performance.now() - started;
      fuzzyLookupCalls += 1;
    }
  };
  Reflect.set(engine, "findMatchingGroup", wrapped);

  let timerRanAt = Number.NaN;
  let cancelRequestedAt = Number.NaN;
  const startedAt = performance.now();
  const eventLoopTimer = new Promise<void>((resolveTimer) => {
    setTimeout(() => {
      timerRanAt = performance.now();
      resolveTimer();
    }, 0);
  });
  const cancellationTimer = new Promise<void>((resolveTimer) => {
    setTimeout(() => {
      cancelRequestedAt = performance.now();
      controller.abort();
      resolveTimer();
    }, 1);
  });

  for (let index = 0; index < entityCount; index += 1) {
    bus.emit(EventChannel.Ner, EngineEvents.ENTITY_FOUND, {
      documentId,
      occurrence: makeOccurrence(index, corpus),
    });
  }
  await engine.finishSession(documentId);
  const finishedAt = performance.now();
  await Promise.all([eventLoopTimer, cancellationTimer]);
  Reflect.set(engine, "findMatchingGroup", original);

  const snapshot = engine.getSnapshot(documentId);
  const entityValues = Array.from({ length: entityCount }, (_, index) =>
    syntheticValue(index, corpus),
  );
  memberCount = snapshot.groups.reduce((sum, group) => sum + group.members.length, 0);
  groupSignatures.length = 0;
  orderSignatures.length = 0;
  for (const group of snapshot.groups) {
    groupSignatures.push(`${group.type}:${group.canonicalValue}:${group.members.length}`);
    orderSignatures.push(`${group.type}:${group.indexInType}:${group.canonicalValue}`);
  }
  const fingerprint = (items: ReadonlyArray<string>): string =>
    createHash("sha256").update(items.join("\n")).digest("hex");
  await engine.dispose();

  return {
    profile: "synthetic",
    corpus,
    entityCount,
    round,
    processMs: finishedAt - startedAt,
    fuzzyLookupMs,
    fuzzyLookupCalls,
    groupCount: snapshot.groups.length,
    aliasCount: snapshot.groups.reduce((sum, group) => sum + group.aliases.length, 0),
    memberCount,
    entityValueChars: entityValues.reduce((sum, value) => sum + value.length, 0),
    entityValueLengthMax: Math.max(...entityValues.map((value) => value.length)),
    eventLoopDelayMs: Number.isNaN(timerRanAt) ? 0 : timerRanAt - startedAt,
    cancellationTimerDelayMs: Number.isNaN(cancelRequestedAt) ? 0 : cancelRequestedAt - startedAt,
    cancellationObservedBeforeFinish:
      !Number.isNaN(cancelRequestedAt) && cancelRequestedAt < finishedAt,
    groupsFingerprint: fingerprint(groupSignatures),
    orderFingerprint: fingerprint(orderSignatures),
  };
}

function readArguments(): {
  readonly count: number;
  readonly corpus: Corpus;
  readonly round: number;
} {
  const [, , countText, corpusText, roundText] = process.argv;
  const count = Number(countText);
  const round = Number(roundText);
  if (!COUNTS.some((allowed) => allowed === count)) throw new Error("Invalid entity count");
  if (corpusText !== "distinct" && corpusText !== "repeated") throw new Error("Invalid corpus");
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("Invalid round");
  return { count, corpus: corpusText, round };
}

async function main(): Promise<void> {
  const { count, corpus, round } = readArguments();
  const report = await runSynthetic(count, corpus, round);
  const outputDir = resolve(
    process.env.ANONLY_GROUPING_OUTPUT_DIR ?? ".measure/grouping-worst-case",
  );
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `grouping-synthetic-${corpus}-${count}-round${round}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main();
