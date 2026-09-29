import { describe, expect, it } from "vitest";

import { correlateRawOsd, type RawOsd } from "./adr190OsdProbe.js";

const reading = (
  hostJobId: string,
  rawOrientation: number | null,
  rawConfidence: number | null,
): RawOsd => ({
  hostJobId,
  tesseractJobId: `tesseract-${hostJobId}`,
  rawOrientation,
  rawConfidence,
  error: rawOrientation === null ? "DetectOS returned no orientation" : null,
  sessionId: "session",
  atMs: 1,
});

describe("raw OSD correlation for ADR190 scale runs", () => {
  it("correlates each host orientation dispatch exactly once, including no-verdict results", () => {
    const jobs = [
      { jobId: "orient-1", jobType: "ocr-orient" },
      { jobId: "page-1", jobType: "ocr-page" },
      { jobId: "orient-2", jobType: "ocr-orient" },
    ];
    const raw = [reading("orient-2", null, null), reading("orient-1", 180, 4.2)];
    expect(correlateRawOsd(jobs, raw)).toEqual(raw);
  });

  it("rejects missing, duplicated, and uncorrelated raw readings", () => {
    const jobs = [{ jobId: "orient-1", jobType: "ocr-orient" }];
    expect(() => correlateRawOsd(jobs, [])).toThrow("OSD count mismatch");
    expect(() =>
      correlateRawOsd(jobs, [reading("orient-1", 0, 2), reading("orient-1", 0, 2)]),
    ).toThrow("OSD count mismatch");
    expect(() => correlateRawOsd(jobs, [reading("other", 0, 2)])).toThrow(
      "OSD correlation missing or ambiguous",
    );
  });

  it("rejects an allegedly successful raw event without angle or confidence", () => {
    const successWithoutConfidence = { ...reading("orient-1", 0, null), error: null };
    expect(() =>
      correlateRawOsd([{ jobId: "orient-1", jobType: "ocr-orient" }], [successWithoutConfidence]),
    ).toThrow("resolved OSD missing raw angle/confidence");
  });
});
