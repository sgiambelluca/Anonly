import { describe, expect, it } from "vitest";

import { computeReanalyzeRenderRequest } from "../components/viewer/reanalyzeRenderRequest.js";

// ADR-056 §3/§8 + ADR-087 §2: composición que `SettingsDialog` invoca tras un
// reanalyze. Un solo rango desde ADR-087 (hay un solo visor); no duplica la
// cobertura de `rangeToPageIndices` en sí (eso ya está en
// `visible-range.test.ts`) — acá se ejercita la composición, que `kind` salga
// siempre fijo en "anonymized" y que la escala sea la del zoom vigente (sin ella
// el motor dibuja a 100 % y la recuerda como vigente, ADR-189 §1).

describe("computeReanalyzeRenderRequest", () => {
  it("expands the visible range into its page indices", () => {
    expect(computeReanalyzeRenderRequest({ start: 2, end: 5 }, 1)).toEqual({
      pageIndices: [2, 3, 4, 5],
      kind: "anonymized",
      scale: 1,
    });
  });

  it("handles a single-page range", () => {
    expect(computeReanalyzeRenderRequest({ start: 7, end: 7 }, 1)).toEqual({
      pageIndices: [7],
      kind: "anonymized",
      scale: 1,
    });
  });

  it("always returns kind: 'anonymized', regardless of the input range", () => {
    expect(computeReanalyzeRenderRequest({ start: 0, end: 0 }, 1).kind).toBe("anonymized");
    expect(computeReanalyzeRenderRequest({ start: 40, end: 42 }, 1).kind).toBe("anonymized");
  });

  it("requests the scale of the current zoom, not the 100 % default", () => {
    expect(computeReanalyzeRenderRequest({ start: 0, end: 1 }, 1.3).scale).toBe(1.3);
    expect(computeReanalyzeRenderRequest({ start: 0, end: 1 }, 0.5).scale).toBe(0.5);
  });
});
