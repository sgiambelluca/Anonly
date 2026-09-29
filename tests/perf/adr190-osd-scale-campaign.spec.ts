import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";

import {
  installDocumentControl,
  installTransportObserver,
  readDocumentRun,
} from "./support/adr190Browser.js";
import { DENSITIES, type Cell, validateCampaignPage } from "./support/adr190Dpi.js";
import {
  generateCampaignFixtures,
  hashBytes,
  type CampaignFixture,
} from "./support/adr190Fixtures.js";
import { correlateRawOsd, OsdProbe, type RawOsd } from "./support/adr190OsdProbe.js";
import {
  discoverTesseractBrowserBundle,
  OSD_INK_THRESHOLD,
  runOsdScaleArms,
  type CapturedOsdInput,
  type OsdScaleRun,
  type TesseractBrowserBundle,
} from "./support/adr190OsdScale.js";
import {
  buildOsdControlPlan,
  buildOsdScalePlan,
  densityFromOsdFixtureKey,
  loadOsdQualityBaselines,
  matchesOsdScaleBaseline,
  validateOsdRunCompleteness,
  OSD_CAMPAIGN_ARMS,
  OSD_CAMPAIGN_REPETITIONS,
  OSD_CONTROL_DENSITIES,
  OSD_INTERLEAVED_ORDERS,
  standardMedian,
  type OsdQualityBaseline,
} from "./support/adr190OsdScaleCampaign.js";
import { installEngineOverrides } from "./support/engineOverrides.js";

