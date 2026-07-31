import { describe, expect, it } from "vitest";

import {
  computeZoomRenderScale,
  PREVIEW_SCALE_DEFAULT,
} from "../components/viewer/zoomRenderScale.js";

describe("computeZoomRenderScale", () => {
  it("defaults previewScale to PREVIEW_SCALE_DEFAULT (1)", () => {
    expect(PREVIEW_SCALE_DEFAULT).toBe(1);
    expect(computeZoomRenderScale(1)).toBe(1);
  });

  it("scales linearly with zoom at the default previewScale", () => {
    expect(computeZoomRenderScale(2)).toBe(2);
    expect(computeZoomRenderScale(0.5)).toBe(0.5);
    expect(computeZoomRenderScale(3)).toBe(3);
  });

  it("honors an explicit previewScale override", () => {
    expect(computeZoomRenderScale(1.5, 2)).toBe(3);
  });
});
