import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { DENSITIES } from "./adr190Dpi.js";
import { hashBytes, type CampaignFixture } from "./adr190Fixtures.js";
import { OSD_SCALES, type OsdScaleLabel } from "./adr190OsdScale.js";

export const OSD_CAMPAIGN_REPETITIONS = 3;
export const OSD_CONTROL_DENSITIES = ["blank", "noise", "shapes"] as const;
export const OSD_ALL_DENSITIES = [...DENSITIES, ...OSD_CONTROL_DENSITIES] as const;
export const OSD_INTERLEAVED_ORDERS: ReadonlyArray<ReadonlyArray<OsdScaleLabel>> = [
  ["historical-half", "current-1754", "native"],
  ["current-1754", "native", "historical-half"],
  ["native", "historical-half", "current-1754"],
];

export interface OsdQualityBaseline {
  readonly fixture: CampaignFixture;
  readonly sourceDpi: number;
  readonly angle: number;
  readonly effectiveDpi: number;
  readonly inputWidthPx: number;
  readonly inputHeightPx: number;
  readonly inputImageBytes: number;
  readonly rawOrientation: unknown;
  readonly rawConfidence: unknown;
  readonly rawError: string | null;
  readonly inkRatio: number;
}

interface QualityRecord {
  readonly fixture: CampaignFixture;
  readonly cell: { readonly sourceDpi: number; readonly angle: number; readonly arm: string };
  readonly capture: { readonly jobs: ReadonlyArray<Record<string, unknown>> };
  readonly rawOsd: ReadonlyArray<{
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly error: string | null;
  }>;
}

export async function loadOsdQualityBaselines(sessionPath: string): Promise<OsdQualityBaseline[]> {
  const manifest = JSON.parse(await readFile(join(sessionPath, "manifest.json"), "utf8")) as {
    buildHash?: string;
    fixtures?: CampaignFixture[];
  };
  if (!manifest.buildHash || !manifest.fixtures) throw new Error("invalid QUALITY manifest");
  const files = (await readdir(sessionPath)).filter((name) => /-native-rep1\.json$/.test(name));
  const records: OsdQualityBaseline[] = [];
  for (const name of files) {
    const record = JSON.parse(await readFile(join(sessionPath, name), "utf8")) as QualityRecord;
    if (record.cell.arm !== "native") continue;
    const fixture = manifest.fixtures.find((item) => item.key === record.fixture.key);
    if (!fixture || fixture.hash !== record.fixture.hash)
      throw new Error(`fixture manifest mismatch for ${record.fixture.key}`);
    const pdf = await readFile(fixture.path);
    if (hashBytes(pdf) !== fixture.hash)
      throw new Error(`fixture hash mismatch for ${fixture.key}`);
    const orient = record.capture.jobs.find((job) => job.jobType === "ocr-orient");
    const pageJobs = record.capture.jobs.filter((job) => job.jobType === "ocr-page");
    const page = pageJobs.find((job) => job.terminal === "COMPLETED") ?? pageJobs[0];
    const inkRatio = (orient?.result as { inkRatio?: unknown } | undefined)?.inkRatio;
    const raw = record.rawOsd?.[0];
    if (
      !orient ||
      !page ||
      typeof page.dpi !== "number" ||
      typeof orient.widthPx !== "number" ||
      typeof orient.heightPx !== "number" ||
      typeof orient.imageBytes !== "number" ||
      typeof inkRatio !== "number" ||
      !raw
    )
      throw new Error(`QUALITY raster/OSD baseline incomplete for ${fixture.key}`);
    if (pageJobs.some((job) => job.dpi !== page.dpi))
      throw new Error(`QUALITY effective DPI differs across OCR retries for ${fixture.key}`);
    records.push({
      fixture,
      sourceDpi: record.cell.sourceDpi,
      angle: record.cell.angle,
      effectiveDpi: page.dpi,
      inputWidthPx: orient.widthPx,
      inputHeightPx: orient.heightPx,
      inputImageBytes: orient.imageBytes,
      rawOrientation: raw.rawOrientation,
      rawConfidence: raw.rawConfidence,
      rawError: raw.error,
      inkRatio,
    });
  }
  if (records.length !== 64)
    throw new Error(`expected 64 native QUALITY records, got ${records.length}`);
  return records;
}

