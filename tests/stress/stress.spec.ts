import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import {
  generateText200p,
  generateText50p,
  TEXT_200P_ENTITY_PAGE_INDICES,
  TEXT_50P_ENTITY_PAGE_INDICES,
} from "../fixtures/generate.js";
import { measureProfile, type ProfileReport } from "../perf/support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "../perf/support/scannedFixtureCache.js";

import { evaluateStressGate } from "./stressGate.js";

const REPORT_DIR = resolve(process.cwd(), ".measure/stress");
const PROFILES = new Map<50 | 200, ProfileReport>();

let scannedProfiles: Readonly<Record<50 | 200, E2eFilePayload>>;

test.beforeAll(async () => {
  await mkdir(REPORT_DIR, { recursive: true });
  // Generate and rasterize outside the measured Electron processes.
  const text50 = await generateText50p();
  const scanned50 = await getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(text50));
  const text200 = await generateText200p();
  const scanned200 = await getOrGenerateScannedFixture("p2-scanned-200p", new Uint8Array(text200));
  scannedProfiles = { 50: scanned50, 200: scanned200 };
});

for (const pages of [50, 200] as const) {
  test(`P2 ${pages}p — cold and hot`, async ({ page, electronApp, electronUserDataDir }) => {
    test.setTimeout(pages === 200 ? 2_100_000 : 600_000);
    await openApp(page);
    const report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      `p2-scanned-${pages}p`,
      scannedProfiles[pages],
      pages === 200 ? 900_000 : 300_000,
    );
    PROFILES.set(pages, report);
    expect(report.cold.ok, `${pages}p cold import failed`).toBe(true);
    expect(report.hot.ok, `${pages}p hot import failed`).toBe(true);
  });
}

test("scale sentinels — 200p/50p ratios within guardrails", async () => {
  const report50 = PROFILES.get(50);
  const report200 = PROFILES.get(200);
  expect(report50, "50p profile did not complete").toBeDefined();
  expect(report200, "200p profile did not complete").toBeDefined();
  if (report50 === undefined || report200 === undefined) return;

  const gate = evaluateStressGate(
    { pages: 50, identity: report50.identity, cold: report50.cold, hot: report50.hot },
    { pages: 200, identity: report200.identity, cold: report200.cold, hot: report200.hot },
    TEXT_50P_ENTITY_PAGE_INDICES,
    TEXT_200P_ENTITY_PAGE_INDICES,
  );
  const summary = {
    capturedAt: new Date().toISOString(),
    configuration: "default application settings; no engine or pool overrides",
    criterion: { m2RatioMaximum: 3, importTimeRatioMaximum: 8 },
    sentinelPageIndices: {
      p50: TEXT_50P_ENTITY_PAGE_INDICES,
      p200: TEXT_200P_ENTITY_PAGE_INDICES,
    },
    identity: { p50: report50.identity, p200: report200.identity },
    profiles: {
      p50: {
        cold: {
          m2Bytes: report50.cold.peakSumBytes,
          totalMs: report50.cold.totalMs,
          groupPageIndices: report50.cold.groupPageIndices,
          groupPageIndicesComplete: report50.cold.groupPageIndicesComplete,
        },
        hot: {
          m2Bytes: report50.hot.peakSumBytes,
          totalMs: report50.hot.totalMs,
          groupPageIndices: report50.hot.groupPageIndices,
          groupPageIndicesComplete: report50.hot.groupPageIndicesComplete,
        },
      },
      p200: {
        cold: {
          m2Bytes: report200.cold.peakSumBytes,
          totalMs: report200.cold.totalMs,
          groupPageIndices: report200.cold.groupPageIndices,
          groupPageIndicesComplete: report200.cold.groupPageIndicesComplete,
        },
        hot: {
          m2Bytes: report200.hot.peakSumBytes,
          totalMs: report200.hot.totalMs,
          groupPageIndices: report200.hot.groupPageIndices,
          groupPageIndicesComplete: report200.hot.groupPageIndicesComplete,
        },
      },
    },
    comparisons: gate.comparisons,
    failures: gate.failures,
  };
  await writeFile(
    resolve(REPORT_DIR, "scale-sentinel.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(`Stress scale sentinel: ${JSON.stringify(summary)}\n`);
  expect(gate.failures, JSON.stringify(gate.failures)).toEqual([]);
});
