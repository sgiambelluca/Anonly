import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

const execFileAsync = promisify(execFile);
const SESSION_ID = `${new Date()
  .toISOString()
  .replaceAll(/[^0-9]/g, "")
  .slice(0, 14)}-${Math.random().toString(16).slice(2, 10)}`;
const OUT_DIR = resolve(process.cwd(), ".measure/renderer-resources", SESSION_ID);
const NATIVE_INTERVAL_MS = 1_000;
const NATIVE_REST_DURATION_MS = 120_000;

async function writeSanitizedReport(report: ProfileReport, runIndex: number): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const output = {
    profile: report.profile,
    identity: report.identity,
    capturedAt: report.capturedAt,
    nativeMemoryStartedAtMs: report.nativeMemoryStartedAtMs,
    rssSamplerStartedAtMs: report.rssSamplerStartedAtMs,
    nativeRestStartedAtMs: report.nativeRestStartedAtMs,
    nativeRestDurationMs: report.nativeRestDurationMs,
    nativeMemorySamples: report.nativeMemorySamples ?? [],
    nativeMemoryErrors: report.nativeMemoryErrors ?? [],
    runs: [report.cold, report.hot].map((run) => ({
      temperature: run.temperature,
      phases: run.phases,
      phaseSegments: run.phaseSegments.map((segment) => ({
        fromEvent: segment.fromEvent,
        toEvent: segment.toEvent,
        fromAtMs: segment.fromAtMs,
        toAtMs: segment.toAtMs,
        rssAtEntryBytes: segment.rssAtEntryBytes,
        rssAtExitBytes: segment.rssAtExitBytes,
        deltaBytes: segment.deltaBytes,
        nativeSamples: (report.nativeMemorySamples ?? []).filter((sample) => {
          if (report.rssSamplerStartedAtMs === undefined) return false;
          const fromEpoch = report.rssSamplerStartedAtMs + segment.fromAtMs;
          const toEpoch = report.rssSamplerStartedAtMs + segment.toAtMs;
          return sample.startedAtEpochMs >= fromEpoch && sample.finishedAtEpochMs <= toEpoch;
        }),
      })),
      peakSumBytes: run.peakSumBytes,
      postReadyPeakBytes: run.postReadyPeakBytes,
      baselineBytes: run.baselineBytes,
      m1Bytes: run.m1Bytes,
      peakPosition: run.peakPosition,
      ok: run.ok,
      panelVisible: run.panelVisible,
    })),
  };
  await writeFile(
    resolve(OUT_DIR, `${report.profile}-run${runIndex}.json`),
    `${JSON.stringify(output, null, 2)}\n`,
  );
}

async function writeManifest(): Promise<void> {
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"]);
  const hashFile = async (path: string): Promise<string> => {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex");
  };
  const assetDir = resolve(process.cwd(), "apps/react-client/dist/assets");
  const assetNames = (await readdir(assetDir)).sort();
  const assets = Object.fromEntries(
    await Promise.all(
      assetNames.map(async (name) => [name, await hashFile(resolve(assetDir, name))]),
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
          reactIndexSha256: await hashFile("apps/react-client/dist/index.html"),
          shellMainSha256: await hashFile("apps/desktop-shell/dist/main.js"),
          reactAssetsSha256: assets,
        },
        configuration: "default settings; native footprint interval 1000ms; post-close 120000ms",
        corpus: ["P1 synthetic textTenPagesFile", "P2 synthetic scanned fixture p2-scanned-50p"],
        clocks: { capturedAtEpochMs: Date.now(), timeOriginMs: performance.timeOrigin },
      },
      null,
      2,
    )}\n`,
  );
}

test.describe("atribución física del renderer — piloto opt-in", () => {
  test.skip(
    process.env.ANONLY_NATIVE_MEMORY_PILOT !== "1",
    "piloto opt-in: ANONLY_NATIVE_MEMORY_PILOT=1",
  );
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    await writeManifest();
  });

  test("P1 — arranque, NER, Ready, panel y cierre/reposo", async ({
    page,
    electronApp,
    electronUserDataDir,
  }, testInfo) => {
    await openApp(page, "networkidle");
    const report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      "renderer-resources-p1",
      await textTenPagesFile(),
      180_000,
      [],
      undefined,
      30,
      undefined,
      NATIVE_INTERVAL_MS,
      NATIVE_REST_DURATION_MS,
    );
    await writeSanitizedReport(report, testInfo.repeatEachIndex);
    expect(report.cold.ok).toBe(true);
    expect(report.hot.ok).toBe(true);
    expect((report.nativeMemorySamples ?? []).length).toBeGreaterThan(0);
  });

  test("P2 — OCR, NER, Ready, panel y cierre/reposo", async ({
    page,
    electronApp,
    electronUserDataDir,
  }, testInfo) => {
    const textSource = await generateText50p();
    const file = await getOrGenerateScannedFixture(
      "renderer-resources-p2-scanned-50p",
      new Uint8Array(textSource),
    );
    await openApp(page, "networkidle");
    const report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      "renderer-resources-p2",
      file,
      180_000,
      [],
      undefined,
      150,
      undefined,
      NATIVE_INTERVAL_MS,
      NATIVE_REST_DURATION_MS,
    );
    await writeSanitizedReport(report, testInfo.repeatEachIndex);
    expect(report.cold.ok).toBe(true);
    expect(report.hot.ok).toBe(true);
    expect((report.nativeMemorySamples ?? []).length).toBeGreaterThan(0);
  });
});
