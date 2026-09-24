/** Opt-in OCR recognizer pool campaign. Real PDFs stay inside this Electron renderer. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Word } from "@anonly/shared";
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import { hostIdentity, type TimeRun } from "./support/timeProfile.js";

declare global {
  var __anonlyOcrPoolProbe:
    | {
        readonly requestedPoolSize: number;
        readonly profile: string;
        readonly runId: string;
        startedAt: number | null;
        finishedAt: number | null;
        readyAt: number | null;
        cancelledAt: number | null;
        cancelRequestedAt: number | null;
        cancelActiveOcrJobs: number;
        ocrPageFailures: number;
        pageParsed: Array<{
          readonly pageIndex: number;
          readonly wordCount: number;
          readonly requiresOCR: boolean;
        }>;
        rgbaEstimates: Array<{
          readonly pageIndex: number;
          readonly estimatedBytes: number | null;
        }>;
        ocrPages: Array<{
          readonly pageIndex: number;
          readonly wordCount: number;
          readonly characterCount: number;
          readonly confidence: number;
        }>;
        nerPages: Array<{ readonly pageIndex: number; readonly occurrenceCount: number }>;
        workerEvents: Array<{
          readonly type: string;
          readonly epochMs: number;
          readonly delta: 1 | -1;
        }>;
        saturationEvents: Array<{
          readonly type: string;
          readonly queueLength: number;
          readonly epochMs: number;
        }>;
        ocrWords: Array<{ readonly pageIndex: number; readonly words: ReadonlyArray<Word> }>;
        occurrenceSignatures: string[];
        groupSignatures: string[];
        failed: boolean;
      }
    | undefined;
}

const RUN_ID = process.env.ANONLY_OCR_POOL_RUN;
const OUTPUT_DIR = process.env.ANONLY_OCR_POOL_OUTPUT_DIR;
const CANCELLATION_SLA_MS = 200;
type Profile = "P1" | "P2" | "R1" | "R2";
type Arm = 2 | 3 | 4;
type RunKind = "memory" | "time" | "cancel";
type MemoryProbeRun = { readonly temperature: string; readonly probe: Record<string, unknown> };
let memoryRuns: MemoryProbeRun[] = [];

interface OcrPoolSummary {
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly occurrenceCount: number;
  readonly groupCount: number;
  readonly groupSha256: string;
  readonly ocrQualitySha256: string;
  readonly occurrenceSha256: string;
  readonly failed: boolean;
  readonly ocrPageCount: number;
  readonly missingWordCachePages: number;
  readonly cancelActiveOcrJobs: number;
  readonly cancelLatencyMs: number | null;
  readonly ocrPageFailures: number;
  readonly effectiveBusyRecognizersPeak: number;
  readonly effectiveBusyOsdPeak: number;
  readonly effectiveConfiguredRecognizerPoolSize: number;
  readonly [key: string]: unknown;
}

async function p2File(): Promise<E2eFilePayload> {
  return getOrGenerateScannedFixture(
    "ocr-pool-p2-scanned-50p",
    new Uint8Array(await generateText50p()),
  );
}

async function inputFile(profile: Profile): Promise<E2eFilePayload> {
  if (profile === "P1") return textTenPagesFile();
  if (profile === "P2") return p2File();
  const envKey = profile === "R1" ? "ANONLY_REAL_DOC_R1" : "ANONLY_REAL_DOC_R2";
  const path = process.env[envKey];
  if (path === undefined || path === "") throw new Error(`${envKey} no está definido.`);
  return {
    name: `${profile.toLowerCase()}.pdf`,
    mimeType: "application/pdf",
    buffer: await readFile(path),
  };
}

function parseRunId(): {
  readonly arm: Arm;
  readonly profile: Profile;
  readonly round: number;
  readonly kind: RunKind;
} {
  if (RUN_ID === undefined || RUN_ID === "") throw new Error("ANONLY_OCR_POOL_RUN no definido.");
  const match = /^(memory|time|cancel)-(2|3|4)-(P1|P2|R1|R2)-r([0-2])$/.exec(RUN_ID);
  if (match === null) throw new Error(`Corrida desconocida: ${RUN_ID}`);
  return {
    kind: match[1] as RunKind,
    arm: Number(match[2]) as Arm,
    profile: match[3] as Profile,
    round: Number(match[4]),
  };
}

async function installProbe(
  page: Page,
  run: ReturnType<typeof parseRunId> & { readonly runId: string },
): Promise<void> {
  await page.evaluate(
    (input) => {
      const core = globalThis.__anonlyCore;
      if (core === undefined) throw new Error("__anonlyCore ausente: build sin VITE_E2E=1");
      const probeCore = core as typeof core & {
        readonly bus: typeof core.bus & {
          readonly emit?: (channel: string, event: string, payload: unknown) => void;
        };
        readonly orchestrator?: {
          readonly getPageSize?: (
            documentId: string,
            pageIndex: number,
          ) => { readonly width: number; readonly height: number };
        };
      };
      const probe: NonNullable<typeof globalThis.__anonlyOcrPoolProbe> = {
        requestedPoolSize: input.arm,
        profile: input.profile,
        runId: input.runId,
        startedAt: null,
        finishedAt: null,
        readyAt: null,
        cancelledAt: null,
        cancelRequestedAt: null,
        cancelActiveOcrJobs: 0,
        ocrPageFailures: 0,
        pageParsed: [],
        rgbaEstimates: [],
        ocrPages: [],
        nerPages: [],
        workerEvents: [],
        saturationEvents: [],
        ocrWords: [],
        occurrenceSignatures: [],
        groupSignatures: [],
        failed: false,
      };
      globalThis.__anonlyOcrPoolProbe = probe;
      const instrumentCore = core as typeof core & {
        readonly engines?: {
          readonly ocr?: {
            readonly ctx?: {
              readonly config?: {
                readonly workerPool?: { readonly ocrPoolSize?: number };
                readonly ocr?: { readonly maxLiveImageBytes?: number; readonly dpi?: number };
              };
            };
          };
        };
      };
      const effective = instrumentCore.engines?.ocr?.ctx?.config;
      if (effective === undefined)
        throw new Error("No se pudo leer la config efectiva OCR del motor");
      if (effective?.workerPool?.ocrPoolSize !== input.arm)
        throw new Error(
          `Override OCR no efectivo: pedido=${input.arm}, efectivo=${effective?.workerPool?.ocrPoolSize ?? "no observable"}`,
        );
      if (effective.ocr?.maxLiveImageBytes !== 128 * 1024 * 1024)
        throw new Error("ocr.maxLiveImageBytes no es 128 MiB");
      const active = new Map<string, string>();
      let documentId: string | undefined;
      let cancellationScheduled = false;
      const scheduleCancellation = (): void => {
        if (input.kind !== "cancel" || cancellationScheduled) return;
        cancellationScheduled = true;
        globalThis.setTimeout(() => {
          const activeOcr = [...active.values()].filter((type) => type === "ocr-page").length;
          probe.cancelActiveOcrJobs = activeOcr;
          probe.cancelRequestedAt = Date.now();
          if (documentId === undefined || typeof probeCore.bus.emit !== "function")
            throw new Error("No se pudo emitir CANCEL_REQUESTED");
          probeCore.bus.emit("pipeline", "CANCEL_REQUESTED", { documentId });
        }, 20);
      };
      core.bus.on("pipeline", "DOCUMENT_IMPORTED", (payload: unknown) => {
        probe.pageParsed = [];
        probe.rgbaEstimates = [];
        probe.ocrPages = [];
        probe.nerPages = [];
        probe.workerEvents = [];
        probe.saturationEvents = [];
        probe.ocrWords = [];
        probe.occurrenceSignatures = [];
        probe.groupSignatures = [];
        probe.startedAt = null;
        probe.finishedAt = null;
        probe.readyAt = null;
        probe.cancelledAt = null;
        probe.cancelRequestedAt = null;
        probe.ocrPageFailures = 0;
        probe.failed = false;
        if (
          typeof payload === "object" &&
          payload !== null &&
          "documentId" in payload &&
          typeof payload.documentId === "string"
        )
          documentId = payload.documentId;
      });
      core.bus.on("pdf", "PAGE_PARSED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const value = payload as {
          pageIndex?: unknown;
          wordCount?: unknown;
          requiresOCR?: unknown;
        };
        if (
          typeof value.pageIndex === "number" &&
          typeof value.wordCount === "number" &&
          typeof value.requiresOCR === "boolean"
        ) {
          probe.pageParsed.push({
            pageIndex: value.pageIndex,
            wordCount: value.wordCount,
            requiresOCR: value.requiresOCR,
          });
          if (value.requiresOCR) {
            let size: { readonly width: number; readonly height: number } | undefined;
            try {
              size =
                typeof documentId === "string" &&
                typeof probeCore.orchestrator?.getPageSize === "function"
                  ? probeCore.orchestrator.getPageSize(documentId, value.pageIndex)
                  : undefined;
            } catch {
              size = undefined;
            }
            const dpi = effective.ocr?.dpi ?? 300;
            const estimatedBytes =
              size === undefined
                ? null
                : Math.ceil((size.width * dpi) / 72) * Math.ceil((size.height * dpi) / 72) * 4;
            probe.rgbaEstimates.push({ pageIndex: value.pageIndex, estimatedBytes });
          }
        }
      });
      core.bus.on("ocr", "OCR_STARTED", () => {
        probe.startedAt = Date.now();
      });
      core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const value = payload as { pageIndex?: unknown; wordCount?: unknown; confidence?: unknown };
        if (
          typeof value.pageIndex !== "number" ||
          typeof value.wordCount !== "number" ||
          typeof value.confidence !== "number"
        )
          return;
        const ocr = (
          core as typeof core & {
            readonly engines?: {
              readonly ocr?: {
                readonly ctx?: {
                  readonly cache?: { readonly get: <T>(key: string) => T | undefined };
                };
              };
            };
          }
        ).engines?.ocr;
        const words =
          documentId === undefined
            ? undefined
            : ocr?.ctx?.cache?.get<ReadonlyArray<Word>>(
                `ocr-words:${documentId}:${value.pageIndex}`,
              );
        const characterCount = words?.reduce((sum, word) => sum + word.text.length, 0) ?? null;
        probe.ocrPages.push({
          pageIndex: value.pageIndex,
          wordCount: value.wordCount,
          characterCount: characterCount ?? -1,
          confidence: value.confidence,
        });
        if (words !== undefined) probe.ocrWords.push({ pageIndex: value.pageIndex, words });
      });
      core.bus.on("ocr", "OCR_FINISHED", () => {
        probe.finishedAt = Date.now();
      });
      core.bus.on("ocr", "OCR_PAGE_FAILED", () => {
        probe.ocrPageFailures += 1;
      });
      core.bus.on("pipeline", "PIPELINE_READY", () => {
        probe.readyAt = Date.now();
      });
      core.bus.on("pipeline", "PIPELINE_FAILED", () => {
        probe.failed = true;
      });
      core.bus.on("pipeline", "PIPELINE_CANCELLED", () => {
        probe.cancelledAt = Date.now();
      });
      core.bus.on("ner", "NER_PAGE_FINISHED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const value = payload as { pageIndex?: unknown; occurrenceCount?: unknown };
        if (typeof value.pageIndex === "number" && typeof value.occurrenceCount === "number")
          probe.nerPages.push({
            pageIndex: value.pageIndex,
            occurrenceCount: value.occurrenceCount,
          });
      });
      const occurrenceSignature = (payload: unknown): string => {
        if (typeof payload !== "object" || payload === null || !("occurrence" in payload))
          return "invalid-occurrence";
        const occurrence = payload.occurrence;
        if (typeof occurrence !== "object" || occurrence === null) return "invalid-occurrence";
        const item = occurrence as Record<string, unknown>;
        return JSON.stringify([
          item.pageIndex,
          item.entityType,
          item.value,
          item.normalizedValue,
          item.confidence,
          item.source,
          item.bbox,
          item.fragments,
        ]);
      };
      core.bus.on("ner", "ENTITY_FOUND", (payload: unknown) => {
        probe.occurrenceSignatures.push(occurrenceSignature(payload));
      });
      core.bus.on("regex", "ENTITY_FOUND", (payload: unknown) => {
        probe.occurrenceSignatures.push(occurrenceSignature(payload));
      });
      core.bus.on("grouping", "ENTITY_GROUP_CREATED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null || !("group" in payload)) return;
        const group = payload.group;
        if (typeof group !== "object" || group === null) return;
        const item = group as Record<string, unknown>;
        const members = Array.isArray(item.members)
          ? item.members.map((member: unknown) => {
              if (typeof member !== "object" || member === null) return null;
              const value = member as Record<string, unknown>;
              return [value.pageIndex, value.value, value.normalizedValue, value.source];
            })
          : [];
        probe.groupSignatures.push(
          JSON.stringify([
            item.type,
            item.canonicalValue,
            item.replacementMode,
            item.replacementValue,
            item.enabled,
            members,
          ]),
        );
      });
      core.bus.on("workers", "WORKER_JOB_DISPATCHED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const value = payload as { jobId?: unknown; type?: unknown };
        if (typeof value.jobId !== "string" || typeof value.type !== "string") return;
        active.set(value.jobId, value.type);
        probe.workerEvents.push({ type: value.type, epochMs: Date.now(), delta: 1 });
        if (value.type === "ocr-page") scheduleCancellation();
      });
      core.bus.on("workers", "WORKER_POOL_SATURATED", (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return;
        const value = payload as { type?: unknown; queueLength?: unknown };
        if (typeof value.type === "string" && typeof value.queueLength === "number") {
          probe.saturationEvents.push({
            type: value.type,
            queueLength: value.queueLength,
            epochMs: Date.now(),
          });
        }
      });
      for (const event of [
        "WORKER_JOB_COMPLETED",
        "WORKER_JOB_FAILED",
        "WORKER_JOB_CANCELLED",
        "WORKER_JOB_TIMEOUT",
      ] as const) {
        core.bus.on("workers", event, (payload: unknown) => {
          if (
            typeof payload !== "object" ||
            payload === null ||
            !("jobId" in payload) ||
            typeof payload.jobId !== "string"
          )
            return;
          const type = active.get(payload.jobId);
          if (type === undefined) return;
          active.delete(payload.jobId);
          probe.workerEvents.push({ type, epochMs: Date.now(), delta: -1 });
        });
      }
    },
    { ...run, runId: RUN_ID ?? "" },
  );
}

async function readProbe(page: Page): Promise<OcrPoolSummary> {
  return page.evaluate(async () => {
    const probe = globalThis.__anonlyOcrPoolProbe;
    if (probe === undefined) throw new Error("OCR probe ausente");
    const digest = async (values: ReadonlyArray<string>): Promise<string> => {
      const bytes = new TextEncoder().encode([...values].sort().join("\n"));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const canonicalWords = probe.ocrWords.flatMap((entry) =>
      entry.words.map((word) =>
        JSON.stringify({
          pageIndex: word.pageIndex,
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox,
          source: word.source,
        }),
      ),
    );
    const byPage = new Map<number, number[]>();
    for (const entry of probe.ocrPages)
      byPage.set(entry.pageIndex, [entry.wordCount, entry.characterCount, entry.confidence]);
    const pageValues = [...byPage.entries()].sort(([a], [b]) => a - b);
    const stats = (
      values: ReadonlyArray<number>,
    ): {
      readonly median: number | null;
      readonly p90: number | null;
      readonly p95: number | null;
      readonly min: number | null;
      readonly max: number | null;
    } => {
      if (values.length === 0) return { median: null, p90: null, p95: null, min: null, max: null };
      const sorted = [...values].sort((a, b) => a - b);
      const quantile = (p: number): number | null =>
        sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? null;
      return {
        median: sorted[Math.floor(sorted.length / 2)] ?? null,
        p90: quantile(0.9),
        p95: quantile(0.95),
        min: sorted[0] ?? null,
        max: sorted.at(-1) ?? null,
      };
    };
    const activeCounts = new Map<string, number>();
    let ocrPeak = 0;
    let orientationPeak = 0;
    let renderPeak = 0;
    for (const event of [...probe.workerEvents].sort((a, b) => a.epochMs - b.epochMs)) {
      const next = Math.max(0, (activeCounts.get(event.type) ?? 0) + event.delta);
      activeCounts.set(event.type, next);
      if (event.type === "ocr-page") ocrPeak = Math.max(ocrPeak, next);
      if (event.type === "ocr-orient") orientationPeak = Math.max(orientationPeak, next);
      if (event.type === "render-page") renderPeak = Math.max(renderPeak, next);
    }
    const parsed = [...probe.pageParsed].sort((a, b) => a.pageIndex - b.pageIndex);
    const requestWindow = probe.requestedPoolSize === 2 ? 3 : probe.requestedPoolSize;
    const estimates = [...probe.rgbaEstimates].sort((a, b) => a.pageIndex - b.pageIndex);
    let estimatedReservationWindowPeakBytes = 0;
    for (let start = 0; start < estimates.length; start += 1) {
      const window = estimates.slice(start, start + requestWindow);
      const sum = window.reduce((total, item) => total + (item.estimatedBytes ?? 0), 0);
      estimatedReservationWindowPeakBytes = Math.max(estimatedReservationWindowPeakBytes, sum);
    }
    const ocrValues = pageValues.map(([, values]) => values);
    const wordCounts = ocrValues.map((values) => values[0] ?? 0);
    const characterCounts = ocrValues.map((values) => values[1] ?? 0);
    const confidences = ocrValues.map((values) => values[2] ?? 0);
    return {
      requestedPoolSize: probe.requestedPoolSize,
      profile: probe.profile,
      runId: probe.runId,
      startedAt: probe.startedAt,
      finishedAt: probe.finishedAt,
      readyAt: probe.readyAt,
      cancelRequestedAt: probe.cancelRequestedAt,
      cancelledAt: probe.cancelledAt,
      cancelLatencyMs:
        probe.cancelRequestedAt === null || probe.cancelledAt === null
          ? null
          : probe.cancelledAt - probe.cancelRequestedAt,
      cancelActiveOcrJobs: probe.cancelActiveOcrJobs,
      ocrPageFailures: probe.ocrPageFailures,
      pageParsed: parsed,
      textlessPageCount: parsed.filter((page) => page.wordCount === 0).length,
      requiresOcrPageCount: parsed.filter((page) => page.requiresOCR).length,
      nerJobsByPage: [...probe.nerPages].sort((a, b) => a.pageIndex - b.pageIndex),
      pageRgbaEstimates: probe.rgbaEstimates,
      maxSinglePageRgbaEstimateBytes: Math.max(
        0,
        ...probe.rgbaEstimates.flatMap((item) =>
          item.estimatedBytes === null ? [] : [item.estimatedBytes],
        ),
      ),
      estimatedReservationWindowPeakBytes,
      reservationBudgetBytes: 128 * 1024 * 1024,
      estimatedWindowExceedsReservationBudget:
        estimatedReservationWindowPeakBytes > 128 * 1024 * 1024,
      reservationWaitObserved: false,
      reservationWaitObservation:
        "LiveImageBudget no publica evento ni getter; el exceso de suma es un indicador de espera potencial, no una medición de espera real.",
      ocrPages: [...probe.ocrPages].sort((a, b) => a.pageIndex - b.pageIndex),
      ocrPageCount: probe.ocrPages.length,
      ocrWordCountByPage: stats(wordCounts),
      ocrCharacterCountByPage: stats(characterCounts.filter((n) => n >= 0)),
      totalOcrWords: wordCounts.reduce((sum, value) => sum + value, 0),
      totalOcrCharacters: characterCounts
        .filter((n) => n >= 0)
        .reduce((sum, value) => sum + value, 0),
      confidenceByPage: stats(confidences),
      missingWordCachePages: probe.ocrPages.filter((page) => page.characterCount < 0).length,
      ocrQualitySha256: await digest(canonicalWords),
      occurrenceCount: probe.occurrenceSignatures.length,
      occurrenceSha256: await digest(probe.occurrenceSignatures),
      groupCount: probe.groupSignatures.length,
      groupSha256: await digest(probe.groupSignatures),
      effectiveBusyRecognizersPeak: ocrPeak,
      effectiveBusyOsdPeak: orientationPeak,
      effectiveConfiguredRecognizerPoolSize: probe.requestedPoolSize,
      effectiveMaxLiveImageBytes: 128 * 1024 * 1024,
      workerPoolSaturationEvents: probe.saturationEvents,
      rasterJobsPeakDuringOcr: renderPeak,
      requestedConcurrentRequestsByContract:
        probe.requestedPoolSize === 2 ? 3 : probe.requestedPoolSize,
      workerEvents: probe.workerEvents,
      failed: probe.failed,
    };
  });
}

async function runTimed(page: Page, file: E2eFilePayload, timeoutMs: number): Promise<TimeRun> {
  const startedAt = Date.now();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForFunction(
    () => {
      const probe = globalThis.__anonlyOcrPoolProbe;
      return probe !== undefined && (probe.readyAt !== null || probe.failed);
    },
    undefined,
    { timeout: timeoutMs },
  );
  const finishedAt = Date.now();
  const probe = await readProbe(page);
  return {
    temperature: "cold",
    marks: {},
    marksEpochMs: {},
    totalMs: finishedAt - startedAt,
    intervalsMs: {
      ocrMs:
        typeof probe.startedAt === "number" && typeof probe.finishedAt === "number"
          ? probe.finishedAt - probe.startedAt
          : null,
    },
    uiImportToImportedMs: null,
    readyToPanelMs: null,
    entityCount: Number(probe.occurrenceCount),
    groupCount: Number(probe.groupCount),
    qualityFingerprint: String(probe.groupSha256),
    ocrFingerprint: String(probe.ocrQualitySha256),
    detectionFingerprint: String(probe.occurrenceSha256),
    m2: {},
    nerProbe: null,
    ok: probe.failed !== true,
  };
}

function outputDir(): string {
  if (OUTPUT_DIR === undefined || OUTPUT_DIR === "")
    throw new Error("ANONLY_OCR_POOL_OUTPUT_DIR no definido.");
  return OUTPUT_DIR;
}

test("OCR recognizer pool campaign — selected run", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  const run = parseRunId();
  const startedAtUtc = new Date().toISOString();
  test.setTimeout(
    run.kind === "cancel"
      ? 300_000
      : run.profile === "P2" || run.profile === "R2"
        ? 1_800_000
        : 600_000,
  );
  const file = await inputFile(run.profile);
  if (run.arm !== 2) await installEngineOverrides(page, { workerPool: { ocrPoolSize: run.arm } });
  await openApp(page, "networkidle");
  memoryRuns = [];
  if (run.kind !== "memory") await installProbe(page, { ...run, runId: RUN_ID ?? "" });

  let report: ProfileReport | undefined;
  let timed: TimeRun | undefined;
  if (run.kind === "memory") {
    report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      `ocr-pool-${run.profile}-${run.arm}-r${run.round}`,
      file,
      run.profile === "P2" || run.profile === "R2" ? 600_000 : 300_000,
      [async (currentPage) => installProbe(currentPage, { ...run, runId: RUN_ID ?? "" })],
      async (currentPage, temperature) => {
        memoryRuns.push({ temperature, probe: await readProbe(currentPage) });
      },
      150,
      { captureOcrWords: false },
    );
  } else if (run.kind === "time") {
    timed = await runTimed(
      page,
      file,
      run.profile === "P2" || run.profile === "R2" ? 600_000 : 300_000,
    );
  } else {
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.waitForFunction(
      () => globalThis.__anonlyOcrPoolProbe?.cancelledAt !== null,
      undefined,
      { timeout: 240_000 },
    );
  }

  const probe = await readProbe(page);
  const payload = {
    runId: RUN_ID,
    arm: run.arm,
    profile: run.profile,
    round: run.round,
    kind: run.kind,
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    host: hostIdentity(),
    probe,
    report,
    timed,
    memoryRuns,
  };
  await mkdir(outputDir(), { recursive: true });
  await writeFile(
    resolve(outputDir(), `ocr-pool-${RUN_ID}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  if (run.kind === "cancel") {
    expect(probe.cancelActiveOcrJobs).toBeGreaterThan(0);
    expect(probe.cancelLatencyMs).not.toBeNull();
    expect(probe.cancelLatencyMs).toBeLessThanOrEqual(CANCELLATION_SLA_MS);
  } else {
    expect(probe.failed).toBe(false);
    expect(probe.ocrPageFailures).toBe(0);
    if (run.profile === "P1" || run.profile === "R1") expect(probe.ocrPageCount).toBe(0);
    else expect(probe.ocrPageCount).toBeGreaterThan(0);
    expect(probe.missingWordCachePages).toBe(0);
    expect(probe.effectiveBusyOsdPeak).toBeLessThanOrEqual(1);
    expect(probe.effectiveConfiguredRecognizerPoolSize).toBe(run.arm);
    if (run.profile === "P2" || run.profile === "R2") {
      if (run.arm === 2) expect(probe.effectiveBusyRecognizersPeak).toBe(2);
      expect(report?.cold.ocrWords ?? []).toEqual([]);
      expect(report?.hot.ocrWords ?? []).toEqual([]);
    }
  }
  if (run.kind === "time") expect(timed?.ok).toBe(true);
});
