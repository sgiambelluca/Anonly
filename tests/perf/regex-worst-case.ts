import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEventBus } from "@anonly/event-system";
import { RegexEngine, DEFAULT_PATTERNS_AR } from "@anonly/regex-engine";
import {
  EntityType,
  EngineEvents,
  EventChannel,
  type EngineContext,
  type ILogger,
  type ICache,
  type Document,
  type Page,
  type Word,
} from "@anonly/shared";

import { scanEmailDefault } from "../../packages/anonymization-core/regex-engine/src/email-scanner.js";

const KIB = 1024;
const SIZES_KIB = [2, 10, 20, 40, 80, 160] as const;
const CHILD_TIMEOUT_MS = 65_000;
type Label = "adversarial" | "adversarial-late-at" | "normal";

interface DetectionSummary {
  readonly count: number;
  readonly fingerprint: string;
}

interface ChildResult {
  readonly sizeKiB: number;
  readonly chars: number;
  readonly label: Label;
  readonly pass: "plain" | "pattern-profile";
  readonly processMs: number;
  readonly eventLoopDelayMs: number;
  readonly cancelDispatchDelayMs: number;
  readonly cancelObservedDuringProcess: boolean;
  readonly detections: DetectionSummary;
  readonly expectedEmailDetections: number;
  readonly observedEmailDetections: number;
  readonly emailScannerMs?: number;
  readonly perPatternMs?: Readonly<Record<string, number>>;
}

interface RunRecord {
  readonly round: number;
  readonly sizeKiB: number;
  readonly requestedChars: number;
  readonly label: Label;
  readonly pass: "plain" | "pattern-profile";
  readonly status: "completed" | "censored";
  readonly result?: ChildResult;
  readonly wallMs: number;
}

interface CampaignReport {
  readonly schemaVersion: 1;
  readonly engine: "regex";
  readonly commit: string;
  readonly startedAt: string;
  readonly platform: NodeJS.Platform;
  readonly runtime: string;
  readonly timeoutMs: number;
  readonly orders: ReadonlyArray<ReadonlyArray<number>>;
  readonly rounds: ReadonlyArray<RunRecord>;
  readonly qualityMismatchCount: number;
}

const NULL_LOGGER: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const NULL_CACHE: ICache = {
  get: () => undefined,
  set: () => undefined,
  delete: () => undefined,
  clear: () => undefined,
  size: 0,
  bytes: 0,
};

function buildConfig(): EngineContext["config"] {
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
      enabled: false,
    },
    ocr: { languages: ["spa"], dpi: 300, maxLiveImageBytes: 128 * 1024 * 1024 },
    grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
    render: { previewScale: 0.5, fullScale: 2, jpegQuality: 80, cachePages: 16 },
    export: { defaultDpi: 300, defaultImageFormat: "png", defaultJpegQuality: 80 },
  };
}

function makeText(chars: number, label: Label): string {
  if (label === "adversarial") return "1-".repeat(Math.ceil(chars / 2)).slice(0, chars);
  if (label === "adversarial-late-at")
    return `${"1-".repeat(Math.ceil(chars / 2)).slice(0, chars)}@x.c`;
  const chunks: string[] = [];
  let index = 0;
  let currentLength = 0;
  while (currentLength < chars) {
    const chunk = `Contacto ${index}: persona de prueba en Calle Ejemplo ${index}, correo control${index}@example.test. `;
    chunks.push(chunk);
    currentLength += chunk.length;
    index += 1;
  }
  return chunks.join("").slice(0, chars);
}

function documentFor(text: string, documentId: string): Document {
  const word: Word = {
    text,
    bbox: { x: 1, y: 1, width: 1, height: 1 },
    pageIndex: 0,
    confidence: 1,
    source: "pdf",
  };
  const page: Page = {
    index: 0,
    width: 595,
    height: 842,
    words: [word],
    text,
    requiresOCR: false,
    ocrCompleted: false,
  };
  return {
    id: documentId,
    name: "synthetic.pdf",
    pageCount: 1,
    pages: [page],
    metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
    sourceKind: "text",
    importedAt: 0,
  };
}

