/** M-V1 renderer probes return counts and export encoding only. */
import type { Page } from "@playwright/test";

import type { V1ImportSnapshot } from "./validateSampleCampaign.js";

interface ExportProbe {
  requestedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  failed: boolean;
  options: {
    imageFormat: "jpeg" | "png";
    jpegQuality: number;
    dpi: number;
    includeMarkerLegend: boolean;
    coveredPages: number[];
  } | null;
}
interface V1Probe {
  parsed: number[];
  requiresOcr: number[];
  ocr: number[];
  unreadable: number[];
  failedOcr: number[];
  pipelineFailed: boolean;
  conflictCount: number | null;
  export: ExportProbe;
}
declare global {
  var __anonlyV1: V1Probe | undefined;
}

export function installV1InPage(): void {
  const core = globalThis.__anonlyCore;
  if (core === undefined) throw new Error("M-V1 core unavailable");
  const state: V1Probe = {
    parsed: [],
    requiresOcr: [],
    ocr: [],
    unreadable: [],
    failedOcr: [],
    pipelineFailed: false,
    conflictCount: null,
    export: {
      requestedAt: null,
      finishedAt: null,
      durationMs: null,
      sizeBytes: null,
      failed: false,
      options: null,
    },
  };
  globalThis.__anonlyV1 = state;
  // Every measured page is a fresh renderer; listeners never survive another run.
  const index = (payload: unknown): number | null => {
    if (typeof payload !== "object" || payload === null || !("pageIndex" in payload)) return null;
    return typeof payload.pageIndex === "number" &&
      Number.isInteger(payload.pageIndex) &&
      payload.pageIndex >= 0
      ? payload.pageIndex
      : null;
  };
  core.bus.on("pdf", "PAGE_PARSED", (payload: unknown) => {
    const pageIndex = index(payload);
    if (pageIndex === null) return;
    state.parsed.push(pageIndex);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "requiresOCR" in payload &&
      payload.requiresOCR === true
    )
      state.requiresOcr.push(pageIndex);
  });
  core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
    const pageIndex = index(payload);
    if (pageIndex === null) return;
    state.ocr.push(pageIndex);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "unreadableInk" in payload &&
      payload.unreadableInk === true
    )
      state.unreadable.push(pageIndex);
  });
  core.bus.on("ocr", "OCR_PAGE_FAILED", (payload: unknown) => {
    const pageIndex = index(payload);
    if (pageIndex !== null) state.failedOcr.push(pageIndex);
  });
  core.bus.on("pipeline", "PIPELINE_FAILED", () => {
    state.pipelineFailed = true;
  });
  core.bus.on("pipeline", "PIPELINE_READY", (payload: unknown) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "conflictCount" in payload &&
      typeof payload.conflictCount === "number"
    )
      state.conflictCount = payload.conflictCount;
  });
  core.bus.on("ui", "EXPORT_REQUESTED", (payload: unknown) => {
    state.export.requestedAt = Date.now();
    if (typeof payload !== "object" || payload === null || !("options" in payload)) return;
    const options = payload.options;
    if (
      typeof options !== "object" ||
      options === null ||
      !("imageFormat" in options) ||
      (options.imageFormat !== "jpeg" && options.imageFormat !== "png") ||
      !("jpegQuality" in options) ||
      typeof options.jpegQuality !== "number" ||
      !("dpi" in options) ||
      typeof options.dpi !== "number" ||
      !("includeMarkerLegend" in options) ||
      typeof options.includeMarkerLegend !== "boolean"
    )
      return;
    state.export.options = {
      imageFormat: options.imageFormat,
      jpegQuality: options.jpegQuality,
      dpi: options.dpi,
      includeMarkerLegend: options.includeMarkerLegend,
      coveredPages:
        "coveredPages" in options && Array.isArray(options.coveredPages)
          ? options.coveredPages.filter(
              (value: unknown): value is number =>
                typeof value === "number" && Number.isInteger(value) && value >= 0,
            )
          : [],
    };
  });
  core.bus.on("export", "EXPORT_FINISHED", (payload: unknown) => {
    state.export.finishedAt = Date.now();
    if (typeof payload !== "object" || payload === null) return;
    if ("durationMs" in payload && typeof payload.durationMs === "number")
      state.export.durationMs = payload.durationMs;
    if ("sizeBytes" in payload && typeof payload.sizeBytes === "number")
      state.export.sizeBytes = payload.sizeBytes;
  });
  core.bus.on("export", "EXPORT_FAILED", () => {
    state.export.failed = true;
  });
}
export async function installV1Collector(page: Page): Promise<void> {
  await page.evaluate(installV1InPage);
}

export function captureV1InPage(): V1ImportSnapshot {
  const state = globalThis.__anonlyV1;
  if (state === undefined) throw new Error("M-V1 probe unavailable");
  const core = globalThis.__anonlyCore;
  const documentId = globalThis.__anonlyMemoryRun?.documentId;
  // Read-only harness boundary: only lengths of the imported model leave Electron.
  const view = core as typeof core & {
    orchestrator: {
      documents: ReadonlyMap<
        string,
        { pageCount: number; pages: ReadonlyArray<{ words: ReadonlyArray<unknown> }> }
      >;
    };
  };
  const document =
    documentId === undefined ? undefined : view?.orchestrator.documents.get(documentId);
  const unique = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);
  return {
    parsedPageIndices: unique(state.parsed),
    requiresOcrPageIndices: unique(state.requiresOcr),
    completedOcrPageIndices: unique(state.ocr),
    unreadableInkPageIndices: unique(state.unreadable),
    failedOcrPageIndices: unique(state.failedOcr),
    pipelineFailed: state.pipelineFailed,
    conflictCount: state.conflictCount,
    pageCount: document?.pageCount ?? null,
    words: document?.pages.reduce((sum, page) => sum + page.words.length, 0) ?? null,
  };
}
export async function captureV1Import(page: Page): Promise<V1ImportSnapshot> {
  return page.evaluate(captureV1InPage);
}

export function captureV1ExportInPage(): ExportProbe {
  const state = globalThis.__anonlyV1;
  if (state === undefined) throw new Error("M-V1 export probe unavailable");
  return { ...state.export };
}
export async function readV1ExportProbe(page: Page): Promise<ExportProbe> {
  return page.evaluate(captureV1ExportInPage);
}
