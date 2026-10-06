import { describe, expect, it } from "vitest";

import { summarizeReadableForcedTargets } from "./forcedOcrQuality.js";

describe("forced OCR quality denominator", () => {
  it("excludes admitted rows with no forced result but counts an executed miss", () => {
    const summary = summarizeReadableForcedTargets([
      {
        id: "admitted-not-forced",
        truthCount: 1,
        sourceReadable: true,
        forcedOcr: null,
      },
      {
        id: "forced-but-missed",
        truthCount: 1,
        sourceReadable: true,
        forcedOcr: { truthFoundCount: 0, truthMissingCount: 1, inconclusive: true },
      },
      {
        id: "forced-and-found",
        truthCount: 1,
        sourceReadable: true,
        forcedOcr: { truthFoundCount: 1, truthMissingCount: 0, inconclusive: false },
      },
    ]);

    expect(summary).toEqual({
      readableSourceCount: 3,
      attemptedCount: 2,
      recoveredCount: 1,
      missCaseIds: ["forced-but-missed"],
      inconclusiveCaseIds: ["forced-but-missed"],
      noForcedOcrCaseIds: ["admitted-not-forced"],
    });
  });
});
