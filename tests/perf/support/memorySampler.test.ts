import { describe, expect, it } from "vitest";

import { peakSumBytesOrNull, type MemorySample } from "./memorySampler.js";

describe("RSS phase window summaries", () => {
  it("keeps a phase with no landed samples unavailable instead of reporting zero", () => {
    expect(peakSumBytesOrNull([])).toBeNull();
  });

  it("reports the greatest process-tree RSS sample in a populated window", () => {
    const samples: ReadonlyArray<MemorySample> = [
      { atMs: 1, sumWorkingSetSizeBytes: 100, perProcess: [] },
      { atMs: 2, sumWorkingSetSizeBytes: 300, perProcess: [] },
      { atMs: 3, sumWorkingSetSizeBytes: 200, perProcess: [] },
    ];
    expect(peakSumBytesOrNull(samples)).toBe(300);
  });
});
