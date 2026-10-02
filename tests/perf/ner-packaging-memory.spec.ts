import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { generateText50p } from "../fixtures/generate.js";

import { measureProfile } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import { readSystemMemoryPressure } from "./support/systemMemoryPressure.js";
import { runWasmAttribution, type WasmAttributionReport } from "./support/wasmMemory.js";

const IDLE_DISPOSE_MS = 15_000;
const READY_HOLD_MS = 5_000;
const POST_CLOSE_OBSERVE_MS = IDLE_DISPOSE_MS + 5_000;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} es obligatorio.`);
  return value;
}

function point(report: WasmAttributionReport, event: string): number {
  const found = report.instantPoints.find((entry) => entry.event === event);
  if (found === undefined) throw new Error(`No se registró el evento ${event}.`);
  return (report.rssSamplerStartedAtMs ?? 0) + found.atMs;
}

function nearest<T>(values: ReadonlyArray<T>, at: (value: T) => number, target: number): T | null {
  let found: T | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const nextDistance = Math.abs(at(value) - target);
    if (nextDistance < distance) {
      found = value;
      distance = nextDistance;
    }
  }
  return found;
}

test("ADR-179 — medición NER P2 por brazo", async ({ page, electronApp, electronUserDataDir }) => {
  test.skip(
    process.env.ANONLY_NER_PACKAGING_MEASURE_RUN === undefined,
    "experimento opt-in; ejecutar tests/perf/run-ner-packaging.sh",
  );
  test.setTimeout(15 * 60_000);
  const arm = requiredEnvironment("ANONLY_NER_PACKAGING_ARM");
  if (arm !== "A" && arm !== "B") throw new Error(`Brazo inválido: ${arm}.`);
  const runId = requiredEnvironment("ANONLY_NER_PACKAGING_MEASURE_RUN");
  const outputDir = resolve(requiredEnvironment("ANONLY_NER_PACKAGING_OUTPUT_DIR"));
  const realR1Available =
    process.env.ANONLY_REAL_DOC_R1 !== undefined && existsSync(process.env.ANONLY_REAL_DOC_R1);
  if (realR1Available) {
    throw new Error("R1 está disponible pero este runner solo implementa el perfil P2.");
  }
  const file = await getOrGenerateScannedFixture(
    "p2-scanned-50p",
    new Uint8Array(await generateText50p()),
  );
  await openApp(page, "networkidle");
  const pressureAtStart = await readSystemMemoryPressure();
  const report = await runWasmAttribution(
    page,
    electronApp,
    electronUserDataDir,
    runId,
    "p2-scanned-50p",
    file,
    180_000,
    READY_HOLD_MS,
    POST_CLOSE_OBSERVE_MS,
  );
  const profileReport = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `${runId}-hot-m1`,
    file,
    180_000,
    [],
    undefined,
    150,
    { captureOcrWords: false },
  );
  const pressureAtEnd = await readSystemMemoryPressure();
  expect(report.ok, `${runId}: PIPELINE_FAILED`).toBe(true);
  expect(profileReport.cold.ok, `${runId}: corrida fría del perfil falló`).toBe(true);
  expect(profileReport.hot.ok, `${runId}: corrida caliente del perfil falló`).toBe(true);
  expect(profileReport.hot.m1Bytes, `${runId}: M1 caliente no observable`).not.toBeNull();

  const assetLines = (await readFile(resolve(outputDir, `assets-served-${arm}.sha256`), "utf8"))
    .trim()
    .split("\n");
  const servedNerAssets = assetLines.map((line) => {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error(`Formato inválido en assets-served-${arm}.sha256.`);
    }
    return { sha256: match[1], path: match[2] };
  });
  const assetDirectoryDigest = (
    await readFile(resolve(outputDir, `digest-${arm}.txt`), "utf8")
  ).trim();

  const loadingAt = point(report, "NER_MODEL_LOADING");
  const modelReadyAt = point(report, "NER_MODEL_READY");
  const readyAt = point(report, "PIPELINE_READY");
  const rss = report.rssSamples;
  const peak = rss.reduce((max, sample) => Math.max(max, sample.sumWorkingSetSizeBytes), 0);
  const postReadyPeak = rss
    .filter((sample) => {
      const epochMs = (report.rssSamplerStartedAtMs ?? 0) + sample.atMs;
      return epochMs >= readyAt && epochMs <= readyAt + READY_HOLD_MS;
    })
    .reduce((max, sample) => Math.max(max, sample.sumWorkingSetSizeBytes), 0);
  const sustainedLoadedAt = readyAt + READY_HOLD_MS;
  const sustainedRss = nearest(
    rss,
    (sample) => (report.rssSamplerStartedAtMs ?? 0) + sample.atMs,
    sustainedLoadedAt,
  );
  const sustainedWasmHeap = nearest(
    report.wasmSamples,
    (sample) => (report.wasmSamplerStartedAtMs ?? 0) + sample.atMs,
    sustainedLoadedAt,
  );
  const result = {
    schema: "anonly-adr173-memory-v1",
    arm,
    runId,
    profile: "P2 scanned 50 pages",
    assetIdentity: { assetDirectoryDigest, servedNerAssets },
    instrument: {
      rssIntervalMs: 150,
      wasmHeapIntervalMs: 1_000,
      probeDurationsMs: report.probeDurationsMs,
      postReadyHoldMs: READY_HOLD_MS,
      postCloseObserveMs: POST_CLOSE_OBSERVE_MS,
      cdpWasmAndHeapCombinedSamples: true,
      ocrWordsCaptured: false,
      realR1Available,
    },
    pressure: { start: pressureAtStart, end: pressureAtEnd },
    timing: {
      nerModelLoadingToReadyMs: modelReadyAt - loadingAt,
      importToReadyMs: report.totalMs,
      modelReadyToPipelineReadyMs: readyAt - modelReadyAt,
    },
    rss: {
      preImportControl: report.preImportRssSample,
      peakDuringImportAndReadyHoldBytes: peak,
      coldPeakDeltaFromPreImportBytes:
        peak - (report.preImportRssSample?.sumWorkingSetSizeBytes ?? peak),
      postReadyPeakBytes: postReadyPeak,
      sustainedLoadedAtMsAfterReady: READY_HOLD_MS,
      sustainedLoadedRss: sustainedRss,
      afterIdleDispose: report.postIdleDisposeRssSamples,
      afterIdleDisposeLatest: report.postIdleDisposeRssSamples?.at(-1) ?? null,
      rawSamples: rss,
    },
    wasmHeap: {
      preImportControl: report.preImportWasmSample,
      rawSamplesDuringImport: report.wasmSamples,
      sustainedLoaded: sustainedWasmHeap,
      afterIdleDispose: report.postIdleDisposeWasmSamples,
      afterIdleDisposeLatest: report.postIdleDisposeWasmSamples?.at(-1) ?? null,
      targetCoverageAndReadErrorsAreInSamples: true,
    },
    attribution: report,
    officialMemoryProfile: profileReport,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    resolve(outputDir, `memory-${runId}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
});
