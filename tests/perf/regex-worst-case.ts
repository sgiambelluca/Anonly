import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEventBus } from "@anonly/event-system";
import { RegexEngine, DEFAULT_PATTERNS_AR } from "@anonly/regex-engine";
import {
  DEFAULT_DETECTION_CONFIG,
  EntityType,
  EngineEvents,
  EventChannel,
  type EngineContext,
  type FormatDefinition,
  type FormatPiece,
  type ILogger,
  type ICache,
  type Document,
  type Page,
  type UserEntityTypeDefinition,
  type Word,
} from "@anonly/shared";

import { scanEmailDefault } from "../../packages/anonymization-core/regex-engine/src/email-scanner.js";

import {
  KEYWORD_LABELS,
  expectedKeywordAddressDetections,
  isKeywordLabel,
  keywordLinearityVerdict,
  makeKeywordAdversarialText,
  type KeywordLabel,
  type KeywordLinearityVerdict,
} from "./support/regexWorstCaseKeyword.js";
import {
  Q_LABELS,
  expectedQEmailDetections,
  isQLabel,
  linearityVerdict,
  makeQAdversarialText,
  qWords,
  type LinearityVerdict,
  type QLabel,
} from "./support/regexWorstCaseQ.js";

const KIB = 1024;
const SIZES_KIB = [2, 10, 20, 40, 80, 160] as const;
const CHILD_TIMEOUT_MS = 65_000;
type Label = "adversarial" | "adversarial-late-at" | "normal" | QLabel | KeywordLabel;

/**
 * `ANONLY_REGEX_WORST_LABELS=keyword` corre solo los textos del patrón de dirección con palabra clave
 * (ADR-217); `email` corre solo los del email; `formats` corre solo los arneses de los formatos del
 * generador (ADR-220, al final del archivo). Sin la variable corren todos, menos los de formatos.
 */
const LABEL_FILTER = process.env.ANONLY_REGEX_WORST_LABELS ?? "";
if (
  LABEL_FILTER !== "" &&
  LABEL_FILTER !== "keyword" &&
  LABEL_FILTER !== "email" &&
  LABEL_FILTER !== "formats"
)
  throw new Error(`ANONLY_REGEX_WORST_LABELS inválida: ${LABEL_FILTER}`);

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
  /** Direcciones que da el patrón con palabra clave (`source: "regex"`) sobre un texto de su familia. */
  readonly expectedAddressDetections: number;
  readonly observedAddressDetections: number;
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
  /** Caso `Q email search stays linear on adversarial text` (ADR-211): curva y pasos de duplicación. */
  readonly qLinearity: ReadonlyArray<LinearityVerdict>;
  /** Caso `keyword address search stays linear on adversarial text` (ADR-217): curva y pasos de duplicación. */
  readonly keywordLinearity: ReadonlyArray<KeywordLinearityVerdict>;
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
    detection: DEFAULT_DETECTION_CONFIG,
  };
}

