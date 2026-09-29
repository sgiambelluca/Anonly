import { describe, expect, it } from "vitest";

import type { Capture, Job } from "./adr190Dpi.js";
import { scoreReading } from "./adr190Dpi.js";
import {
  correlateOcrAttempts,
  collectInstrumentFailures,
  dispatchedOrientationForPage,
  firstOcrAttempt,
  hasExactDniToken,
  firstReadingMatchesQuality,
  rankCandidates,
  summarizeReliableWordEvidence,
} from "./adr190Recovery.js";

const word = (text: string, confidence: number): Parameters<typeof scoreReading>[1][number] => ({
  text,
  confidence,
  bbox: { x: 0, y: 0, width: 1, height: 1 },
  pageIndex: 0,
  source: "ocr",
});

function makeJob(jobId: string, startedAt: number, orientation: number): Job {
  return {
    worker: 1,
    jobId,
    jobType: "ocr-page",
    documentId: "doc",
    pageIndex: 0,
    startedAt,
    finishedAt: startedAt + 20,
    dpi: 151,
    orientation,
    dispatchedOrientation: 180,
    upscale: 1,
    widthPx: 1248,
    heightPx: 1765,
    imageBytes: 4,
    terminal: "COMPLETED",
    result: { words: [] },
    error: null,
  };
}

function makeInput(jobId: string, orientation: number) {
  return {
    jobId,
    documentId: "doc",
    pageIndex: 0,
    dpi: 151,
    sourceOrientation: orientation,
    dispatchedOrientation: 180,
    widthPx: 1248,
    heightPx: 1765,
    format: "rgba",
    bytesBase64: "AQIDBA==",
  };
}

describe("ADR190 forced OCR recovery instrumentation", () => {
  it("selects the first forced dispatch and keeps later retries distinct with the same raster hash", () => {
    const capture: Capture = {
      jobs: [makeJob("retry", 20, 0), makeJob("first", 10, 0)],
      issues: [],
      workers: [],
      ocrPageInputs: [makeInput("retry", 0), makeInput("first", 0)],
    };
    const attempts = correlateOcrAttempts(capture);
    expect(attempts).toHaveLength(2);
    expect(firstOcrAttempt(attempts)?.job.jobId).toBe("first");
    expect(attempts[0]?.input).toMatchObject({ sourceOrientation: 0, dispatchedOrientation: 180 });
    expect(attempts[0]?.imageSha256).toBe(attempts[1]?.imageSha256);
  });

  it("fails if any dispatch's raster, DPI, or orientation provenance is mismatched", () => {
    const capture: Capture = {
      jobs: [makeJob("first", 10, 0)],
      issues: [],
      workers: [],
      ocrPageInputs: [makeInput("first", 90)],
    };
    expect(() => correlateOcrAttempts(capture)).toThrow("raster metadata differs");
  });

  it("requires exact first production reading parity including OSD error and ink", () => {
    const record = {
      words: [{ text: "DNI", confidence: 0.9 }],
      rawOrientation: null,
      rawConfidence: null,
      rawError: "DetectOS returned no orientation",
      inkRatio: 0.00123,
      productionOrientation: 0,
    };
    expect(firstReadingMatchesQuality(record, record).matches).toBe(true);
    expect(
      firstReadingMatchesQuality({ ...record, words: [{ text: "DNI", confidence: 0.8 }] }, record)
        .wordsMatch,
    ).toBe(false);
    expect(firstReadingMatchesQuality({ ...record, rawError: null }, record).rawErrorMatch).toBe(
      false,
    );
  });

  it("detects an exact DNI OCR token without concatenating unrelated numeric garbage", () => {
    const words = [
      { text: "168", confidence: 0.91 },
      { text: "Documento", confidence: 0.9 },
      { text: "34.567.891", confidence: 0.89 },
    ];
    expect(hasExactDniToken(words, "34.567.891")).toBe(true);
    expect(hasExactDniToken([{ text: "34567891" }], "34.567.891")).toBe(true);
    expect(hasExactDniToken([{ text: "168 34.567.891" }], "34.567.891")).toBe(false);
  });

  it("forces only the first OCR page dispatch and preserves retry orientations", () => {
    const seen = new Set<string>();
    const sourceOrientations = [0, 90, 180, 270, 0];
    const dispatched = sourceOrientations.map((source) =>
      dispatchedOrientationForPage(seen, "doc", 0, source, 90),
    );
    expect(dispatched).toEqual([90, 90, 180, 270, 0]);
  });

  it("keeps name token recall available without conflating it with entity recovery", () => {
    const quality = scoreReading(
      "Juan Perez DNI 34.567.891",
      [word("Juan", 0.9), word("Perez", 0.9), word("34.567.891", 0.9)],
      [],
      "34.567.891",
    );
    expect(quality.nameTokenRecall).toBe(1);
    expect(quality.dniRecovered).toBe(false);
  });

  it("reports current and page-confidence-first rankings without changing candidates", () => {
    const candidates = [
      {
        mode: "forced" as const,
        requestedAngle: 0,
        angle: 0,
        reliableWordCount: 6,
        pageConfidence: 0.4,
      },
      {
        mode: "production-osd" as const,
        requestedAngle: null,
        angle: 270,
        reliableWordCount: 4,
        pageConfidence: 0.95,
      },
    ];
    expect(rankCandidates(candidates, "current")[0]?.angle).toBe(0);
    expect(rankCandidates(candidates, "page-confidence-first")[0]).toMatchObject({
      mode: "production-osd",
      requestedAngle: null,
      angle: 270,
    });
    expect(candidates).toHaveLength(2);
  });

  it("includes issues appended after observation collection in instrument failures", () => {
    const issues: string[] = [];
    const observations = [{ key: "fixture", angle: 90, issues }];
    issues.push("CDP close failed");
    expect(collectInstrumentFailures(observations)).toEqual([
      { key: "fixture", angle: 90, issue: "CDP close failed" },
    ]);
  });

  it("detects reliable words in later attempts and final control output", () => {
    const attempts = [[], [], [], [], [{ text: "x", confidence: 0.75 }]];
    const summary = summarizeReliableWordEvidence(attempts, [{ confidence: 0.75 }]);
    expect(summary).toMatchObject({
      firstAttemptReliableWords: 0,
      attemptReliableWordCounts: [0, 0, 0, 0, 1],
      anyAttemptReliableWords: true,
      maxAttemptReliableWords: 1,
      finalReliableWords: 1,
      anyFinalReliableWords: true,
      anyAttemptOrFinalReliableWords: true,
    });
  });
});
