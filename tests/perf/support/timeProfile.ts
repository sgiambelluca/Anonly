import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";

import type { Word } from "@anonly/shared";
import type { Page } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import { qualityFingerprint } from "./t5Instrumentation.js";

export const TIME_EVENTS = [
  "DOCUMENT_IMPORTED",
  "DOCUMENT_PARSED",
  "OCR_STARTED",
  "OCR_FINISHED",
  "REGEX_FINISHED",
  "NER_STARTED",
  "NER_MODEL_READY",
  "NER_FINISHED",
  "GROUPING_FINISHED",
  "PIPELINE_READY",
  "PIPELINE_FAILED",
] as const;

export type TimeEvent = (typeof TIME_EVENTS)[number];
export type Temperature = "cold" | "hot";

export interface TimeRun {
  readonly temperature: Temperature;
  readonly marks: Readonly<Record<string, number>>;
  readonly marksEpochMs: Readonly<Record<string, number>>;
  readonly totalMs: number | null;
  readonly intervalsMs: Readonly<Record<string, number | null>>;
  readonly uiImportToImportedMs: number | null;
  readonly readyToPanelMs: number | null;
  readonly entityCount: number;
  readonly groupCount: number;
  readonly qualityFingerprint: string;
  readonly ocrFingerprint: string | null;
  readonly detectionFingerprint: string;
  readonly m2: Readonly<Record<string, number>>;
  readonly nerProbe: unknown;
  readonly ok: boolean;
}

export interface TimeReport {
  readonly profile: string;
  readonly fixture: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly identity: {
    readonly platform: string;
    readonly arch: string;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
  };
  readonly cold: TimeRun;
  readonly hot: TimeRun;
  readonly capturedAt: string;
}

const EVENT_CHANNEL: Readonly<Record<TimeEvent, string>> = {
  DOCUMENT_IMPORTED: "pipeline",
  DOCUMENT_PARSED: "pdf",
  OCR_STARTED: "ocr",
  OCR_FINISHED: "ocr",
  REGEX_FINISHED: "regex",
  NER_STARTED: "ner",
  NER_MODEL_READY: "ner",
  NER_FINISHED: "ner",
  GROUPING_FINISHED: "grouping",
  PIPELINE_READY: "pipeline",
  PIPELINE_FAILED: "pipeline",
};

const ORDER: ReadonlyArray<readonly [string, string, string]> = [
  ["DOCUMENT_IMPORTED", "DOCUMENT_PARSED", "importedToParsedMs"],
  ["DOCUMENT_PARSED", "OCR_STARTED", "parsedToOcrStartedMs"],
  ["OCR_STARTED", "OCR_FINISHED", "ocrMs"],
  ["OCR_FINISHED", "REGEX_FINISHED", "ocrFinishedToRegexMs"],
  ["DOCUMENT_PARSED", "REGEX_FINISHED", "parsedToRegexMs"],
  ["REGEX_FINISHED", "NER_STARTED", "regexToNerStartedMs"],
  ["NER_STARTED", "PIPELINE_READY", "nerStartedToReadyMs"],
  ["NER_STARTED", "NER_FINISHED", "nerMs"],
  ["NER_FINISHED", "GROUPING_FINISHED", "nerFinishedToGroupingMs"],
  ["GROUPING_FINISHED", "PIPELINE_READY", "groupingToReadyMs"],
  ["DOCUMENT_IMPORTED", "PIPELINE_READY", "importedToReadyMs"],
  ["OCR_STARTED", "PIPELINE_READY", "ocrStartedToReadyMs"],
  ["OCR_FINISHED", "PIPELINE_READY", "ocrFinishedToReadyMs"],
];

declare global {
  var __anonlyTimeRun:
    | {
        marks: Record<string, number>;
        marksEpochMs: Record<string, number>;
        documentId?: string;
        uiImportAt?: number;
        uiPanelAt?: number;
        entityCount: number;
        groupCount: number;
        quality: string;
        ocrPageIndexes: number[];
        ocrWords: Array<{ pageIndex: number; words: ReadonlyArray<Word> }>;
        detection: string[];
        failed: boolean;
      }
    | undefined;
}

