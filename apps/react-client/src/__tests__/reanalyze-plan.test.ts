import { describe, expect, it } from "vitest";

import { diffReanalyzeChange, planReanalyzePatches } from "../components/toolbar/reanalyzePlan.js";

describe("planReanalyzePatches", () => {
  it("returns an empty plan when nothing changed", () => {
    expect(planReanalyzePatches({})).toEqual([]);
  });

  it("returns a single ocr patch when only ocrLanguages changed", () => {
    const patches = planReanalyzePatches({ ocr: { languages: ["spa"] } });
    expect(patches).toEqual([{ ocr: { languages: ["spa"] } }]);
  });

  it("returns a single ner patch when only nerEnabled changed", () => {
    const patches = planReanalyzePatches({ ner: { enabled: false } });
    expect(patches).toEqual([{ ner: { enabled: false } }]);
  });

  it("returns two sequential patches, ocr first, when both changed (PR3 mitigation)", () => {
    const patches = planReanalyzePatches({
      ner: { enabled: true },
      ocr: { languages: ["spa", "eng"] },
    });
    expect(patches).toEqual([{ ocr: { languages: ["spa", "eng"] } }, { ner: { enabled: true } }]);
  });
});

describe("diffReanalyzeChange", () => {
  const base = { nerEnabled: true, ocrLanguages: ["spa", "eng"] };

  it("returns an empty diff when nothing changed", () => {
    expect(diffReanalyzeChange(base, { nerEnabled: true, ocrLanguages: ["spa", "eng"] })).toEqual(
      {},
    );
  });

  it("ignores ocrLanguages order when comparing", () => {
    expect(diffReanalyzeChange(base, { nerEnabled: true, ocrLanguages: ["eng", "spa"] })).toEqual(
      {},
    );
  });

  it("detects a nerEnabled change", () => {
    expect(diffReanalyzeChange(base, { nerEnabled: false, ocrLanguages: ["spa", "eng"] })).toEqual({
      ner: { enabled: false },
    });
  });

  it("detects an ocrLanguages content change", () => {
    expect(diffReanalyzeChange(base, { nerEnabled: true, ocrLanguages: ["spa"] })).toEqual({
      ocr: { languages: ["spa"] },
    });
  });

  it("detects both changing at once", () => {
    expect(diffReanalyzeChange(base, { nerEnabled: false, ocrLanguages: ["eng"] })).toEqual({
      ner: { enabled: false },
      ocr: { languages: ["eng"] },
    });
  });
});
