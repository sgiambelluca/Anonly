import { describe, expect, it } from "vitest";

import { computeReanalyzeRenderRequest } from "../components/viewer/reanalyzeRenderRequest.js";

// ADR-056 §3/§8 + ADR-087 §2: composición que `SettingsDialog` invoca tras un
// reanalyze. Un solo rango desde ADR-087 (hay un solo visor); no duplica la
// cobertura de `rangeToPageIndices` en sí (eso ya está en
// `visible-range.test.ts`) — acá se ejercita la composición y que `kind` salga
// siempre fijo en "anonymized".

describe("computeReanalyzeRenderRequest", () => {
  it("expands the visible range into its page indices", () => {
    expect(computeReanalyzeRenderRequest({ start: 2, end: 5 })).toEqual({
      pageIndices: [2, 3, 4, 5],
      kind: "anonymized",
    });
  });

  it("handles a single-page range", () => {
    expect(computeReanalyzeRenderRequest({ start: 7, end: 7 })).toEqual({
      pageIndices: [7],
      kind: "anonymized",
    });
  });

  it("always returns kind: 'anonymized', regardless of the input range", () => {
    expect(computeReanalyzeRenderRequest({ start: 0, end: 0 }).kind).toBe("anonymized");
    expect(computeReanalyzeRenderRequest({ start: 40, end: 42 }).kind).toBe("anonymized");
  });
});
