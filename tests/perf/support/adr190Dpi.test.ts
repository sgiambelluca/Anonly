import type { Document, Word } from "@anonly/shared";
import { describe, expect, it } from "vitest";

import {
  campaignCells,
  classifyJobs,
  decodeVerdict,
  decodeWords,
  hasQualityFailure,
  removeDpiCaps,
  scoreReading,
  validateCampaignPage,
  tokens,
  validateCapture,
  type Job,
} from "./adr190Dpi.js";
import { correlateRawOsd, type RawOsd } from "./adr190OsdProbe.js";

const word = (text: string, confidence = 0.9): Word => ({
  text,
  confidence,
  source: "ocr",
  pageIndex: 0,
  bbox: { x: 1, y: 2, width: 10, height: 12 },
});
const job = (jobId: string, jobType: Job["jobType"] = "ocr-page"): Job => ({
  worker: 1,
  jobId,
  jobType,
  documentId: "synthetic",
  pageIndex: 0,
  startedAt: 100,
  finishedAt: 110,
  dpi: 150,
  orientation: 0,
  upscale: 1,
  widthPx: 100,
  heightPx: 200,
  imageBytes: 50,
  terminal: "COMPLETED",
  result: jobType === "ocr-page" ? { words: [word("Juan")] } : { orientation: 0, inkRatio: 0.1 },
  error: null,
});
describe("ADR190 campaign instrument", () => {
  it("removes only caps from immutable copies and preserves the source document", () => {
    const capped = Object.freeze({
      index: 0,
      width: 595,
      height: 842,
      words: Object.freeze([word("Juan")]),
      text: "Juan",
      requiresOCR: true,
      ocrCompleted: false,
      dpi: 150,
      ocrDpiCap: 151,
    });
    const { ocrDpiCap: _originalCap, ...uncappedFields } = capped;
    const uncapped = Object.freeze({ ...uncappedFields, index: 1 });
    const original: Document = Object.freeze({
      id: "fixture",
      name: "fixture.pdf",
      pageCount: 2,
      pages: Object.freeze([capped, uncapped]),
      metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
      sourceKind: "scanned",
      importedAt: 0,
    });
    const controlled = removeDpiCaps(original);
    expect(original.pages[0]?.ocrDpiCap).toBe(151);
    const { ocrDpiCap: _cap, ...rest } = capped;
    expect(controlled.pages[0]).toEqual(rest);
    expect(controlled.pages[0]?.words).toBe(capped.words);
    expect(controlled.pages[1]).toBe(uncapped);
    expect({ ...controlled, pages: original.pages }).toEqual(original);
  });
  it("covers every unique combination with time order AB BA AB", () => {
    for (const phase of ["preflight", "quality", "time", "memory", "controls"] as const) {
      const matrix = campaignCells(phase);
      expect(new Set(matrix.map((cell) => JSON.stringify(cell))).size).toBe(matrix.length);
      expect(matrix.length).toBe(
        phase === "preflight" ? 8 : phase === "time" ? 384 : phase === "controls" ? 32 : 128,
      );
      if (phase === "time") {
        expect(
          matrix
            .filter((c) => c.repetition === 1)
            .slice(0, 2)
            .map((c) => c.arm),
        ).toEqual(["native", "forced300"]);
        expect(
          matrix
            .filter((c) => c.repetition === 2)
            .slice(0, 2)
            .map((c) => c.arm),
        ).toEqual(["forced300", "native"]);
        expect(
          matrix
            .filter((c) => c.repetition === 3)
            .slice(0, 2)
            .map((c) => c.arm),
        ).toEqual(["native", "forced300"]);
      }
    }
  });
  it("counts true tokens as a multiset, distinguishes confident garbage and checks real DNI values", () => {
    expect(tokens("JUÁN Pérez / DNI 34.567.891")).toEqual(["juan", "perez", "dni", "34567891"]);
    const partial = scoreReading(
      "Juan Perez DNI 34.567.891",
      [word("Juan"), word("Juan"), word("DNI"), word("34.567.891")],
      [],
      "34.567.891",
    );
    expect(partial.tokenRecall).toBe(0.75);
    expect(partial.reliableMissingDni).toBe(true);
    expect(scoreReading("Juan Perez", [word("168 INC")], [], null).reliableNoTrueTokens).toBe(true);
    expect(scoreReading("", [word("0")], [], null).reliableWordsWithoutText).toBe(true);
    expect(
      scoreReading("DNI 34.567.891", [word("DNI 34.567.891")], ["34567891"], "34.567.891")
        .dniRecovered,
    ).toBe(true);
    expect(hasQualityFailure(scoreReading("", [], [], null))).toBe(false);
    expect(hasQualityFailure(scoreReading("", [word("168 INC")], [], null))).toBe(true);
    expect(hasQualityFailure(scoreReading("Juan Perez", [word("Juan Perez")], [], null))).toBe(
      false,
    );
  });
  it("rejects malformed worker outputs and unsettled observations", () => {
    expect(() => decodeVerdict({ orientation: 45, inkRatio: 0.2 })).toThrow();
    for (const inkRatio of [-0.01, 1.01, NaN, null])
      expect(() => decodeVerdict({ orientation: 0, inkRatio })).toThrow();
    expect(() => decodeWords({ words: [{ ...word("Juan"), confidence: 90 }] })).toThrow();
    expect(() =>
      validateCapture({ jobs: [{ ...job("a"), terminal: null }], issues: [], workers: [] }),
    ).toThrow();
    const completePair = {
      jobs: [job("orient", "ocr-orient"), job("read")],
      issues: [],
      workers: [],
    };
    expect(() => validateCampaignPage(completePair, 0, 150)).not.toThrow();
    expect(() =>
      validateCapture({ jobs: [job("orient", "ocr-orient")], issues: [], workers: [] }),
    ).toThrow(/no ocr-page dispatch/);
    expect(() => validateCapture({ jobs: [job("read")], issues: [], workers: [] })).toThrow(
      /no ocr-orient dispatch/,
    );
    expect(() => validateCampaignPage(completePair, 0, 300)).toThrow(/recognition DPI/);
    const failedRead = { ...job("read"), terminal: "FAILED", result: null, error: "failed" };
    expect(() =>
      validateCapture({
        jobs: [job("orient", "ocr-orient"), failedRead],
        issues: [],
        workers: [],
      }),
    ).toThrow(/no completed ocr-page result/);
    const retry = {
      ...job("read"),
      startedAt: 111,
      finishedAt: 120,
      terminal: "COMPLETED",
    };
    expect(() =>
      validateCampaignPage(
        {
          jobs: [job("orient", "ocr-orient"), failedRead, retry],
          issues: [],
          workers: [],
        },
        0,
        150,
      ),
    ).not.toThrow();
    const lateFailedRead = {
      ...failedRead,
      startedAt: 111,
      finishedAt: 120,
    };
    const completedThenFailed = {
      jobs: [job("orient", "ocr-orient"), job("read"), lateFailedRead],
      issues: [],
      workers: [],
    };
    expect(() => validateCampaignPage(completedThenFailed, 0, 150)).not.toThrow();
    expect(completedThenFailed.jobs.map((captured) => captured.terminal)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "FAILED",
    ]);
    const cancelledRead = {
      ...job("read"),
      terminal: "CANCELLED",
      result: null,
      error: null,
    };
    expect(() =>
      validateCapture({
        jobs: [job("orient", "ocr-orient"), cancelledRead],
        issues: [],
        workers: [],
      }),
    ).toThrow(/no completed ocr-page result/);
    expect(() =>
      validateCampaignPage(
        {
          jobs: [
            job("orient", "ocr-orient"),
            cancelledRead,
            { ...retry, startedAt: 111, finishedAt: 120 },
          ],
          issues: [],
          workers: [],
        },
        0,
        150,
      ),
    ).not.toThrow();
    expect(() =>
      validateCampaignPage(
        {
          jobs: [job("orient", "ocr-orient"), { ...failedRead, dpi: 151 }, { ...retry, dpi: 150 }],
          issues: [],
          workers: [],
        },
        0,
        150,
      ),
    ).toThrow(/recognition DPI/);
    expect(classifyJobs([job("a"), job("a"), job("b")]).map((j) => j.transportRetry)).toEqual([
      false,
      true,
      false,
    ]);
  });
  it("correlates raw detect replies to their exact host job and fails closed on loss", () => {
    const reading: RawOsd = {
      hostJobId: "osd-a",
      tesseractJobId: "Detect-1",
      rawOrientation: 270,
      rawConfidence: 3.5,
      error: null,
      sessionId: "child",
      atMs: 1,
    };
    expect(correlateRawOsd([job("osd-a", "ocr-orient"), job("read-a")], [reading])).toEqual([
      reading,
    ]);
    expect(
      correlateRawOsd(
        [job("osd-a", "ocr-orient")],
        [
          {
            ...reading,
            rawOrientation: null,
            rawConfidence: null,
            error: "DetectOS returned no orientation",
          },
        ],
      ),
    ).toHaveLength(1);
    expect(() => correlateRawOsd([job("osd-a", "ocr-orient")], [])).toThrow();
    expect(() => correlateRawOsd([job("osd-b", "ocr-orient")], [reading])).toThrow();
    expect(() =>
      correlateRawOsd([job("osd-a", "ocr-orient")], [{ ...reading, rawConfidence: null }]),
    ).toThrow();
  });
});