export async function installTimeCollector(page: Page): Promise<void> {
  await page.evaluate((events) => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente");
    const run: {
      marks: Record<string, number>;
      marksEpochMs: Record<string, number>;
      documentId?: string;
      uiImportAt?: number;
      uiPanelAt?: number;
      entityCount: number;
      groupCount: number;
      quality: string;
      ocrPageIndexes: number[];
      ocrWords: Array<{ pageIndex: number; words: ReadonlyArray<Word> }>;
      detection: string[];
      failed: boolean;
    } = {
      marks: {},
      marksEpochMs: {},
      entityCount: 0,
      groupCount: 0,
      quality: "",
      ocrPageIndexes: [],
      ocrWords: [],
      detection: [],
      failed: false,
    };
    globalThis.__anonlyTimeRun = run;
    for (const event of events) {
      const channel = (
        {
          DOCUMENT_IMPORTED: "pipeline",
          DOCUMENT_PARSED: "pdf",
          OCR_STARTED: "ocr",
          OCR_FINISHED: "ocr",
          REGEX_FINISHED: "regex",
          NER_STARTED: "ner",
          NER_MODEL_READY: "ner",
          NER_FINISHED: "ner",
          GROUPING_FINISHED: "grouping",
          PIPELINE_READY: "pipeline",
          PIPELINE_FAILED: "pipeline",
        } as Record<string, string>
      )[event]!;
      core.bus.on(channel, event, (payload: unknown) => {
        if (run.marks[event] === undefined) {
          run.marks[event] = performance.now();
          run.marksEpochMs[event] = Date.now();
        }
        if (
          event === "DOCUMENT_IMPORTED" &&
          typeof payload === "object" &&
          payload !== null &&
          "documentId" in payload
        ) {
          run.documentId = String((payload as { documentId: unknown }).documentId);
        }
        if (event === "PIPELINE_FAILED") run.failed = true;
      });
    }
    const qualityShape = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(qualityShape);
      if (typeof value !== "object" || value === null)
        return typeof value === "string" ? value.length : value;
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) =>
            /^(page(Index)?|bounds?|box|bbox|x|y|width|height|type|entityType|kind|source|normalizedValue|occurrence|group|confidence|wordCount)$/i.test(
              key,
            ),
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [
            key,
            /^(normalizedValue|source|type|entityType|kind)$/i.test(key)
              ? item
              : qualityShape(item),
          ]),
      );
    };
    core.bus.on("grouping", "ENTITY_GROUP_CREATED", (payload: unknown) => {
      run.groupCount += 1;
      run.detection.push(`g:${JSON.stringify(qualityShape(payload))}`);
    });
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "pageIndex" in payload &&
        typeof (payload as { pageIndex: unknown }).pageIndex === "number"
      ) {
        const pageIndex = (payload as { pageIndex: number }).pageIndex;
        run.ocrPageIndexes.push(pageIndex);
        const documentId = run.documentId;
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
            : ocr?.ctx?.cache?.get<ReadonlyArray<Word>>(`ocr-words:${documentId}:${pageIndex}`);
        if (words !== undefined) run.ocrWords.push({ pageIndex, words });
      }
    });
    core.bus.on("regex", "ENTITY_FOUND", (payload: unknown) => {
      run.entityCount += 1;
      run.detection.push(`r:${JSON.stringify(qualityShape(payload))}`);
    });
    core.bus.on("ner", "ENTITY_FOUND", (payload: unknown) => {
      run.entityCount += 1;
      run.detection.push(`n:${JSON.stringify(qualityShape(payload))}`);
    });
  }, TIME_EVENTS);
}

function delta(marks: Readonly<Record<string, number>>, from: string, to: string): number | null {
  const a = marks[from];
  const b = marks[to];
  return a === undefined || b === undefined ? null : b - a;
}

function makeFingerprint(entityCount: number, groupCount: number, quality: string): string {
  return createHash("sha256").update(`${entityCount}:${groupCount}:${quality}`).digest("hex");
}