export interface OsdScaleCellPlan {
  readonly group: "quality" | "control";
  readonly key: string;
  readonly sourceDpi: number;
  readonly angle: number;
  readonly repetition: number;
  readonly order: ReadonlyArray<OsdScaleLabel>;
  readonly fixtureHash: string;
  readonly effectiveDpi: number | null;
  readonly sourceWidthPx: number | null;
  readonly sourceHeightPx: number | null;
  readonly expectedRawOrientation?: unknown;
  readonly expectedRawConfidence?: unknown;
  readonly expectedRawError?: string | null;
  readonly expectedInkRatio?: number;
}

export function buildOsdScalePlan(
  baselines: ReadonlyArray<OsdQualityBaseline>,
): ReadonlyArray<OsdScaleCellPlan> {
  if (baselines.length !== 64)
    throw new Error(`expected 64 quality fixtures, got ${baselines.length}`);
  const keys = new Set<string>();
  for (const baseline of baselines) {
    if (keys.has(baseline.fixture.key))
      throw new Error(`duplicate quality fixture ${baseline.fixture.key}`);
    keys.add(baseline.fixture.key);
    if (
      ![150, 200, 250, 300].includes(baseline.sourceDpi) ||
      ![0, 90, 180, 270].includes(baseline.angle) ||
      !Number.isInteger(baseline.effectiveDpi) ||
      baseline.effectiveDpi <= 0 ||
      baseline.inputWidthPx <= 0 ||
      baseline.inputHeightPx <= 0 ||
      baseline.inputImageBytes <= 0
    )
      throw new Error(`invalid captured raster metadata for ${baseline.fixture.key}`);
  }
  const plan: OsdScaleCellPlan[] = [];
  for (const baseline of [...baselines].sort((a, b) =>
    a.fixture.key.localeCompare(b.fixture.key),
  )) {
    for (let repetition = 1; repetition <= OSD_CAMPAIGN_REPETITIONS; repetition++) {
      plan.push({
        group: "quality",
        key: baseline.fixture.key,
        sourceDpi: baseline.sourceDpi,
        angle: baseline.angle,
        repetition,
        order: OSD_INTERLEAVED_ORDERS[repetition - 1]!,
        fixtureHash: baseline.fixture.hash,
        effectiveDpi: baseline.effectiveDpi,
        sourceWidthPx: baseline.inputWidthPx,
        sourceHeightPx: baseline.inputHeightPx,
        expectedRawOrientation: baseline.rawOrientation,
        expectedRawConfidence: baseline.rawConfidence,
        expectedRawError: baseline.rawError,
        expectedInkRatio: baseline.inkRatio,
      });
    }
  }
  return plan;
}

export function buildOsdControlPlan(): ReadonlyArray<OsdScaleCellPlan> {
  const result: OsdScaleCellPlan[] = [];
  for (const sourceDpi of [150, 200, 250, 300])
    for (const density of OSD_CONTROL_DENSITIES)
      for (let repetition = 1; repetition <= OSD_CAMPAIGN_REPETITIONS; repetition++)
        result.push({
          group: "control",
          key: `${density}-${sourceDpi}-0`,
          sourceDpi,
          angle: 0,
          repetition,
          order: OSD_INTERLEAVED_ORDERS[repetition - 1]!,
          fixtureHash: "generated-at-run-time",
          effectiveDpi: null,
          sourceWidthPx: null,
          sourceHeightPx: null,
        });
  return result;
}

