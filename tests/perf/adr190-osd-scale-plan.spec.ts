import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "../e2e/support/electronApp.js";

import { hashBytes } from "./support/adr190Fixtures.js";
import {
  buildOsdControlPlan,
  buildOsdScalePlan,
  loadOsdQualityBaselines,
  OSD_CAMPAIGN_REPETITIONS,
} from "./support/adr190OsdScaleCampaign.js";

const QUALITY_SESSION = resolve(".measure/adr190-dpi/2026-09-27T23-28-24-682Z-quality-33332");
const OUTPUT_DIR = resolve(
  ".measure/adr190-osd-scale",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-matrix-plan-${process.pid}`,
);

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

test("ADR190 OSD scale matrix plan dry-check", async () => {
  test.skip(process.env.ANONLY_ADR190_OSD_PLAN !== "1", "Explicit opt-in plan dry-check");
  const quality = JSON.parse(await readFile(join(QUALITY_SESSION, "manifest.json"), "utf8")) as {
    buildHash: string;
  };
  const baselines = await loadOsdQualityBaselines(QUALITY_SESSION);
  const qualityPlan = buildOsdScalePlan(baselines);
  const controls = buildOsdControlPlan();
  const observedDpi = [...new Set(baselines.map((baseline) => baseline.effectiveDpi))].sort(
    (a, b) => a - b,
  );
  const effectiveDpiBySource = new Map<number, Set<number>>();
  for (const baseline of baselines) {
    const observed = effectiveDpiBySource.get(baseline.sourceDpi) ?? new Set<number>();
    observed.add(baseline.effectiveDpi);
    effectiveDpiBySource.set(baseline.sourceDpi, observed);
  }
  expect([...effectiveDpiBySource.entries()].map(([dpi, values]) => [dpi, [...values]])).toEqual([
    [150, [151]],
    [200, [201]],
    [250, [251]],
    [300, [300]],
  ]);
  expect(observedDpi, "effective DPI values from actual ocr-page dispatches").toEqual([
    151, 201, 251, 300,
  ]);
  expect(qualityPlan).toHaveLength(64 * OSD_CAMPAIGN_REPETITIONS);
  expect(controls).toHaveLength(4 * 3 * OSD_CAMPAIGN_REPETITIONS);
  expect(new Set(baselines.map((baseline) => baseline.fixture.hash)).size).toBe(64);
  expect(qualityPlan.every((cell) => cell.expectedInkRatio !== undefined)).toBe(true);

  const buildFiles = [
    ...(await hashTree(resolve("apps/react-client/dist"))),
    ...(await hashTree(resolve("apps/desktop-shell/dist"))),
  ];
  const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
  const plan = {
    createdAt: new Date().toISOString(),
    status: "enumeration-only; no detector calls executed",
    qualitySession: QUALITY_SESSION,
    buildHash,
    qualityBuildHash: quality.buildHash,
    buildMatchesQuality: buildHash === quality.buildHash,
    fixtureCount: baselines.length,
    fixtureHashes: baselines.map(({ fixture }) => ({ key: fixture.key, hash: fixture.hash })),
    effectiveDpiByFixture: baselines.map(
      ({ fixture, sourceDpi, effectiveDpi, inputWidthPx, inputHeightPx, inputImageBytes }) => ({
        key: fixture.key,
        sourceDpi,
        effectiveDpi,
        osdInput: { widthPx: inputWidthPx, heightPx: inputHeightPx, bytes: inputImageBytes },
      }),
    ),
    quality: {
      expectedFixtures: 64,
      repetitions: 3,
      arms: 3,
      expectedRuns: qualityPlan.length * 3,
    },
    controls: {
      densities: ["blank", "noise", "shapes"],
      sourceDpis: [150, 200, 250, 300],
      repetitions: 3,
      arms: 3,
      expectedRuns: controls.length * 3,
    },
    interleaving: ["half/current/native", "current/native/half", "native/half/current"],
    plan: [...qualityPlan, ...controls],
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(join(OUTPUT_DIR, "plan.json"), JSON.stringify(plan, null, 2));
  const summary = {
    status: "plan-only; no OSD execution",
    expectedQualityFixtures: 64,
    completedQualityFixtures: baselines.length,
    expectedQualityRuns: qualityPlan.length * 3,
    expectedControlFixtures: 12,
    expectedControlRuns: controls.length * 3,
    qualityBaselineFixturesValidated: 64,
    baselineRawVerdicts: baselines.filter(
      (item) => item.rawOrientation !== null && item.rawConfidence !== null,
    ).length,
    baselineNoVerdict: baselines.filter(
      (item) => item.rawOrientation === null || item.rawConfidence === null,
    ).length,
    baselineInkPresent: baselines.filter((item) => item.inkRatio >= 0.002).length,
    effectiveDpi: observedDpi,
    buildMatchesQuality: plan.buildMatchesQuality,
    instrumentFailures: [],
  };
  await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`ADR190 OSD matrix plan: ${OUTPUT_DIR}`);
  expect(plan.buildMatchesQuality, "build hash matches QUALITY").toBe(true);
});