export async function runTimedImport(
  page: Page,
  file: E2eFilePayload,
  temperature: Temperature,
  timeoutMs: number,
): Promise<TimeRun> {
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await installTimeCollector(page);
  await page.evaluate(() => {
    const r = globalThis.__anonlyTimeRun;
    if (r === undefined) throw new Error("collector missing");
    r.uiImportAt = performance.now();
  });
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForFunction(
    () =>
      globalThis.__anonlyTimeRun !== undefined &&
      ("PIPELINE_READY" in globalThis.__anonlyTimeRun.marks || globalThis.__anonlyTimeRun.failed),
    undefined,
    { timeout: timeoutMs },
  );
  const panel = page.getByRole("button", { name: "Exportar" });
  await panel.waitFor({ state: "visible", timeout: timeoutMs });
  const state = await page.evaluate(() => {
    const r = globalThis.__anonlyTimeRun;
    if (r === undefined) throw new Error("collector missing");
    r.uiPanelAt = performance.now();
    return { ...r, marks: { ...r.marks }, marksEpochMs: { ...r.marksEpochMs } };
  });
  const ocrPages = await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    const run = globalThis.__anonlyTimeRun;
    if (core === undefined || run === undefined) return [];
    const engines = (
      core as typeof core & {
        readonly engines: {
          readonly ocr: {
            readonly ctx?: { readonly cache?: { readonly get: <T>(key: string) => T | undefined } };
          };
        };
      }
    ).engines;
    const pages: Array<ReadonlyArray<Word>> = [];
    if (
      Array.isArray(
        (run as { ocrWords?: Array<{ pageIndex: number; words: ReadonlyArray<Word> }> }).ocrWords,
      )
    ) {
      return [
        ...(run as { ocrWords: Array<{ pageIndex: number; words: ReadonlyArray<Word> }> }).ocrWords,
      ]
        .sort((a, b) => a.pageIndex - b.pageIndex)
        .map((entry) => entry.words);
    }
    const pageIndexes = [...(run as { ocrPageIndexes: number[] }).ocrPageIndexes].sort(
      (a, b) => a - b,
    );
    for (const pageIndex of pageIndexes) {
      const words = engines.ocr.ctx?.cache?.get<ReadonlyArray<Word>>(
        `ocr-words:${(run as { documentId?: string }).documentId ?? ""}:${pageIndex}`,
      );
      if (words === undefined) {
        if (pageIndex > 10) break;
        continue;
      }
      pages.push(words);
    }
    return pages;
  });
  const ocrFingerprint = ocrPages.length === 0 ? "" : qualityFingerprint(ocrPages).sha256;
  const detectionFingerprint = createHash("sha256")
    .update([...state.detection].sort().join("\n"))
    .digest("hex");
  const m2 = await page.evaluate(() => {
    const run = globalThis.__anonlyTimeRun;
    const m = (
      globalThis as typeof globalThis & { __anonlyM2?: Record<string, Record<string, number>> }
    ).__anonlyM2;
    const documentId = run?.documentId;
    return documentId === undefined ? {} : { ...(m?.[documentId] ?? {}) };
  });
  const nerProbe = await page.evaluate(() => {
    const documentId = globalThis.__anonlyTimeRun?.documentId;
    const root = (
      globalThis as typeof globalThis & {
        __anonlyNerProbe?: Record<string, unknown>;
      }
    ).__anonlyNerProbe;
    return documentId === undefined ? null : (root?.[documentId] ?? null);
  });
  const intervals: Record<string, number | null> = {};
  for (const [from, to, name] of ORDER) intervals[name] = delta(state.marks, from, to);
  return {
    temperature,
    marks: state.marks,
    marksEpochMs: state.marksEpochMs,
    totalMs: intervals.importedToReadyMs ?? null,
    intervalsMs: intervals,
    uiImportToImportedMs:
      state.marks.DOCUMENT_IMPORTED === undefined || state.uiImportAt === undefined
        ? null
        : state.marks.DOCUMENT_IMPORTED - state.uiImportAt,
    readyToPanelMs:
      state.uiPanelAt === undefined || state.marks.PIPELINE_READY === undefined
        ? null
        : state.uiPanelAt - state.marks.PIPELINE_READY,
    entityCount: state.entityCount,
    groupCount: state.groupCount,
    qualityFingerprint: makeFingerprint(
      state.entityCount,
      state.groupCount,
      `${ocrFingerprint}:${detectionFingerprint}`,
    ),
    ocrFingerprint: ocrFingerprint === "" ? null : ocrFingerprint,
    detectionFingerprint,
    m2,
    nerProbe,
    ok: !state.failed,
  };
}

export async function closeTimedDocument(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Cerrar documento" });
  const dialog = page.getByRole("dialog", { name: "Cerrar documento" });
  await button.click();
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: "Cerrar documento" }).click();
  await dialog.waitFor({ state: "hidden" });
}

export async function writeTimeReport(report: TimeReport, outputPath: string): Promise<void> {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function fixtureInfo(path: string, bytes: Buffer): TimeReport["fixture"] {
  return {
    path,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function hostIdentity(): TimeReport["identity"] {
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    totalMemBytes: os.totalmem(),
  };
}

export const eventChannels = EVENT_CHANNEL;