/** Standard median, including the mean of the two central values for even samples. */
export function standardMedian(values: ReadonlyArray<number>): number | null {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function densityFromOsdFixtureKey(key: string): (typeof OSD_ALL_DENSITIES)[number] {
  const density = OSD_ALL_DENSITIES.find((candidate) => key.startsWith(`${candidate}-`));
  if (!density) throw new Error(`unknown OSD fixture density: ${key}`);
  return density;
}

export function matchesOsdScaleBaseline(
  run: {
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly error: string | null;
    readonly noVerdictReason: string | null;
    readonly inkRatio: number | null;
  },
  baseline: {
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly rawError: string | null;
    readonly inkRatio: number;
  },
) {
  const observedReason = run.error ?? run.noVerdictReason;
  return {
    orientationMatch: run.rawOrientation === baseline.rawOrientation,
    confidenceMatch: run.rawConfidence === baseline.rawConfidence,
    errorReasonMatch: observedReason === baseline.rawError,
    inkRatioMatch: run.inkRatio === baseline.inkRatio,
    matches:
      run.rawOrientation === baseline.rawOrientation &&
      run.rawConfidence === baseline.rawConfidence &&
      observedReason === baseline.rawError &&
      run.inkRatio === baseline.inkRatio,
  };
}

export interface OsdObservedRunKey {
  readonly group: "quality" | "control";
  readonly key: string;
  readonly repetition: number;
  readonly arm: OsdScaleLabel;
}

export function validateOsdRunCompleteness(
  expected: ReadonlyArray<{ readonly group: "quality" | "control"; readonly key: string }>,
  observed: ReadonlyArray<OsdObservedRunKey>,
): {
  readonly expectedRuns: number;
  readonly observedRuns: number;
  readonly missing: string[];
  readonly duplicates: string[];
  readonly unexpected: string[];
} {
  const expectedIds = new Set<string>();
  for (const fixture of expected)
    for (let repetition = 1; repetition <= OSD_CAMPAIGN_REPETITIONS; repetition++)
      for (const arm of OSD_CAMPAIGN_ARMS)
        expectedIds.add(`${fixture.group}:${fixture.key}:${repetition}:${arm}`);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const run of observed) {
    const id = `${run.group}:${run.key}:${run.repetition}:${run.arm}`;
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
    if (!expectedIds.has(id)) unexpected.push(id);
  }
  return {
    expectedRuns: expectedIds.size,
    observedRuns: observed.length,
    missing: [...expectedIds].filter((id) => !seen.has(id)),
    duplicates,
    unexpected,
  };
}

/** Null orientation/confidence is excluded from the accuracy denominator. */
export function countOsdOrientationVerdicts(
  runs: ReadonlyArray<{ readonly rawOrientation: unknown; readonly rawConfidence: unknown }>,
  expectedAngle: number,
  confidenceFloor = 1,
) {
  const eligible = runs.filter(
    (run) =>
      typeof run.rawOrientation === "number" &&
      typeof run.rawConfidence === "number" &&
      run.rawConfidence >= confidenceFloor,
  );
  return {
    expectedRuns: runs.length,
    verdictRuns: eligible.length,
    noVerdictRuns: runs.length - eligible.length,
    correctRuns: eligible.filter((run) => run.rawOrientation === expectedAngle).length,
    accuracyDenominator: eligible.length,
  };
}

export function summarizeOsdScaleRuns<
  T extends {
    readonly group: "quality" | "control";
    readonly key: string;
    readonly sourceDpi: number;
    readonly repetition: number;
    readonly arm: OsdScaleLabel;
    readonly detectMs: number | null;
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly inkRatio: number | null;
    readonly error: string | null;
  },
>(runs: ReadonlyArray<T>) {
  const errors = runs
    .filter((run) => run.error !== null)
    .map((run) => ({ key: run.key, arm: run.arm, error: run.error }));
  const groups = new Map<string, T[]>();
  for (const run of runs) {
    const key = `${run.group}:${run.sourceDpi}:${run.key}:${run.arm}`;
    const values = groups.get(key) ?? [];
    values.push(run);
    groups.set(key, values);
  }
  const cells = [...groups.entries()].map(([key, values]) => {
    const detections = values.flatMap((item) => (item.detectMs === null ? [] : [item.detectMs]));
    return {
      key,
      group: values[0]!.group,
      fixtureKey: values[0]!.key,
      sourceDpi: values[0]!.sourceDpi,
      arm: values[0]!.arm,
      expectedRuns: OSD_CAMPAIGN_REPETITIONS,
      completedRuns: values.length,
      medianDetectMs: standardMedian(detections),
      noVerdictCount: values.filter(
        (item) => item.rawOrientation == null || item.rawConfidence == null,
      ).length,
      inkRatios: values.map((item) => item.inkRatio),
      errors: values.filter((item) => item.error !== null).map((item) => item.error),
    };
  });
  return {
    expectedQualityCells: 64 * OSD_CAMPAIGN_REPETITIONS * 3,
    expectedControlCells: 4 * 3 * OSD_CAMPAIGN_REPETITIONS * 3,
    completedRuns: runs.length,
    instrumentFailures: errors,
    cells,
  };
}

export const OSD_CAMPAIGN_ARMS: ReadonlyArray<OsdScaleLabel> = Object.values(OSD_SCALES).map(
  (scale) => scale.label,
);