async function executeScenario(
  sizeKiB: number,
  label: Label,
  profilePatterns: boolean,
): Promise<ChildResult> {
  const text = makeText(sizeKiB * KIB, label);
  const signalController = new AbortController();
  const detections: DetectionSummary[] = [];
  const bus = createEventBus({ logger: NULL_LOGGER });
  let emailDetections = 0;
  bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, ({ occurrence }) => {
    if (occurrence.entityType === EntityType.Email) emailDetections += 1;
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          occurrence.pageIndex,
          occurrence.entityType,
          occurrence.bbox.x,
          occurrence.bbox.y,
          occurrence.normalizedValue,
        ]),
      )
      .digest("hex");
    detections.push({ count: 1, fingerprint: digest });
  });
  const context: EngineContext = {
    bus,
    logger: NULL_LOGGER,
    cache: NULL_CACHE,
    abortSignal: signalController.signal,
    config: buildConfig(),
  };
  const engine = new RegexEngine();
  await engine.init(context);

  const sourceToId = new Map(
    DEFAULT_PATTERNS_AR.map((pattern) => [pattern.pattern.source, pattern.id]),
  );
  const perPattern = new Map<string, number>();
  const nativeExec = RegExp.prototype.exec;
  let isComplete = false;
  let cancelDispatchAt = Number.NaN;
  let cancelCallbackAt = Number.NaN;
  const cancelScheduledAt = performance.now();
  let timerCallbackAt = Number.NaN;
  let completedAt = Number.NaN;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;

  if (profilePatterns) {
    RegExp.prototype.exec = function (this: RegExp, value: string): RegExpExecArray | null {
      const started = performance.now();
      try {
        return nativeExec.call(this, value);
      } finally {
        const id = sourceToId.get(this.source);
        if (id !== undefined)
          perPattern.set(id, (perPattern.get(id) ?? 0) + performance.now() - started);
      }
    };
  }

  const startedAt = performance.now();
  const delayPromise = new Promise<void>((resolveDelay) => {
    delayTimer = setTimeout(() => {
      timerCallbackAt = performance.now();
      resolveDelay();
    }, 0);
  });
  const cancellationPromise = new Promise<void>((resolveCancel) => {
    abortTimer = setTimeout(() => {
      cancelDispatchAt = performance.now();
      signalController.abort();
      cancelCallbackAt = performance.now();
      resolveCancel();
    }, 1);
  });

  try {
    await engine.process({ document: documentFor(text, "regex-bench") }, context);
    isComplete = true;
    completedAt = performance.now();
  } finally {
    if (profilePatterns) RegExp.prototype.exec = nativeExec;
    if (!isComplete && delayTimer !== undefined) clearTimeout(delayTimer);
    if (!isComplete && abortTimer !== undefined) clearTimeout(abortTimer);
  }

  await Promise.all([delayPromise, cancellationPromise]);
  await engine.dispose();
  const totalFingerprint = createHash("sha256")
    .update(detections.map((d) => d.fingerprint).join("|"))
    .digest("hex");
  const base = {
    sizeKiB,
    chars: text.length,
    label,
    pass: profilePatterns ? ("pattern-profile" as const) : ("plain" as const),
    processMs: completedAt - startedAt,
    eventLoopDelayMs: Number.isNaN(timerCallbackAt) ? 0 : timerCallbackAt - startedAt,
    cancelDispatchDelayMs: Number.isNaN(cancelCallbackAt)
      ? 0
      : cancelCallbackAt - cancelScheduledAt,
    cancelObservedDuringProcess: !Number.isNaN(cancelDispatchAt) && cancelDispatchAt < completedAt,
    detections: { count: detections.length, fingerprint: totalFingerprint },
    expectedEmailDetections:
      label === "normal" ? [...text.matchAll(/control\d+@example\.test/gu)].length : 0,
    observedEmailDetections: emailDetections,
  };
  if (!profilePatterns) return base;
  const emailScanStarted = performance.now();
  scanEmailDefault(text);
  const emailScannerMs = performance.now() - emailScanStarted;
  return { ...base, emailScannerMs, perPatternMs: Object.fromEntries(perPattern) };
}

function launchChild(
  sizeKiB: number,
  label: Label,
  profilePatterns: boolean,
): Promise<{ readonly output: string; readonly wallMs: number; readonly censored: boolean }> {
  const script = fileURLToPath(import.meta.url);
  const args = [
    "--import",
    "tsx",
    script,
    "--child",
    String(sizeKiB),
    label,
    profilePatterns ? "profile" : "plain",
  ];
  const started = Date.now();
  return new Promise((resolveChild) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, TSX_TSCONFIG_PATH: resolve("tests/tsconfig.json") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolveChild({ output: errors, wallMs: Date.now() - started, censored: true });
    }, CHILD_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errors += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveChild({
        output: `${errors}${error.message}`,
        wallMs: Date.now() - started,
        censored: false,
      });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveChild({
        output:
          code === 0 ? output.trim() : `${errors}exit=${String(code)} signal=${String(signal)}`,
        wallMs: Date.now() - started,
        censored: false,
      });
    });
  });
}

function currentCommit(): Promise<string> {
  return new Promise((resolveCommit) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] });
    let value = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      value += chunk;
    });
    child.on("close", () => resolveCommit(value.trim()));
  });
}

