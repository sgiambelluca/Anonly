import { describe, expect, it } from "vitest";

import {
  discoverTesseractBrowserBundle,
  OSD_SCALES,
  scaleFactorForArm,
  scaledOsdDimensions,
} from "./adr190OsdScale.js";

describe("ADR190 OSD scale probe", () => {
  it("uses the historical, target-side and native scale definitions", () => {
    expect(scaleFactorForArm(OSD_SCALES.historicalHalf.label, 3507)).toBe(0.5);
    expect(scaleFactorForArm(OSD_SCALES.current1754.label, 3507)).toBe(1754 / 3507);
    expect(scaleFactorForArm(OSD_SCALES.native.label, 3507)).toBe(1);
    expect(scaleFactorForArm(OSD_SCALES.current1754.label, 800)).toBe(2);
  });

  it("rounds dimensions like the orientation kernel and detects equivalent 300-DPI arms", () => {
    const current = scaleFactorForArm(OSD_SCALES.current1754.label, 3507);
    const historical = scaleFactorForArm(OSD_SCALES.historicalHalf.label, 3507);
    expect(scaledOsdDimensions(2480, 3507, current)).toEqual({ widthPx: 1240, heightPx: 1754 });
    expect(scaledOsdDimensions(2480, 3507, historical)).toEqual({ widthPx: 1240, heightPx: 1754 });
  });

  it("resolves the Tesseract browser API from the exact built orientation-kernel import", async () => {
    const bundle = await discoverTesseractBrowserBundle();
    expect(bundle.modulePath).toMatch(/^\/assets\/tesseract-paths-.+\.js$/);
    expect(bundle.namespaceExport).toBe(bundle.oemExport);
  });
});
