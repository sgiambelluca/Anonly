import { describe, expect, it } from "vitest";

import { classifyTopology, peakSimultaneous, qualityFingerprint } from "./t5Instrumentation.js";

describe("T5 instrumentation", () => {
  it("calculates the simultaneous peak from ordered worker events", () => {
    expect(
      peakSimultaneous(
        [
          { type: "ocr-page", atMs: 2, delta: -1 },
          { type: "ocr-page", atMs: 0, delta: 1 },
          { type: "ocr-page", atMs: 1, delta: 1 },
          { type: "ocr-page", atMs: 3, delta: -1 },
        ],
        "ocr-page",
      ),
    ).toBe(2);
  });

  it("distinguishes the BEFORE and AFTER worker topologies", () => {
    expect(
      classifyTopology([
        { type: "ocr-page", atMs: 0, delta: 1 },
        { type: "ocr-page", atMs: 1, delta: 1 },
        { type: "ocr-page", atMs: 2, delta: -1 },
        { type: "ocr-page", atMs: 3, delta: -1 },
        { type: "ocr-orient", atMs: 0, delta: 1 },
        { type: "ocr-orient", atMs: 1, delta: -1 },
      ]),
    ).toEqual({ lstmPeak: 2, orientationPeak: 1, lstmJobs: 2, orientationJobs: 1 });
  });

  it("produces a stable quality fingerprint from words and geometry", () => {
    const words = [
      [
        {
          text: "uno",
          source: "ocr" as const,
          pageIndex: 0,
          confidence: 0.9,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
        },
      ],
    ];
    expect(qualityFingerprint(words)).toEqual(qualityFingerprint(words));
    expect(qualityFingerprint(words).words).toBe(1);
  });

  it("normalizes page arrival order while preserving word order and geometry", () => {
    const page = (pageIndex: number, text: string) => [
      {
        text,
        source: "ocr" as const,
        pageIndex,
        confidence: 0.9,
        bbox: { x: pageIndex, y: 2, width: 3, height: 4, rotation: 90 as const },
      },
    ];
    expect(qualityFingerprint([page(1, "dos"), page(0, "uno")])).toEqual(
      qualityFingerprint([page(0, "uno"), page(1, "dos")]),
    );
  });
});