async function runCampaign(): Promise<void> {
  const outputDir = resolve(
    process.env.ANONLY_REGEX_WORST_OUTPUT_DIR ??
      `.measure/regex-worst-case/${new Date().toISOString().replaceAll(/[-:]/g, "").replaceAll(".", "")}`,
  );
  const rounds: RunRecord[] = [];
  const orders = [
    [...SIZES_KIB],
    [...SIZES_KIB].reverse(),
    [SIZES_KIB[0], SIZES_KIB[3], SIZES_KIB[1], SIZES_KIB[4], SIZES_KIB[2], SIZES_KIB[5]],
  ];
  const profilesDone = new Set<number>();

  for (let round = 0; round < orders.length; round += 1) {
    const order = orders[round];
    if (order === undefined) continue;
    for (const sizeKiB of order) {
      const labels: ReadonlyArray<Label> =
        round === 1
          ? ["normal", "adversarial", "adversarial-late-at"]
          : ["adversarial", "adversarial-late-at", "normal"];
      for (const label of labels) {
        const child = await launchChild(sizeKiB, label, false);
        const record = await parseChild(child, round + 1, sizeKiB, label, "plain");
        rounds.push(record);
        if (child.censored) continue;
      }
      if (!profilesDone.has(sizeKiB)) {
        const child = await launchChild(sizeKiB, "adversarial", true);
        rounds.push(await parseChild(child, round + 1, sizeKiB, "adversarial", "pattern-profile"));
        const lateAtChild = await launchChild(sizeKiB, "adversarial-late-at", true);
        rounds.push(
          await parseChild(
            lateAtChild,
            round + 1,
            sizeKiB,
            "adversarial-late-at",
            "pattern-profile",
          ),
        );
        profilesDone.add(sizeKiB);
      }
    }
  }

  const report: CampaignReport = {
    schemaVersion: 1,
    engine: "regex",
    commit: await currentCommit(),
    startedAt: new Date().toISOString(),
    platform: process.platform,
    runtime: process.version,
    timeoutMs: CHILD_TIMEOUT_MS,
    orders: orders.map((order) => order.map(Number)),
    rounds,
    qualityMismatchCount: qualityMismatchCount(rounds),
  };
  await mkdir(resolve(outputDir, ".."), { recursive: true });
  await mkdir(outputDir);
  const reportPath = resolve(outputDir, "numeric-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Reporte numérico: ${reportPath}\n`);
  const censored = rounds.filter((run) => run.status === "censored").length;
  process.stdout.write(
    `Corridas: ${rounds.length}; censuradas: ${censored}; timeout: ${CHILD_TIMEOUT_MS} ms\n`,
  );
  process.stdout.write(`Inconsistencias de referencia: ${report.qualityMismatchCount}\n`);
}

function qualityMismatchCount(records: ReadonlyArray<RunRecord>): number {
  const fingerprints = new Map<string, string>();
  let mismatches = 0;
  for (const record of records) {
    if (record.status !== "completed" || record.result === undefined) continue;
    const result = record.result;
    if (
      result.label === "normal" &&
      result.expectedEmailDetections !== result.observedEmailDetections
    ) {
      mismatches += 1;
    }
    if (record.pass !== "plain") continue;
    const key = `${record.sizeKiB}:${record.label}`;
    const prior = fingerprints.get(key);
    if (prior === undefined) fingerprints.set(key, result.detections.fingerprint);
    else if (prior !== result.detections.fingerprint) mismatches += 1;
  }
  return mismatches;
}

async function parseChild(
  child: { readonly output: string; readonly wallMs: number; readonly censored: boolean },
  round: number,
  sizeKiB: number,
  label: Label,
  pass: RunRecord["pass"],
): Promise<RunRecord> {
  if (child.censored)
    return {
      round,
      sizeKiB,
      requestedChars: sizeKiB * KIB,
      label,
      pass,
      status: "censored",
      wallMs: child.wallMs,
    };
  try {
    const result = JSON.parse(child.output) as ChildResult;
    return {
      round,
      sizeKiB,
      requestedChars: sizeKiB * KIB,
      label,
      pass,
      status: "completed",
      result,
      wallMs: child.wallMs,
    };
  } catch {
    return {
      round,
      sizeKiB,
      requestedChars: sizeKiB * KIB,
      label,
      pass,
      status: "censored",
      wallMs: child.wallMs,
    };
  }
}

async function childMain(args: ReadonlyArray<string>): Promise<void> {
  const sizeKiB = Number(args[0]);
  const label = args[1];
  const profile = args[2] === "profile";
  if (
    !Number.isInteger(sizeKiB) ||
    !SIZES_KIB.includes(sizeKiB as (typeof SIZES_KIB)[number]) ||
    (label !== "adversarial" && label !== "adversarial-late-at" && label !== "normal")
  ) {
    throw new Error("invalid child args");
  }
  const result = await executeScenario(sizeKiB, label, profile);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const childIndex = process.argv.indexOf("--child");
if (childIndex >= 0) {
  await childMain(process.argv.slice(childIndex + 1));
} else {
  await runCampaign();
}
