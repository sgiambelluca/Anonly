import { describe, expect, it } from "vitest";

import { assessIndependentSourceLegibility, scoreOcrText } from "./ocrSmallRegionCorpus.js";

describe("small-region source-truth controls", () => {
  it("treats empty OCR for a truth-bearing source as inconclusive", () => {
    expect(
      assessIndependentSourceLegibility("sensitive", ["34567891"], ["DNI", "34567891"], ""),
    ).toMatchObject({
      independentlyReadable: false,
      inconclusive: true,
      status: "INCONCLUSIVE_NOT_CONFIRMED_BY_INDEPENDENT_OCR",
    });
  });

  it("reports spurious text on a no-text source instead of calling it a successful read", () => {
    expect(scoreOcrText([], "REGION PUBLICA").nonemptyTextWithoutNumericTruth).toBe(true);
    expect(scoreOcrText([], "").nonemptyTextWithoutNumericTruth).toBe(false);
    expect(assessIndependentSourceLegibility("blank", [], [], "E")).toMatchObject({
      independentlyReadable: false,
      inconclusive: true,
      spuriousTextForNoTextTruth: true,
    });
  });
});
