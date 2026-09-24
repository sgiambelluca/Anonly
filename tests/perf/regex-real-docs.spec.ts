import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DEFAULT_PATTERNS_AR } from "@anonly/regex-engine";
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";

import { installRunCollector, readRun, waitForRunSettled } from "./support/memoryProfile.js";

interface DetectionFingerprintInput {
  readonly pageIndex: number;
  readonly entityType: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly normalizedValue: string;
}

interface EventOccurrence {
  readonly pageIndex: number;
  readonly entityType: string;
  readonly normalizedValue: string;
  readonly bbox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface RegexPerfState {
  enabled: boolean;
  regexDurationMs: number | null;
  documentPageCount: number;
  emailCharsByPage: number[];
  regexInputCharsByPage: number[];
  regexProcessBlockingMs: number;
  perPatternMs: Record<string, number>;
  maxMainThreadGapMs: number;
  lastTimerTickMs: number;
  heartbeat?: ReturnType<typeof setInterval>;
  detections: DetectionFingerprintInput[];
}

interface RealRunReport {
  readonly documentId: "R1" | "R2";
  readonly round: number;
  readonly pdfKiB: number;
  readonly pageCount: number;
  readonly documentPageCount: number;
  readonly regexTextPageCount: number;
  readonly emailCharsByPage: ReadonlyArray<number>;
  readonly regexInputCharsByPage: ReadonlyArray<number>;
  readonly emailTextChars: number;
  readonly maxPageChars: number;
  readonly regexDurationMs: number | null;
  readonly regexProcessBlockingMs: number;
  readonly maxMainThreadGapMs: number;
  readonly perPatternMs: Readonly<Record<string, number>>;
  readonly entityCount: number;
  readonly detectionFingerprint: string;
}

declare global {
  var __anonlyRegexPerf: RegexPerfState | undefined;
}

const DOCUMENTS = {
  R1: { env: "ANONLY_REAL_DOC_R1" },
  R2: { env: "ANONLY_REAL_DOC_R2" },
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} no está definido.`);
  return value;
}

async function installInstrumentation(page: Page): Promise<void> {
  const patternMeta = DEFAULT_PATTERNS_AR.map((pattern) => ({
    id: pattern.id,
    source: pattern.pattern.source,
  }));
  await page.evaluate((patterns) => {
    function isRecord(value: unknown): value is Record<string, unknown> {
      return value !== null && typeof value === "object";
    }

    const state: RegexPerfState = {
      enabled: false,
      regexDurationMs: null,
      documentPageCount: 0,
      emailCharsByPage: [],
      regexInputCharsByPage: [],
      regexProcessBlockingMs: 0,
      perPatternMs: {},
      maxMainThreadGapMs: 0,
      lastTimerTickMs: 0,
      detections: [],
    };
    globalThis.__anonlyRegexPerf = state;
    const bySource = new Map(patterns.map((pattern) => [pattern.source, pattern.id]));
    const nativeExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function (this: RegExp, input: string): RegExpExecArray | null {
      const patternId = state.enabled ? bySource.get(this.source) : undefined;
      if (patternId === undefined) return nativeExec.call(this, input);
      const startedAt = performance.now();
      try {
        return nativeExec.call(this, input);
      } finally {
        const elapsedMs = performance.now() - startedAt;
        state.perPatternMs[patternId] = (state.perPatternMs[patternId] ?? 0) + elapsedMs;
      }
    };

    function pageTextMetrics(input: unknown): {
      readonly allPageLengths: number[];
      readonly emailScanLengths: number[];
    } {
      if (!isRecord(input) || !isRecord(input.document) || !Array.isArray(input.document.pages))
        return { allPageLengths: [], emailScanLengths: [] };
      const allPageLengths: number[] = [];
      const emailScanLengths: number[] = [];
      for (const page of input.document.pages) {
        const text = isRecord(page) && typeof page.text === "string" ? page.text : "";
        allPageLengths.push(text.length);
        if (text.trim().length > 0) emailScanLengths.push(text.length);
      }
      return { allPageLengths, emailScanLengths };
    }

    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("Regex perf instrumentation unavailable");
    const engines = Object.entries(core).find(([key]) => key === "engines")?.[1];
    const regexEngine = isRecord(engines) ? engines.regex : undefined;
    const originalProcess = isRecord(regexEngine) ? regexEngine.process : undefined;
    if (!isRecord(regexEngine) || typeof originalProcess !== "function") {
      throw new Error("Regex process instrumentation unavailable");
    }
    regexEngine.process = function (input: unknown, context: unknown): unknown {
      const textMetrics = pageTextMetrics(input);
      state.regexInputCharsByPage = textMetrics.allPageLengths;
      state.emailCharsByPage = textMetrics.emailScanLengths;
      const startedAt = performance.now();
      try {
        return Reflect.apply(originalProcess, regexEngine, [input, context]);
      } finally {
        state.regexProcessBlockingMs = performance.now() - startedAt;
      }
    };
  }, patternMeta);

  await page.evaluate(() => {
    function isRecord(value: unknown): value is Record<string, unknown> {
      return value !== null && typeof value === "object";
    }

    function isDetection(value: unknown): value is EventOccurrence {
      if (!isRecord(value) || !isRecord(value.bbox)) return false;
      return (
        typeof value.pageIndex === "number" &&
        typeof value.entityType === "string" &&
        typeof value.normalizedValue === "string" &&
        typeof value.bbox.x === "number" &&
        typeof value.bbox.y === "number" &&
        typeof value.bbox.width === "number" &&
        typeof value.bbox.height === "number"
      );
    }

    const core = globalThis.__anonlyCore;
    const state = globalThis.__anonlyRegexPerf;
    if (core === undefined || state === undefined)
      throw new Error("Regex perf instrumentation unavailable");
    state.enabled = true;
    state.lastTimerTickMs = performance.now();
    state.heartbeat = setInterval(() => {
      const now = performance.now();
      if (state.enabled)
        state.maxMainThreadGapMs = Math.max(state.maxMainThreadGapMs, now - state.lastTimerTickMs);
      state.lastTimerTickMs = now;
    }, 10);
    core.bus.on("regex", "REGEX_FINISHED", (payload) => {
      if (
        payload !== null &&
        typeof payload === "object" &&
        "durationMs" in payload &&
        typeof payload.durationMs === "number"
      ) {
        state.regexDurationMs = payload.durationMs;
      }
    });
    core.bus.on("pdf", "PAGE_PARSED", () => {
      state.documentPageCount += 1;
    });
    core.bus.on("regex", "ENTITY_FOUND", (payload) => {
      if (!isRecord(payload) || !isDetection(payload.occurrence)) return;
      state.detections.push({
        pageIndex: payload.occurrence.pageIndex,
        entityType: payload.occurrence.entityType,
        x: payload.occurrence.bbox.x,
        y: payload.occurrence.bbox.y,
        width: payload.occurrence.bbox.width,
        height: payload.occurrence.bbox.height,
        normalizedValue: payload.occurrence.normalizedValue,
      });
    });
  });
}

async function collectReport(
  page: Page,
  documentId: "R1" | "R2",
  round: number,
  pdfKiB: number,
): Promise<RealRunReport> {
  return await page.evaluate(
    async ({ documentId, round, pdfKiB }) => {
      const state = globalThis.__anonlyRegexPerf;
      if (state === undefined) throw new Error("Regex perf state unavailable");
      state.enabled = false;
      if (state.heartbeat !== undefined) clearInterval(state.heartbeat);
      const input = JSON.stringify(state.detections);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      const detectionFingerprint = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const emailCharsByPage = [...state.emailCharsByPage];
      const regexInputCharsByPage = [...state.regexInputCharsByPage];
      const report: RealRunReport = {
        documentId,
        round,
        pdfKiB,
        pageCount: state.documentPageCount,
        documentPageCount: state.documentPageCount,
        regexTextPageCount: emailCharsByPage.length,
        emailCharsByPage,
        regexInputCharsByPage,
        emailTextChars: emailCharsByPage.reduce((sum, count) => sum + count, 0),
        maxPageChars: Math.max(0, ...regexInputCharsByPage),
        regexDurationMs: state.regexDurationMs,
        regexProcessBlockingMs: state.regexProcessBlockingMs,
        maxMainThreadGapMs: state.maxMainThreadGapMs,
        perPatternMs: { ...state.perPatternMs },
        entityCount: state.detections.length,
        detectionFingerprint,
      };
      state.detections.length = 0;
      state.emailCharsByPage.length = 0;
      return report;
    },
    { documentId, round, pdfKiB },
  );
}

test("Regex real document control — numeric only", async ({ page }) => {
  test.setTimeout(600_000);
  const documentId = requireEnv("ANONLY_REAL_REGEX_PROFILE");
  const round = Number(requireEnv("ANONLY_REAL_REGEX_ROUND"));
  const outputDir = resolve(requireEnv("ANONLY_REAL_REGEX_OUTPUT_DIR"));
  if (documentId !== "R1" && documentId !== "R2") throw new Error("Perfil debe ser R1 o R2.");
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("Ronda fuera de rango.");
  const spec = DOCUMENTS[documentId];
  const path = requireEnv(spec.env);
  let pdfKiB: number;
  try {
    pdfKiB = Math.round((await stat(path)).size / 1024);
  } catch {
    throw new Error("No se pudo acceder al documento indicado por entorno.");
  }

  await openApp(page);
  await installInstrumentation(page);
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await installRunCollector(page, { captureOcrWords: false });
  await page.locator('input[type="file"]').setInputFiles(path);
  await waitForRunSettled(page, 600_000);
  const run = await readRun(page);
  const report = await collectReport(page, documentId, round, pdfKiB);

  const patternIds = new Set(DEFAULT_PATTERNS_AR.map((pattern) => pattern.id));
  const numericArrays = [report.emailCharsByPage, report.regexInputCharsByPage];
  const reportIsSafe =
    [
      report.round,
      report.pdfKiB,
      report.pageCount,
      report.documentPageCount,
      report.regexTextPageCount,
      report.emailTextChars,
      report.maxPageChars,
      report.regexProcessBlockingMs,
      report.maxMainThreadGapMs,
      report.entityCount,
      ...(report.regexDurationMs === null ? [] : [report.regexDurationMs]),
      ...numericArrays.flatMap((values) => [...values]),
      ...Object.values(report.perPatternMs),
    ].every(Number.isFinite) &&
    numericArrays.every((values) =>
      values.every((value) => Number.isInteger(value) && value >= 0),
    ) &&
    Object.keys(report.perPatternMs).every((id) => patternIds.has(id)) &&
    /^[a-f0-9]{64}$/.test(report.detectionFingerprint);
  if (!reportIsSafe) throw new Error("Privacy gate rejected the numeric report.");

  await mkdir(outputDir, { recursive: true });
  const outPath = resolve(outputDir, `regex-${documentId}-round${round}.json`);
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Regex control ${documentId} ronda ${round}: ${report.regexDurationMs ?? "n/a"} ms, ${report.emailTextChars} chars.\n`,
  );
  expect(run.failedAt, "real document pipeline failed").toBeUndefined();
  expect(report.documentPageCount).toBeGreaterThan(0);
});
