import { describe, expect, it } from "vitest";

import {
  median,
  parseRunFileName,
  summarizeCampaign,
  toTemperatureRow,
  type LabeledReport,
  type RunRecordInput,
} from "./peakArmsSummary.js";

const MB = 1_000_000;

function run(overrides: Partial<RunRecordInput> = {}): RunRecordInput {
  return {
    ok: true,
    peakSumBytes: 1600 * MB,
    baselineBytes: 660 * MB,
    postReadyPeakBytes: 1160 * MB,
    readyDurationMs: 27_000,
    groupCount: 5,
    entityCount: 5,
    processPeakRssBytes: { "Browser:1": 230 * MB, "Tab:2": 1150 * MB },
    phaseSegments: [
      { fromEvent: "DOCUMENT_IMPORTED", toEvent: "DOCUMENT_PARSED", peakInternalBytes: 1600 * MB },
      { fromEvent: "OCR_STARTED", toEvent: "OCR_FINISHED", peakInternalBytes: 1530 * MB },
    ],
    ocrWords: [{ pageIndex: 0, words: [{ text: "Página" }, { text: "1" }] }],
    ...overrides,
  };
}

describe("peakArmsSummary", () => {
  it("extracts the parse and OCR phase peaks and the Tab peak", () => {
    const row = toTemperatureRow(run());
    expect(row.peakMb).toBe(1600);
    expect(row.parsePeakMb).toBe(1600);
    expect(row.ocrPeakMb).toBe(1530);
    expect(row.tabPeakMb).toBe(1150);
  });

  it("returns null for a phase that has no measurable peak", () => {
    const row = toTemperatureRow(
      run({
        phaseSegments: [
          { fromEvent: "DOCUMENT_IMPORTED", toEvent: "DOCUMENT_PARSED", peakInternalBytes: null },
        ],
      }),
    );
    expect(row.parsePeakMb).toBeNull();
    expect(row.ocrPeakMb).toBeNull();
  });

  it("hashes the OCR text independently of page order", () => {
    const a = toTemperatureRow(
      run({
        ocrWords: [
          { pageIndex: 1, words: [{ text: "b" }] },
          { pageIndex: 0, words: [{ text: "a" }] },
        ],
      }),
    );
    const b = toTemperatureRow(
      run({
        ocrWords: [
          { pageIndex: 0, words: [{ text: "a" }] },
          { pageIndex: 1, words: [{ text: "b" }] },
        ],
      }),
    );
    expect(a.ocrTextSha256).toBe(b.ocrTextSha256);
  });

  it("computes medians of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("pairs each round as mean(B) minus mean(A) and excludes failed runs", () => {
    const reports: LabeledReport[] = [
      { round: 1, arm: "base", report: { cold: run(), hot: run() } },
      { round: 1, arm: "head", report: { cold: run({ peakSumBytes: 1500 * MB }), hot: run() } },
      { round: 1, arm: "head", report: { cold: run({ peakSumBytes: 1400 * MB }), hot: run() } },
      {
        round: 1,
        arm: "base",
        report: { cold: run({ ok: false, peakSumBytes: 9000 * MB }), hot: run() },
      },
    ];
    const summary = summarizeCampaign(reports, "base", "head");
    expect(summary.cold.paired).toEqual([{ round: 1, peakDeltaMb: -150, readyDeltaMs: 0 }]);
    expect(summary.cold.control.failed).toBe(1);
    expect(summary.cold.control.medianPeakMb).toBe(1600);
    expect(summary.ocrTextIdentical).toBe(true);
    expect(summary.groupCountsIdentical).toBe(true);
  });

  it("flags differing OCR text or group counts between arms", () => {
    const reports: LabeledReport[] = [
      { round: 1, arm: "base", report: { cold: run(), hot: run() } },
      {
        round: 1,
        arm: "head",
        report: {
          cold: run({ ocrWords: [{ pageIndex: 0, words: [{ text: "otro" }] }], groupCount: 4 }),
          hot: run(),
        },
      },
    ];
    const summary = summarizeCampaign(reports, "base", "head");
    expect(summary.ocrTextIdentical).toBe(false);
    expect(summary.groupCountsIdentical).toBe(false);
  });

  it("parses only campaign file names", () => {
    expect(parseRunFileName("03-r1-head-memory-p2-scanned-50p-run0.json")).toEqual({
      round: 1,
      arm: "head",
    });
    // Los nombres de la campaña anterior (brazos A/B) no son de este arnés.
    expect(parseRunFileName("03-r1-B-memory-p2-attrib-ner-off-run0.json")).toBeUndefined();
    expect(parseRunFileName("summary.json")).toBeUndefined();
  });
});
