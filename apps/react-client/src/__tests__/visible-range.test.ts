import { describe, expect, it } from "vitest";

import {
  computeMountRange,
  computeVisibleRangeFromIndices,
  rangeToPageIndices,
} from "../components/viewer/visibleRange.js";

describe("computeVisibleRangeFromIndices", () => {
  it("returns undefined for an empty set (caller keeps the previous range)", () => {
    expect(computeVisibleRangeFromIndices(new Set())).toBeUndefined();
    expect(computeVisibleRangeFromIndices([])).toBeUndefined();
  });

  it("collapses a single index to a single-page range", () => {
    expect(computeVisibleRangeFromIndices([3])).toEqual({ start: 3, end: 3 });
  });

  it("reduces an unsorted set of indices to {min, max}", () => {
    expect(computeVisibleRangeFromIndices(new Set([5, 3, 4]))).toEqual({ start: 3, end: 5 });
  });

  it("ignores duplicate indices", () => {
    expect(computeVisibleRangeFromIndices([2, 2, 2])).toEqual({ start: 2, end: 2 });
  });
});

describe("computeMountRange", () => {
  it("expands the visible range by 1 page before and after", () => {
    expect(computeMountRange({ start: 3, end: 5 }, 20)).toEqual({ start: 2, end: 6 });
  });

  it("clamps the lower bound to 0", () => {
    expect(computeMountRange({ start: 0, end: 1 }, 20)).toEqual({ start: 0, end: 2 });
  });

  it("clamps the upper bound to pageCount - 1", () => {
    expect(computeMountRange({ start: 8, end: 9 }, 10)).toEqual({ start: 7, end: 9 });
  });

  it("returns an empty range when pageCount is 0 (document not parsed yet)", () => {
    const range = computeMountRange({ start: 0, end: 0 }, 0);
    expect(range.end).toBeLessThan(range.start);
  });

  it("returns an empty range when pageCount is negative (defensive)", () => {
    const range = computeMountRange({ start: 0, end: 0 }, -1);
    expect(range.end).toBeLessThan(range.start);
  });

  it("handles a single-page document", () => {
    expect(computeMountRange({ start: 0, end: 0 }, 1)).toEqual({ start: 0, end: 0 });
  });
});

describe("rangeToPageIndices", () => {
  it("expands a range to its page indices", () => {
    expect(rangeToPageIndices({ start: 2, end: 5 })).toEqual([2, 3, 4, 5]);
  });

  it("returns a single index for a single-page range", () => {
    expect(rangeToPageIndices({ start: 4, end: 4 })).toEqual([4]);
  });

  it("returns [] for an empty range (end < start)", () => {
    expect(rangeToPageIndices({ start: 3, end: 2 })).toEqual([]);
  });
});
