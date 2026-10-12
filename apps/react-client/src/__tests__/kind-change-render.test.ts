import { describe, expect, it } from "vitest";

import { shouldRenderOnKindChange } from "../components/viewer/kindChangeRender.js";

describe("shouldRenderOnKindChange", () => {
  it("returns true when the view switches from original to anonymized with mounted pages", () => {
    expect(
      shouldRenderOnKindChange({
        previousKind: "original",
        kind: "anonymized",
        mountedPageIndicesCount: 3,
      }),
    ).toBe(true);
  });

  it("returns true when the view switches from anonymized to original with mounted pages", () => {
    expect(
      shouldRenderOnKindChange({
        previousKind: "anonymized",
        kind: "original",
        mountedPageIndicesCount: 1,
      }),
    ).toBe(true);
  });

  it("returns false on the initial mount (no previous kind), whatever the kind", () => {
    for (const kind of ["original", "anonymized"] as const) {
      expect(
        shouldRenderOnKindChange({ previousKind: null, kind, mountedPageIndicesCount: 3 }),
      ).toBe(false);
    }
  });

  it("returns false when the kind did not change", () => {
    for (const kind of ["original", "anonymized"] as const) {
      expect(
        shouldRenderOnKindChange({ previousKind: kind, kind, mountedPageIndicesCount: 3 }),
      ).toBe(false);
    }
  });

  it("returns false when there are no mounted pages", () => {
    expect(
      shouldRenderOnKindChange({
        previousKind: "original",
        kind: "anonymized",
        mountedPageIndicesCount: 0,
      }),
    ).toBe(false);
  });
});
