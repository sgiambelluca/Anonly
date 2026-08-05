import { describe, expect, it } from "vitest";

import { computeReanalyzeRenderRequest } from "../components/viewer/reanalyzeRenderRequest.js";

// ADR-056 §3/§8: composición completa que `SettingsDialog` invoca tras un
// reanalyze. No duplica la cobertura de `unionVisibleRange`/`rangeToPageIndices`
// en sí (eso ya está en `visible-range.test.ts`) — acá se ejercita que las dos
// se combinan correctamente y que `kind` sale siempre fijo en "anonymized".

describe("computeReanalyzeRenderRequest", () => {
  it("expands the union of two disjoint ranges into the page indices of both", () => {
    expect(computeReanalyzeRenderRequest({ start: 0, end: 1 }, { start: 5, end: 6 })).toEqual({
      pageIndices: [0, 1, 5, 6],
      kind: "anonymized",
    });
  });

  it("merges overlapping/adjacent ranges into a single contiguous set of page indices", () => {
    expect(computeReanalyzeRenderRequest({ start: 2, end: 5 }, { start: 4, end: 7 })).toEqual({
      pageIndices: [2, 3, 4, 5, 6, 7],
      kind: "anonymized",
    });
  });

  it("always returns kind: 'anonymized', regardless of the input ranges", () => {
    expect(computeReanalyzeRenderRequest({ start: 0, end: 0 }, { start: 0, end: 0 }).kind).toBe(
      "anonymized",
    );
    expect(computeReanalyzeRenderRequest({ start: 10, end: 12 }, { start: 40, end: 42 }).kind).toBe(
      "anonymized",
    );
  });
});