const QUALITY_SESSION = resolve(".measure/adr190-dpi/2026-09-27T23-28-24-682Z-quality-33332");
const OUTPUT_DIR = resolve(
  ".measure/adr190-osd-scale",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-campaign-${process.pid}`,
);
const EXPECTED_EFFECTIVE_DPI: Readonly<Record<number, number>> = {
  150: 151,
  200: 201,
  250: 251,
  300: 300,
};
const ALL_KEYS = [
  ...DENSITIES.flatMap((density) =>
    [150, 200, 250, 300].flatMap((sourceDpi) =>
      [0, 90, 180, 270].map((angle) => `${density}-${sourceDpi}-${angle}`),
    ),
  ),
  ...OSD_CONTROL_DENSITIES.flatMap((density) =>
    [150, 200, 250, 300].map((sourceDpi) => `${density}-${sourceDpi}-0`),
  ),
];

interface CellResult {
  readonly group: "quality" | "control";
  readonly key: string;
  readonly density: string;
  readonly fixtureHash: string;
  readonly sourceDpi: number;
  readonly effectiveDpi: number;
  readonly angle: number;
  readonly expectedCorrectionAngle: number;
  readonly input: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly bytes: number;
    readonly osdInputBytesSha256: string;
  };
  readonly currentApp: {
    readonly rawOsd: RawOsd;
    readonly inkRatio: number;
    readonly baselineMatch: boolean | null;
  };
  readonly arms: ReadonlyArray<{ readonly repetition: number; readonly result: OsdScaleRun }>;
  readonly instrumentErrors: ReadonlyArray<string>;
}

const baselines = new Map<string, OsdQualityBaseline>();
const controls = new Map<string, CampaignFixture>();
const results: CellResult[] = [];
let bundle: TesseractBrowserBundle;

async function hashTree(directoryPath: string) {
  const entries: Array<{ path: string; hash: string; bytes: number }> = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) entries.push(...(await hashTree(path)));
    else {
      const bytes = await readFile(path);
      entries.push({ path, hash: hashBytes(bytes), bytes: bytes.length });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function fixtureFor(key: string): { fixture: CampaignFixture; group: "quality" | "control" } {
  const baseline = baselines.get(key);
  if (baseline) return { fixture: baseline.fixture, group: "quality" };
  const control = controls.get(key);
  if (control) return { fixture: control, group: "control" };
  throw new Error(`fixture missing for planned cell ${key}`);
}

test.describe("ADR190 OSD scale comparison campaign", () => {
  test.skip(
    process.env.ANONLY_ADR190_OSD_CAMPAIGN !== "1",
    "Explicit opt-in full OSD scale campaign",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const loaded = await loadOsdQualityBaselines(QUALITY_SESSION);
    if (new Set(loaded.map((baseline) => baseline.fixture.hash)).size !== 64)
      throw new Error(
        "QUALITY must contain 64 unique fixture hashes, one native record per fixture",
      );
    const baselineVerdicts = loaded.filter(
      (baseline) => baseline.rawOrientation !== null && baseline.rawConfidence !== null,
    ).length;
    const baselineNoVerdicts = loaded.length - baselineVerdicts;
    if (baselineVerdicts !== 48 || baselineNoVerdicts !== 16)
      throw new Error(
        `QUALITY native baseline expected 48 verdicts/16 no-verdicts, got ${baselineVerdicts}/${baselineNoVerdicts}`,
      );
    for (const baseline of loaded) {
      baselines.set(baseline.fixture.key, baseline);
    }
    const controlCells: Cell[] = [];
    for (const sourceDpi of [150, 200, 250, 300])
      for (const density of OSD_CONTROL_DENSITIES)
        controlCells.push({ sourceDpi, density, angle: 0, arm: "native", repetition: 1 });
    const generatedControls = await generateCampaignFixtures(
      controlCells,
      join(OUTPUT_DIR, "control-fixtures"),
    );
    for (const [key, fixture] of generatedControls) controls.set(key, fixture);
    if (
      controls.size !== 12 ||
      new Set([...controls.values()].map((fixture) => fixture.hash)).size !== 12
    )
      throw new Error("control fixtures must have 12 unique generated PDF hashes");

    const qualityPlan = buildOsdScalePlan(loaded);
    const controlPlan = buildOsdControlPlan();
    expect(qualityPlan).toHaveLength(64 * OSD_CAMPAIGN_REPETITIONS);
    expect(controlPlan).toHaveLength(12 * OSD_CAMPAIGN_REPETITIONS);
    expect(baselines.size).toBe(64);
    expect(controls.size).toBe(12);
    const qualityManifest = JSON.parse(
      await readFile(join(QUALITY_SESSION, "manifest.json"), "utf8"),
    ) as {
      buildHash: string;
    };
    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
    if (buildHash !== qualityManifest.buildHash)
      throw new Error("current build hash differs from QUALITY");
    bundle = await discoverTesseractBrowserBundle();
    const manifest = {
      createdAt: new Date().toISOString(),
      phase: "campaign",
      status: "instrument run; quality outcomes are observations",
      qualitySession: QUALITY_SESSION,
      qualityBuildHash: qualityManifest.buildHash,
      buildHash,
      buildMatchesQuality: true,
      tesseractBrowserBundle: bundle,
      arms: OSD_CAMPAIGN_ARMS,
      repetitions: OSD_CAMPAIGN_REPETITIONS,
      interleaving: OSD_INTERLEAVED_ORDERS,
      effectiveDpiBySource: EXPECTED_EFFECTIVE_DPI,
      qualityFixtures: loaded.map((baseline) => ({
        key: baseline.fixture.key,
        fixtureHash: baseline.fixture.hash,
        sourceDpi: baseline.sourceDpi,
        effectiveDpi: baseline.effectiveDpi,
        input: {
          widthPx: baseline.inputWidthPx,
          heightPx: baseline.inputHeightPx,
          imageBytes: baseline.inputImageBytes,
        },
        qualityRawOrientation: baseline.rawOrientation,
        qualityRawConfidence: baseline.rawConfidence,
        qualityRawError: baseline.rawError,
        qualityInkRatio: baseline.inkRatio,
      })),
      controlFixtures: [...controls.values()].map((fixture) => ({
        key: fixture.key,
        fixtureHash: fixture.hash,
      })),
      retention:
        "only per-cell input hashes/dimensions retained; source image bytes stay in memory during each test",
      timings:
        "detectMs excludes worker initialization and input preparation; all three runs retained",
    };
    await writeFile(join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(
      join(OUTPUT_DIR, "plan.json"),
      JSON.stringify({ qualityPlan, controlPlan }, null, 2),
    );
    console.log(`ADR190 OSD campaign session: ${OUTPUT_DIR}`);
  });

  test.afterAll(async () => {
    const runRows = results.flatMap((result) =>
      result.arms.map(({ repetition, result: run }) => ({
        group: result.group,
        key: result.key,
        sourceDpi: result.sourceDpi,
        density: result.density,
        angle: result.angle,
        expectedCorrectionAngle: result.expectedCorrectionAngle,
        repetition,
        arm: run.arm,
        detectMs: run.detectMs,
        workerInitMs: run.workerInitMs,
        imageBuildMs: run.imageBuildMs,
        rawOrientation: run.rawOrientation,
        rawConfidence: run.rawConfidence,
        inkRatio: run.inkRatio,
        noVerdict: run.noVerdict,
        expectedOrientationCorrect: run.expectedOrientationCorrect,
        orientationVerdictEligible:
          typeof run.rawOrientation === "number" &&
          typeof run.rawConfidence === "number" &&
          run.rawConfidence >= 1,
        widthPx: run.widthPx,
        heightPx: run.heightPx,
        pixelsBytes: run.pixelsBytes,
        error: run.error ?? result.instrumentErrors[0] ?? null,
      })),
    );
    const runGroups = new Map<string, typeof runRows>();
    for (const row of runRows) {
      const id = `${row.group}:${row.key}:${row.arm}`;
      const group = runGroups.get(id) ?? [];
      group.push(row);
      runGroups.set(id, group);
    }
    const aggregate = [...runGroups.entries()].map(([id, rows]) => {
      const times = rows.flatMap((row) => (row.detectMs === null ? [] : [row.detectMs]));
      return {
        id,
        group: rows[0]!.group,
        key: rows[0]!.key,
        sourceDpi: rows[0]!.sourceDpi,
        arm: rows[0]!.arm,
        expectedRuns: OSD_CAMPAIGN_REPETITIONS,
        completedRuns: rows.length,
        medianDetectMs: standardMedian(times),
        minDetectMs: times.length ? Math.min(...times) : null,
        maxDetectMs: times.length ? Math.max(...times) : null,
        noVerdictCount: rows.filter((row) => row.noVerdict).length,
        lowConfidenceCount: rows.filter((row) => !row.noVerdict && !row.orientationVerdictEligible)
          .length,
        orientationAccuracyDenominator:
          rows[0]!.group === "quality"
            ? rows.filter((row) => row.orientationVerdictEligible).length
            : null,
        inkRatios: rows.map((row) => row.inkRatio),
        expectedOrientationCorrectCount:
          rows[0]!.group === "quality"
            ? rows.filter((row) => row.expectedOrientationCorrect === true).length
            : null,
      };
    });
    const qualityResults = results.filter((result) => result.group === "quality");
    const controlResults = results.filter((result) => result.group === "control");
    const qualityExpected = 64 * OSD_CAMPAIGN_REPETITIONS;
    const controlsExpected = 12 * OSD_CAMPAIGN_REPETITIONS;
    const completeness = validateOsdRunCompleteness(
      ALL_KEYS.map((key) => ({
        group: baselines.has(key) ? ("quality" as const) : ("control" as const),
        key,
      })),
      runRows,
    );
    const summary = {
      phase: "campaign",
      expectedQualityFixtures: 64,
      completedQualityFixtures: new Set(qualityResults.map((item) => item.key)).size,
      expectedQualityObservations: qualityExpected,
      completedQualityObservations: qualityResults.length * OSD_CAMPAIGN_REPETITIONS,
      expectedQualityRuns: qualityExpected * 3,
      completedQualityRuns: qualityResults.reduce((sum, result) => sum + result.arms.length, 0),
      expectedControlFixtures: 12,
      completedControlFixtures: new Set(controlResults.map((item) => item.key)).size,
      expectedControlObservations: controlsExpected,
      completedControlObservations: controlResults.length * OSD_CAMPAIGN_REPETITIONS,
      expectedControlRuns: controlsExpected * 3,
      completedControlRuns: controlResults.reduce((sum, result) => sum + result.arms.length, 0),
      instrumentFailures: results.flatMap((result) =>
        result.instrumentErrors.map((error) => ({ key: result.key, error })),
      ),
      qualityBaselineMismatches: qualityResults
        .filter((result) => result.instrumentErrors.some((issue) => issue.includes("QUALITY")))
        .map((result) => ({
          key: result.key,
          issues: result.instrumentErrors.filter((issue) => issue.includes("QUALITY")),
        })),
      baselineRawVerdicts: loadedCount("valid"),
      baselineNoVerdict: loadedCount("null"),
      controlFalseVerdictsByArm: Object.fromEntries(
        OSD_CAMPAIGN_ARMS.map((arm) => [
          arm,
          runRows.filter(
            (row) => row.group === "control" && row.arm === arm && row.orientationVerdictEligible,
          ).length,
        ]),
      ),
      qualityNoVerdictByArm: Object.fromEntries(
        OSD_CAMPAIGN_ARMS.map((arm) => [
          arm,
          aggregate
            .filter((item) => item.group === "quality" && item.arm === arm)
            .reduce((sum, item) => sum + item.noVerdictCount, 0),
        ]),
      ),
      controls: aggregate.filter((item) => item.group === "control"),
      completeness,
      aggregate,
      qualityApproved: false,
    };
    await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(OUTPUT_DIR, "runs.json"), JSON.stringify(runRows, null, 2));
  });

  for (const key of ALL_KEYS) {
    test(key, async ({ page, electronUserDataDir }) => {
      const { fixture, group } = fixtureFor(key);
      const fixtureBytes = await readFile(fixture.path);
      const fixtureHash = hashBytes(fixtureBytes);
      expect(fixtureHash, `${key} fixture hash`).toBe(fixture.hash);
      const baseline = baselines.get(key);
      const sourceDpi = baseline?.sourceDpi ?? Number(key.split("-").at(-2));
      const angle = baseline?.angle ?? 0;
      const expectedCorrectionAngle = fixture.expectedCorrectionAngle;
      const issues: string[] = [];

      await installTransportObserver(page, { retainOrientationInputs: true });
      await installSettingsOverride(page, { nerEnabled: false });
      await installEngineOverrides(page, {
        ner: { enabled: false },
        ocr: { dpi: 300 },
        workerPool: { ocrPoolSize: 2, pdfPoolSize: 2, renderPoolSize: 2 },
      });
      let probe: OsdProbe | null = null;
      let rawActual: RawOsd | null = null;
      let observedInput: CapturedOsdInput | null = null;
      let appInkRatio: number | null = null;
      let effectiveDpi: number | null = null;
      try {
        probe = await OsdProbe.connect(electronUserDataDir);
        await openApp(page, "networkidle");
        await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
        await installDocumentControl(page, "native");
        await page.locator('input[type="file"]').setInputFiles({
          name: `${key}.pdf`,
          mimeType: "application/pdf",
          buffer: fixtureBytes,
        });
        await page.waitForFunction(
          () => globalThis.__adr190?.ready || globalThis.__adr190?.failure !== null,
          undefined,
          { timeout: 240_000 },
        );
        const run = await readDocumentRun(page);
        await probe.drain();
        const readings = correlateRawOsd(run.capture.jobs, probe.readings);
        if (readings.length !== 1)
          throw new Error(`expected one app OSD reading, got ${readings.length}`);
        rawActual = readings[0] ?? null;
        const orientJob = run.capture.jobs.find((job) => job.jobType === "ocr-orient");
        validateCampaignPage(run.capture, 0, EXPECTED_EFFECTIVE_DPI[sourceDpi]!);
        const pageJobs = run.capture.jobs.filter((job) => job.jobType === "ocr-page");
        const pageJob = pageJobs.find((job) => job.terminal === "COMPLETED") ?? pageJobs[0];
        const orientResult = orientJob?.result as { inkRatio?: number } | null;
        observedInput =
          run.capture.orientationInputs?.find((input) => input.jobId === orientJob?.jobId) ?? null;
        if (
          !orientJob ||
          !pageJob ||
          typeof pageJob.dpi !== "number" ||
          !orientResult ||
          typeof orientResult.inkRatio !== "number" ||
          !observedInput
        )
          throw new Error("app OSD source or effective raster metadata missing");
        appInkRatio = orientResult.inkRatio;
        effectiveDpi = pageJob.dpi;
        if (effectiveDpi !== EXPECTED_EFFECTIVE_DPI[sourceDpi])
          throw new Error(
            `effective DPI ${effectiveDpi} != expected ${EXPECTED_EFFECTIVE_DPI[sourceDpi]}`,
          );
        if (
          baseline &&
          (observedInput.widthPx !== baseline.inputWidthPx ||
            observedInput.heightPx !== baseline.inputHeightPx ||
            Buffer.from(observedInput.bytesBase64, "base64").byteLength !==
              baseline.inputImageBytes)
        )
          throw new Error("current OSD raster dimensions/bytes differ from QUALITY");
      } catch (error) {
        issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      } finally {
        if (probe)
          await probe.close().catch((error: unknown) => issues.push(`CDP close: ${String(error)}`));
      }
      if (!observedInput || !rawActual || appInkRatio === null || effectiveDpi === null) {
        await writeFile(
          join(OUTPUT_DIR, `${key}.failure.json`),
          JSON.stringify({ key, fixtureHash, issues, rawActual, effectiveDpi }, null, 2),
        );
        throw new Error(issues.join("; ") || "capture incomplete");
      }
      const sourceBytesSha256 = hashBytes(Buffer.from(observedInput.bytesBase64, "base64"));
      const appBaselineMatch = baseline
        ? rawActual.rawOrientation === baseline.rawOrientation &&
          rawActual.rawConfidence === baseline.rawConfidence &&
          rawActual.error === baseline.rawError &&
          appInkRatio === baseline.inkRatio
        : null;
      if (baseline && !appBaselineMatch)
        issues.push("current app OSD raw result/inkRatio differs from QUALITY baseline");

      const allArms: Array<{ repetition: number; result: OsdScaleRun }> = [];
      const plannedOrders = OSD_INTERLEAVED_ORDERS;
      for (let repetition = 1; repetition <= OSD_CAMPAIGN_REPETITIONS; repetition++) {
        const order = plannedOrders[repetition - 1];
        if (!order) throw new Error(`missing interleaved order ${repetition}`);
        try {
          const runs = await runOsdScaleArms(
            page,
            observedInput,
            bundle,
            expectedCorrectionAngle,
            order,
          );
          if (
            runs.length !== 3 ||
            OSD_CAMPAIGN_ARMS.some((arm) => !runs.some((run) => run.arm === arm))
          )
            throw new Error(`repetition ${repetition} omitted a scale arm`);
          for (const run of runs) {
            if (run.error) issues.push(`${run.arm} rep${repetition}: ${run.error}`);
            if (run.inkRatio === null || run.inkPresent !== run.inkRatio >= OSD_INK_THRESHOLD)
              issues.push(`${run.arm} rep${repetition}: inconsistent ink ratio classification`);
            if (baseline && run.arm === "current-1754") {
              const baselineMatch = matchesOsdScaleBaseline(run, baseline);
              if (!baselineMatch.matches)
                issues.push(
                  `current-1754 rep${repetition} differs from QUALITY baseline: ${JSON.stringify(baselineMatch)}`,
                );
            }
            allArms.push({ repetition, result: run });
          }
        } catch (error) {
          issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        }
      }
      const cell: CellResult = {
        group,
        key,
        density: densityFromOsdFixtureKey(key),
        fixtureHash,
        sourceDpi,
        effectiveDpi,
        angle,
        expectedCorrectionAngle,
        input: {
          widthPx: observedInput.widthPx,
          heightPx: observedInput.heightPx,
          bytes: Buffer.from(observedInput.bytesBase64, "base64").byteLength,
          osdInputBytesSha256: sourceBytesSha256,
        },
        currentApp: { rawOsd: rawActual, inkRatio: appInkRatio, baselineMatch: appBaselineMatch },
        arms: allArms,
        instrumentErrors: issues,
      };
      results.push(cell);
      await writeFile(join(OUTPUT_DIR, `${key}.json`), JSON.stringify(cell, null, 2));
      expect(issues, `${key} instrument errors`).toEqual([]);
      expect(allArms, `${key} all three repetitions`).toHaveLength(9);
      if (baseline) expect(appBaselineMatch, `${key} current app matches QUALITY`).toBe(true);
    });
  }
});

function loadedCount(kind: "valid" | "null"): number {
  return [...baselines.values()].filter((item) =>
    kind === "valid"
      ? item.rawOrientation !== null && item.rawConfidence !== null
      : item.rawOrientation === null || item.rawConfidence === null,
  ).length;
}
