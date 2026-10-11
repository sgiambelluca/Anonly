import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureV1ExportInPage,
  captureV1InPage,
  installV1InPage,
} from "./validateSampleBrowser.js";

type Handler = (payload: unknown) => void;
function scene() {
  const handlers = new Map<string, Handler>();
  vi.stubGlobal("__anonlyCore", {
    bus: {
      on: (channel: string, event: string, callback: Handler) => {
        handlers.set(`${channel}/${event}`, callback);
      },
    },
    orchestrator: {
      documents: new Map([
        ["neutral-id", { pageCount: 2, pages: [{ words: [{ text: "PRIVATE" }] }, { words: [] }] }],
      ]),
    },
  });
  vi.stubGlobal("__anonlyMemoryRun", { documentId: "neutral-id" });
  installV1InPage();
  return (channel: string, event: string, payload: unknown): void => {
    const callback = handlers.get(`${channel}/${event}`);
    if (callback === undefined) throw new Error("missing handler");
    callback(payload);
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.__anonlyV1 = undefined;
});
describe("M-V1 counts-only renderer probe", () => {
  it("collects pages and warnings while never retaining input text or errors", () => {
    const emit = scene();
    emit("pdf", "PAGE_PARSED", { pageIndex: 1, requiresOCR: true, text: "PRIVATE" });
    emit("pdf", "PAGE_PARSED", { pageIndex: 0, requiresOCR: false });
    emit("pdf", "PAGE_PARSED", { pageIndex: 1, requiresOCR: true });
    emit("ocr", "OCR_PAGE_FINISHED", { pageIndex: 1, unreadableInk: true, text: "PRIVATE" });
    emit("ocr", "OCR_PAGE_FAILED", { pageIndex: 0, error: { message: "PRIVATE" } });
    emit("pipeline", "PIPELINE_READY", { conflictCount: 2, documentId: "PRIVATE" });
    const result = captureV1InPage();
    expect(result).toEqual({
      parsedPageIndices: [0, 1],
      requiresOcrPageIndices: [1],
      completedOcrPageIndices: [1],
      unreadableInkPageIndices: [1],
      failedOcrPageIndices: [0],
      pipelineFailed: false,
      conflictCount: 2,
      pageCount: 2,
      words: 1,
    });
    expect(JSON.stringify(globalThis.__anonlyV1)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("ignores malformed indices and reports pipeline failure explicitly", () => {
    const emit = scene();
    for (const invalid of [null, {}, { pageIndex: "0" }, { pageIndex: -1 }, { pageIndex: 0.5 }]) {
      emit("pdf", "PAGE_PARSED", invalid);
      emit("ocr", "OCR_PAGE_FINISHED", invalid);
      emit("ocr", "OCR_PAGE_FAILED", invalid);
    }
    emit("pipeline", "PIPELINE_FAILED", { error: { message: "PRIVATE" } });
    expect(captureV1InPage().parsedPageIndices).toEqual([]);
    expect(captureV1InPage().pipelineFailed).toBe(true);
    expect(JSON.stringify(globalThis.__anonlyV1)).not.toContain("PRIVATE");
  });
  it("observes options/coverage and export metrics while discarding filename/blob/message", () => {
    const emit = scene();
    emit("ui", "EXPORT_REQUESTED", {
      options: {
        imageFormat: "jpeg",
        jpegQuality: 0.92,
        dpi: 150,
        includeMarkerLegend: false,
        coveredPages: [0, "PRIVATE", -1],
        filename: "PRIVATE",
      },
    });
    emit("export", "EXPORT_FINISHED", { durationMs: 123, sizeBytes: 456, blobUrl: "PRIVATE" });
    const value = captureV1ExportInPage();
    expect(value.durationMs).toBe(123);
    expect(value.sizeBytes).toBe(456);
    expect(value.options?.coveredPages).toEqual([0]);
    expect(value.requestedAt).not.toBeNull();
    expect(value.finishedAt).not.toBeNull();
    expect(JSON.stringify(value)).not.toContain("PRIVATE");
    emit("export", "EXPORT_FAILED", { error: { message: "PRIVATE" } });
    expect(captureV1ExportInPage().failed).toBe(true);
  });
  it("keeps incomplete/malformed export options absent", () => {
    const emit = scene();
    emit("ui", "EXPORT_REQUESTED", { options: { imageFormat: "other" } });
    expect(captureV1ExportInPage().options).toBeNull();
    emit("export", "EXPORT_FINISHED", { sizeBytes: "bad" });
    expect(captureV1ExportInPage().durationMs).toBeNull();
    expect(captureV1ExportInPage().sizeBytes).toBeNull();
  });
  it("fails when the probe was not installed", () => {
    globalThis.__anonlyV1 = undefined;
    expect(captureV1InPage).toThrow("probe unavailable");
    expect(captureV1ExportInPage).toThrow("probe unavailable");
    vi.stubGlobal("__anonlyCore", undefined);
    expect(installV1InPage).toThrow("core unavailable");
  });
});
