import { describe, expect, it } from "vitest";

import { containsIdentifierDigits } from "./ocrRegionPrototypeAudit.js";

describe("25 pt prototype mixed-layer evidence", () => {
  it("normalizes truth and OCR text symmetrically and detects an erroneous raster target", () => {
    const nativeOnlyLayer = ["DNI 34.567.891", "Contenido publico"];
    expect(containsIdentifierDigits(nativeOnlyLayer, "34.567.891")).toBe(true);
    expect(containsIdentifierDigits(nativeOnlyLayer, "62.938.475")).toBe(false);

    const erroneousLayer = [...nativeOnlyLayer, "DNI 62.938.475"];
    expect(containsIdentifierDigits(erroneousLayer, "62.938.475")).toBe(true);
  });
});
