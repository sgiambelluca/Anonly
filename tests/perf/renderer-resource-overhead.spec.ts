import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { measureProfile, type ProfileReport, type RunReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

const execFileAsync = promisify(execFile);
const SESSION_ID = `${new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, "")
  .slice(0, 14)}-${Math.random().toString(16).slice(2, 10)}`;
const OUT_DIR = resolve(process.cwd(), ".measure/renderer-resource-overhead", SESSION_ID);
const NATIVE_INTERVAL_MS = 1_000;

type Condition = "without-footprint" | "with-footprint";

interface OverheadRun {
  readonly temperature: RunReport["temperature"];
  readonly totalMs: number | null;
  readonly peakSumBytes: number;
  readonly baselineBytes: number;
  readonly m1Bytes: number | null;
  readonly postReadyPeakBytes: number | null;
  readonly peakPosition: RunReport["peakPosition"];
  readonly hotBaselineSettled: boolean | null;
  readonly systemPressureAtStart: RunReport["systemPressureAtStart"];
  readonly systemPressureAtEnd: RunReport["systemPressureAtEnd"];
  readonly ok: boolean;
  readonly panelVisible: boolean | undefined;
}

function summarizeRun(run: RunReport): OverheadRun {
  return {
    temperature: run.temperature,
    totalMs: run.totalMs,
    peakSumBytes: run.peakSumBytes,
    baselineBytes: run.baselineBytes,
    m1Bytes: run.m1Bytes,
    postReadyPeakBytes: run.postReadyPeakBytes,
    peakPosition: run.peakPosition,
    hotBaselineSettled: run.hotBaselineSettled,
    systemPressureAtStart: run.systemPressureAtStart,
    systemPressureAtEnd: run.systemPressureAtEnd,
    ok: run.ok,
    panelVisible: run.panelVisible,
  };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function writeManifest(): Promise<void> {
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"]);
  const assetDir = resolve(process.cwd(), "apps/react-client/dist/assets");
  const assetNames = (await readdir(assetDir)).sort();
  const assets = Object.fromEntries(
    await Promise.all(
      assetNames.map(async (name) => [name, await sha256(resolve(assetDir, name))]),
    ),
  );
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUT_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        sessionId: SESSION_ID,
        commit: commit.trim(),
        dirty: status.trim().length > 0,
        build: {
          shellMainSha256: await sha256("apps/desktop-shell/dist/main.js"),
          reactAssetsSha256: assets,
        },
        configuration: {
          nativeFootprintIntervalMs: NATIVE_INTERVAL_MS,
          nativeRestDurationMs: 0,
          fixtureProfiles: ["P1 textTenPagesFile", "P2 p2-scanned-50p"],
        },
        clocks: { capturedAtEpochMs: Date.now(), timeOriginMs: performance.timeOrigin },
      },
      null,
      2,
    )}\n`,
  );
}

async function writeResult(
  profile: string,
  order: string,
  condition: Condition,
  report: ProfileReport,
): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    resolve(OUT_DIR, `${profile}-${order}-${condition}.json`),
    `${JSON.stringify(
      {
        sessionId: SESSION_ID,
        profile,
        order,
        condition,
        capturedAt: report.capturedAt,
        identity: report.identity,
        nativeMemoryAvailable: (report.nativeMemorySamples ?? []).some((sample) =>
          sample.processes.some((process) => process.available),
        ),
        nativeMemorySampleCount: report.nativeMemorySamples?.length ?? 0,
        nativeMemoryErrors: report.nativeMemoryErrors ?? [],
        runs: [report.cold, report.hot].map(summarizeRun),
      },
      null,
      2,
    )}\n`,
  );
}

async function runCondition(
  profile: "p1" | "p2",
  order: string,
  condition: Condition,
  page: Parameters<typeof measureProfile>[0],
  electronApp: Parameters<typeof measureProfile>[1],
  electronUserDataDir: string,
): Promise<ProfileReport> {
  const file =
    profile === "p1"
      ? await textTenPagesFile()
      : await getOrGenerateScannedFixture(
          "renderer-resource-overhead-p2-scanned-50p",
          new Uint8Array(await generateText50p()),
        );
  await openApp(page, "networkidle");
  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `renderer-overhead-${profile}-${condition}`,
    file,
    180_000,
    [],
    undefined,
    profile === "p1" ? 30 : 150,
    undefined,
    condition === "with-footprint" ? NATIVE_INTERVAL_MS : undefined,
  );
  await writeResult(profile, order, condition, report);
  return report;
}

test.describe.serial("overhead footprint A/B — instancias frescas", () => {
  test.skip(
    process.env.ANONLY_NATIVE_MEMORY_OVERHEAD !== "1",
    "control opt-in: ANONLY_NATIVE_MEMORY_OVERHEAD=1",
  );
  test.setTimeout(300_000);
  test.beforeAll(async () => {
    await writeManifest();
  });

  for (const [order, conditions] of [
    ["ab", ["without-footprint", "with-footprint"]],
    ["ba", ["with-footprint", "without-footprint"]],
  ] as const) {
    for (const profile of ["p1", "p2"] as const) {
      for (const condition of conditions) {
        test(`${profile} ${order} ${condition}`, async ({
          page,
          electronApp,
          electronUserDataDir,
        }) => {
          const report = await runCondition(
            profile,
            order,
            condition,
            page,
            electronApp,
            electronUserDataDir,
          );
          expect(report.cold.ok).toBe(true);
          expect(report.hot.ok).toBe(true);
          expect(report.cold.panelVisible).toBe(true);
          expect(report.hot.panelVisible).toBe(true);
        });
      }
    }
  }
});