function makeText(chars: number, label: Label): string {
  if (isQLabel(label)) return makeQAdversarialText(chars, label);
  if (isKeywordLabel(label)) return makeKeywordAdversarialText(chars, label);
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

function documentFor(text: string, documentId: string, label: Label): Document {
  // La búsqueda con Q (ADR-211) solo corre sobre palabras de OCR; el resto de los casos sigue siendo texto de PDF.
  const ocr = isQLabel(label);
  const words: ReadonlyArray<Word> = (ocr ? qWords(text) : [text]).map((wordText) => ({
    text: wordText,
    bbox: { x: 1, y: 1, width: 1, height: 1 },
    pageIndex: 0,
    confidence: 1,
    source: ocr ? ("ocr" as const) : ("pdf" as const),
  }));
  const page: Page = {
    index: 0,
    width: 595,
    height: 842,
    words,
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
  let addressDetections = 0;
  bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, ({ occurrence }) => {
    if (occurrence.entityType === EntityType.Email) emailDetections += 1;
    if (occurrence.entityType === EntityType.Address) addressDetections += 1;
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
    await engine.process({ document: documentFor(text, "regex-bench", label) }, context);
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
    expectedEmailDetections: isQLabel(label)
      ? expectedQEmailDetections(label)
      : label === "normal"
        ? [...text.matchAll(/control\d+@example\.test/gu)].length
        : 0,
    observedEmailDetections: emailDetections,
    expectedAddressDetections: isKeywordLabel(label) ? expectedKeywordAddressDetections() : 0,
    observedAddressDetections: addressDetections,
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
      const emailLabels: ReadonlyArray<Label> =
        round === 1
          ? ["normal", "adversarial", "adversarial-late-at", ...Q_LABELS]
          : ["adversarial", "adversarial-late-at", "normal", ...Q_LABELS];
      const labels: ReadonlyArray<Label> =
        LABEL_FILTER === "keyword"
          ? [...KEYWORD_LABELS]
          : LABEL_FILTER === "email"
            ? emailLabels
            : [...emailLabels, ...KEYWORD_LABELS];
      for (const label of labels) {
        const child = await launchChild(sizeKiB, label, false);
        const record = await parseChild(child, round + 1, sizeKiB, label, "plain");
        rounds.push(record);
        if (child.censored) continue;
      }
      if (!profilesDone.has(sizeKiB) && LABEL_FILTER !== "email") {
        // Un perfil por patrón para cada texto del patrón con palabra clave: dice si el tiempo es suyo.
        for (const keywordLabel of KEYWORD_LABELS) {
          const keywordChild = await launchChild(sizeKiB, keywordLabel, true);
          rounds.push(
            await parseChild(keywordChild, round + 1, sizeKiB, keywordLabel, "pattern-profile"),
          );
        }
        // Con el filtro «keyword» no corre el bloque del email, que es el que marca el tamaño como perfilado.
        if (LABEL_FILTER === "keyword") profilesDone.add(sizeKiB);
      }
      if (!profilesDone.has(sizeKiB) && LABEL_FILTER !== "keyword") {
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
    qLinearity: qLinearity(rounds),
    keywordLinearity: keywordLinearity(rounds),
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
  for (const verdict of report.qLinearity) {
    if (verdict.curve.length === 0) continue;
    const curve = verdict.curve
      .map((point) => `${point.sizeKiB} KiB: ${point.ms.toFixed(2)} ms`)
      .join("; ");
    const ratios = verdict.steps
      .map(
        (step) =>
          `${step.fromKiB}>${step.toKiB}: x${step.ratio === null ? "n/d" : step.ratio.toFixed(2)}${step.belowNoiseFloor ? " (ruido)" : ""}`,
      )
      .join("; ");
    process.stdout.write(
      `Q ${verdict.label}: ${curve}\n  duplicar: ${ratios}\n  superlineal: ${String(verdict.superLinear)} (pasos interpretables: ${verdict.interpretableSteps})\n`,
    );
  }
  for (const verdict of report.keywordLinearity) {
    if (verdict.curve.length === 0) continue;
    const curve = verdict.curve
      .map((point) => `${point.sizeKiB} KiB: ${point.ms.toFixed(2)} ms`)
      .join("; ");
    const ratios = verdict.steps
      .map(
        (step) =>
          `${step.fromKiB}>${step.toKiB}: x${step.ratio === null ? "n/d" : step.ratio.toFixed(2)}${step.belowNoiseFloor ? " (ruido)" : ""}`,
      )
      .join("; ");
    process.stdout.write(
      `Dirección ${verdict.label}: ${curve}\n  duplicar: ${ratios}\n  superlineal: ${String(verdict.superLinear)} (pasos interpretables: ${verdict.interpretableSteps})\n`,
    );
  }
  // El caso de ADR-211 falla si algún paso de duplicación cuadruplica el trabajo sobre el ruido, o si las
  // detecciones no son las esperadas. No hay gate temporal absoluto (criterio de ADR-181).
  // El de ADR-217, igual, con la dirección del final como detección esperada.
  if (
    report.qLinearity.some((verdict) => verdict.superLinear) ||
    report.keywordLinearity.some((verdict) => verdict.superLinear) ||
    report.qualityMismatchCount > 0
  )
    process.exitCode = 1;
}

function qLinearity(records: ReadonlyArray<RunRecord>): ReadonlyArray<LinearityVerdict> {
  return Q_LABELS.map((label) =>
    linearityVerdict(
      label,
      records.flatMap((record) =>
        record.pass === "plain" &&
        record.label === label &&
        record.status === "completed" &&
        record.result !== undefined
          ? [{ sizeKiB: record.sizeKiB, ms: record.result.processMs }]
          : [],
      ),
    ),
  );
}

function keywordLinearity(
  records: ReadonlyArray<RunRecord>,
): ReadonlyArray<KeywordLinearityVerdict> {
  return KEYWORD_LABELS.map((label) =>
    keywordLinearityVerdict(
      label,
      records.flatMap((record) =>
        record.pass === "plain" &&
        record.label === label &&
        record.status === "completed" &&
        record.result !== undefined
          ? [{ sizeKiB: record.sizeKiB, ms: record.result.processMs }]
          : [],
      ),
    ),
  );
}

function qualityMismatchCount(records: ReadonlyArray<RunRecord>): number {
  const fingerprints = new Map<string, string>();
  let mismatches = 0;
  for (const record of records) {
    if (record.status !== "completed" || record.result === undefined) continue;
    const result = record.result;
    if (
      (result.label === "normal" || isQLabel(result.label)) &&
      result.expectedEmailDetections !== result.observedEmailDetections
    ) {
      mismatches += 1;
    }
    if (
      isKeywordLabel(result.label) &&
      result.expectedAddressDetections !== result.observedAddressDetections
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
  const requested = args[1] ?? "";
  const profile = args[2] === "profile";
  const label: Label | undefined =
    requested === "adversarial" || requested === "adversarial-late-at" || requested === "normal"
      ? requested
      : isQLabel(requested) || isKeywordLabel(requested)
        ? requested
        : undefined;
  if (
    !Number.isInteger(sizeKiB) ||
    !SIZES_KIB.includes(sizeKiB as (typeof SIZES_KIB)[number]) ||
    label === undefined
  ) {
    throw new Error("invalid child args");
  }
  const result = await executeScenario(sizeKiB, label, profile);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// ─── Formatos del generador (1.1, ADR-220) ───
//
// `ANONLY_REGEX_WORST_LABELS=formats` corre solo estos dos arneses, en proceso y sin hijos:
// - `user format scan stays linear on long adversarial pages` (caso 43): ocho piezas `digit 1..8` pegadas, el
//   formato que con `RegExp` dispararía retroceso catastrófico, sobre páginas largas de tres formas.
// - `cost with 10, 50 y 200 user formats` (`roadmap/Plan_1.1.md` §7): cuánto suma cada formato prendido a una
//   página, para decidir si hace falta un tope de cantidad (`Regex_Engine.md` §12).
// No es un gate: no hay umbral de tiempo absoluto (criterio de ADR-181). Falla solo si duplicar el texto más que
// cuadruplica el trabajo sobre el ruido.

const FORMAT_PAGE_CHARS = [25_000, 50_000, 100_000, 200_000] as const;
const FORMAT_COUNTS = [10, 50, 200] as const;
const FORMAT_REPEATS = 5;
/** Debajo de esto, un paso de duplicación no se interpreta: es ruido de medición. */
const FORMAT_NOISE_FLOOR_MS = 5;
const FORMAT_SUPERLINEAR_RATIO = 3;
const PERF_USER_TYPE: UserEntityTypeDefinition = {
  id: "user:00000000-0000-4000-8000-0000000000aa",
  name: "Perf",
};

type FormatPageKind = "digits" | "words" | "near-miss";

function formatPageText(chars: number, kind: FormatPageKind): string {
  const unit = kind === "digits" ? "1" : kind === "words" ? "12345678 " : `${"1".repeat(65)} `;
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

function perfFormat(n: number, pieces: ReadonlyArray<FormatPiece>): FormatDefinition {
  return {
    id: `fmt:00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    name: `Perf ${n}`,
    entityType: PERF_USER_TYPE.id,
    variants: [pieces],
    enabled: true,
  };
}

const digitsOf = (min: number, max: number): FormatPiece => ({
  kind: "chars",
  charClass: "digit",
  min,
  max,
});

/** El formato del caso 43: ocho piezas `digit 1..8` pegadas. */
const ADJACENT_FORMAT = perfFormat(
  1,
  Array.from({ length: 8 }, () => digitsOf(1, 8)),
);

/** `count` formatos distintos, de formas parecidas a las que escribiría un usuario. */
function manyFormats(count: number): ReadonlyArray<FormatDefinition> {
  return Array.from({ length: count }, (_, index) => {
    const pieces: FormatPiece[] = [
      digitsOf(3 + (index % 5), 3 + (index % 5)),
      { kind: "separator", chars: ["-", " "], optional: true },
      digitsOf(2 + (index % 4), 2 + (index % 4)),
      { kind: "optional", pieces: [{ kind: "text", value: "/" }, digitsOf(2, 2)] },
    ];
    return {
      ...perfFormat(index + 1, pieces),
      ...(index % 3 === 0 ? { contextBefore: ["Ref", "Expediente"] } : {}),
    };
  });
}

/** Una página de texto corriente con números de formas parecidas a las de `manyFormats`. */
function numericRichText(chars: number): string {
  const unit = "Ref 12345-67 y Expediente 123 45/67, tel 4567 8900. Cuenta 99887-66 ok. ";
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

async function timeFormatProcess(
  text: string,
  formats: ReadonlyArray<FormatDefinition>,
): Promise<{ readonly ms: number; readonly occurrences: number }> {
  const bus = createEventBus({ logger: NULL_LOGGER });
  let occurrences = 0;
  bus.on(EventChannel.Regex, EngineEvents.ENTITY_FOUND, () => {
    occurrences += 1;
  });
  const context: EngineContext = {
    bus,
    logger: NULL_LOGGER,
    cache: NULL_CACHE,
    abortSignal: new AbortController().signal,
    config: {
      ...buildConfig(),
      detection: { ...DEFAULT_DETECTION_CONFIG, userTypes: [PERF_USER_TYPE], userFormats: formats },
    },
  };
  const engine = new RegexEngine();
  await engine.init(context);
  const started = performance.now();
  await engine.process({ document: documentFor(text, "regex-formats", "normal") }, context);
  const ms = performance.now() - started;
  await engine.dispose();
  return { ms, occurrences };
}

async function medianFormatMs(
  text: string,
  formats: ReadonlyArray<FormatDefinition>,
): Promise<number> {
  const samples: number[] = [];
  for (let run = 0; run < FORMAT_REPEATS; run += 1) {
    samples.push((await timeFormatProcess(text, formats)).ms);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

async function runFormatHarness(): Promise<void> {
  let superLinear = false;

  // Caso 43: lo que suma el formato sobre lo que cuestan los formatos base de la misma página.
  for (const kind of ["digits", "words", "near-miss"] as const) {
    const curve: Array<{ readonly chars: number; readonly ms: number }> = [];
    for (const chars of FORMAT_PAGE_CHARS) {
      const text = formatPageText(chars, kind);
      const base = await medianFormatMs(text, []);
      const withFormat = await medianFormatMs(text, [ADJACENT_FORMAT]);
      curve.push({ chars, ms: Math.max(withFormat - base, 0) });
    }
    const steps = curve.slice(1).map((point, index) => {
      const previous = curve[index];
      const ratio =
        previous === undefined || previous.ms < FORMAT_NOISE_FLOOR_MS
          ? null
          : point.ms / previous.ms;
      return { from: previous?.chars ?? 0, to: point.chars, ratio };
    });
    const kindSuperLinear = steps.some(
      (step) => step.ratio !== null && step.ratio > FORMAT_SUPERLINEAR_RATIO,
    );
    superLinear ||= kindSuperLinear;
    process.stdout.write(
      `Formato adyacente, página «${kind}»: ${curve
        .map((point) => `${point.chars} car.: ${point.ms.toFixed(2)} ms`)
        .join("; ")}\n  duplicar: ${steps
        .map(
          (step) =>
            `${step.from}>${step.to}: x${step.ratio === null ? "n/d (ruido)" : step.ratio.toFixed(2)}`,
        )
        .join("; ")}\n  superlineal: ${String(kindSuperLinear)}\n`,
    );
  }

  // 10, 50 y 200 formatos prendidos sobre una página de 100 000 caracteres.
  const text = numericRichText(100_000);
  const baseMs = await medianFormatMs(text, []);
  process.stdout.write(`Costo con N formatos, página de ${text.length} caracteres\n`);
  process.stdout.write(`  0 formatos (solo base): ${baseMs.toFixed(2)} ms\n`);
  for (const count of FORMAT_COUNTS) {
    const formats = manyFormats(count);
    const ms = await medianFormatMs(text, formats);
    const detections = (await timeFormatProcess(text, formats)).occurrences;
    process.stdout.write(
      `  ${count} formatos: ${ms.toFixed(2)} ms; suma ${(ms - baseMs).toFixed(2)} ms, ` +
        `${((ms - baseMs) / count).toFixed(3)} ms por formato; detecciones: ${detections}\n`,
    );
  }
  if (superLinear) process.exitCode = 1;
}

const childIndex = process.argv.indexOf("--child");
if (childIndex >= 0) {
  await childMain(process.argv.slice(childIndex + 1));
} else if (LABEL_FILTER === "formats") {
  await runFormatHarness();
} else {
  await runCampaign();
}
