import { describe, expect, it } from "vitest";

import type { CampaignFixture } from "./adr190Fixtures.js";
import {
  buildOsdControlPlan,
  buildOsdScalePlan,
  countOsdOrientationVerdicts,
  densityFromOsdFixtureKey,
  OSD_CAMPAIGN_REPETITIONS,
  OSD_INTERLEAVED_ORDERS,
  standardMedian,
  matchesOsdScaleBaseline,
  summarizeOsdScaleRuns,
  validateOsdRunCompleteness,
  type OsdQualityBaseline,
} from "./adr190OsdScaleCampaign.js";

function baselines(): OsdQualityBaseline[] {
  return Array.from({ length: 64 }, (_, index) => {
    const sourceDpi = [150, 200, 250, 300][Math.floor(index / 16)]!;
    const angle = [0, 90, 180, 270][Math.floor((index % 16) / 4)]!;
    const density = ["full", "header", "two-lines", "signature"][index % 4]!;
    const key = `${density}-${sourceDpi}-${angle}`;
    return {
      fixture: {
        key,
        path: `${key}.pdf`,
        hash: `${index}`.padStart(64, "0"),
        expectedText: "",
        expectedDni: null,
        expectedCorrectionAngle: (360 - angle) % 360,
        pageWidth: 595,
        pageHeight: 842,
        sourceWidthPx: 1248,
        sourceHeightPx: 1765,
        actualSourceDpi: [sourceDpi, sourceDpi],
        font: "Helvetica",
        fontSize: 12,
        lines: [],
        rotationConvention: "test",
        regionBbox: null,
      } satisfies CampaignFixture,
      sourceDpi,
      angle,
      effectiveDpi: { 150: 151, 200: 201, 250: 251, 300: 300 }[sourceDpi]!,
      inputWidthPx: 1248,
      inputHeightPx: 1765,
      inputImageBytes: 50000,
      rawOrientation: null,
      rawConfidence: null,
      rawError: "DetectOS returned no orientation",
      inkRatio: 0.001,
    };
  });
}

describe("ADR190 OSD scale campaign planning", () => {
  it("enumerates 64 distinct fixtures with three interleaved repetitions", () => {
    const plan = buildOsdScalePlan(baselines());
    expect(plan).toHaveLength(64 * OSD_CAMPAIGN_REPETITIONS);
    expect(new Set(plan.map((item) => item.key)).size).toBe(64);
    expect(plan.slice(0, 3).map((item) => item.order)).toEqual(OSD_INTERLEAVED_ORDERS);
    expect(plan[0]).toMatchObject({
      expectedRawOrientation: null,
      expectedRawConfidence: null,
      expectedRawError: "DetectOS returned no orientation",
    });
  });

  it("keeps blank, noise, and shapes controls outside quality fixture enumeration", () => {
    const plan = buildOsdControlPlan();
    expect(plan).toHaveLength(4 * 3 * OSD_CAMPAIGN_REPETITIONS);
    expect(new Set(plan.map((item) => item.key.split("-")[0]))).toEqual(
      new Set(["blank", "noise", "shapes"]),
    );
    expect(plan.every((item) => item.group === "control")).toBe(true);
  });

  it("uses standard even/odd medians and preserves no-verdict counts", () => {
    expect(standardMedian([138, 147])).toBe(142.5);
    expect(standardMedian([1, 8, 2])).toBe(2);
    expect(
      summarizeOsdScaleRuns([
        {
          group: "quality" as const,
          key: "two-lines-150-0",
          sourceDpi: 150,
          repetition: 1,
          arm: "current-1754" as const,
          detectMs: 10,
          rawOrientation: null,
          rawConfidence: null,
          inkRatio: 0.001,
          error: null,
        },
      ]).cells[0],
    ).toMatchObject({ medianDetectMs: 10, noVerdictCount: 1, completedRuns: 1 });
  });

  it("rejects missing, duplicate, and unexpected run cells", () => {
    const expected = [{ group: "quality" as const, key: "two-lines-150-0" }];
    const observed = OSD_INTERLEAVED_ORDERS.flatMap((order, repIndex) =>
      order.map((arm) => ({
        group: "quality" as const,
        key: "two-lines-150-0",
        repetition: repIndex + 1,
        arm,
      })),
    );
    expect(validateOsdRunCompleteness(expected, observed)).toMatchObject({
      expectedRuns: 9,
      observedRuns: 9,
      missing: [],
      duplicates: [],
      unexpected: [],
    });
    const incomplete = validateOsdRunCompleteness(expected, observed.slice(1));
    expect(incomplete.missing).toHaveLength(1);
    expect(
      validateOsdRunCompleteness(expected, [...observed, observed[0]!]).duplicates,
    ).toHaveLength(1);
  });

  it("does not count null OSD results as angle successes", () => {
    expect(
      countOsdOrientationVerdicts(
        [
          { rawOrientation: null, rawConfidence: null },
          { rawOrientation: 0, rawConfidence: 0.9 },
          { rawOrientation: 0, rawConfidence: 1 },
          { rawOrientation: 180, rawConfidence: 1 },
        ],
        0,
      ),
    ).toEqual({
      expectedRuns: 4,
      verdictRuns: 2,
      noVerdictRuns: 2,
      correctRuns: 1,
      accuracyDenominator: 2,
    });
  });

  it("preserves canonical hyphenated density names", () => {
    expect(densityFromOsdFixtureKey("two-lines-150-0")).toBe("two-lines");
    expect(densityFromOsdFixtureKey("full-300-270")).toBe("full");
    expect(densityFromOsdFixtureKey("shapes-200-0")).toBe("shapes");
  });

  it("compares the no-verdict reason/error against the QUALITY raw error", () => {
    const baseline = {
      rawOrientation: null,
      rawConfidence: null,
      rawError: "DetectOS returned no orientation",
      inkRatio: 0.001,
    };
    const matchingReplay = {
      rawOrientation: null,
      rawConfidence: null,
      error: null,
      noVerdictReason: "DetectOS returned no orientation",
      inkRatio: 0.001,
    };
    expect(matchesOsdScaleBaseline(matchingReplay, baseline).matches).toBe(true);
    expect(
      matchesOsdScaleBaseline({ ...matchingReplay, noVerdictReason: null }, baseline),
    ).toMatchObject({ errorReasonMatch: false, matches: false });
    expect(
      matchesOsdScaleBaseline({ ...matchingReplay, error: "worker failed" }, baseline),
    ).toMatchObject({ errorReasonMatch: false, matches: false });
  });
});
