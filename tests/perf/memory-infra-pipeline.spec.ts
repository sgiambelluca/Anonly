import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { CDPSession, ElectronApplication, Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile, type E2eFilePayload } from "../e2e/support/fixtures.js";
import { generateText50p } from "../fixtures/generate.js";

import {
  correlateMemoryInfra,
  parseMemoryInfraEvents,
  startMemoryInfraProbe,
  type MemoryInfraProbe,
  type MemoryInfraRequestWindow,
  type MemoryInfraTransport,
} from "./support/memoryInfra.js";
import {
  closeDocument,
  installRunCollector,
  readRun,
  waitForHotBaselineToSettle,
} from "./support/memoryProfile.js";
import { startMemorySampling, type MemorySample } from "./support/memorySampler.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import { readSystemMemoryPressure } from "./support/systemMemoryPressure.js";

const execFileAsync = promisify(execFile);
const SESSION = `${new Date().toISOString().replace(/[^0-9]/g, "")}-${process.pid}`;
const DIRECTORY = resolve(".measure/memory-infra-pipeline", SESSION);
const CONDITIONS = ["off", "trace", "dumps"] as const;
type Condition = (typeof CONDITIONS)[number];
type Profile = "p1" | "p2";
const files = new Map<Profile, E2eFilePayload>();
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function transportFor(cdp: CDPSession): MemoryInfraTransport {
  return {
    send: async (method, params) => {
      switch (method) {
        case "Tracing.start":
          return cdp.send("Tracing.start", params);
        case "Tracing.end":
          return cdp.send("Tracing.end");
        case "Tracing.requestMemoryDump":
          return cdp.send("Tracing.requestMemoryDump", params);
        case "Performance.getMetrics":
          return cdp.send("Performance.getMetrics");
        case "Tracing.recordClockSyncMarker": {
          const syncId = params?.syncId;
          if (typeof syncId !== "string") throw new Error("syncId missing");
          return cdp.send("Tracing.recordClockSyncMarker", { syncId });
        }
        default:
          throw new Error(`Unsupported probe command: ${method}`);
      }
    },
    on: (event, listener) => {
      if (event === "Tracing.dataCollected") cdp.on("Tracing.dataCollected", listener);
      if (event === "Tracing.tracingComplete") cdp.on("Tracing.tracingComplete", listener);
    },
    off: (event, listener) => {
      if (event === "Tracing.dataCollected") cdp.off("Tracing.dataCollected", listener);
      if (event === "Tracing.tracingComplete") cdp.off("Tracing.tracingComplete", listener);
    },
  };
}

function currentPhase(phases: Readonly<Record<string, number>>): string {
  if (phases.PIPELINE_READY !== undefined) return "ready";
  if (phases.PIPELINE_FAILED !== undefined) return "failed";
  if (phases.NER_FINISHED !== undefined) return "grouping";
  if (phases.NER_MODEL_READY !== undefined) return "ner-inference";
  if (phases.NER_MODEL_LOADING !== undefined) return "ner-load";
  if (phases.OCR_FINISHED !== undefined) return "post-ocr";
  if (phases.OCR_STARTED !== undefined) return "ocr";
  if (phases.DOCUMENT_IMPORTED !== undefined) return "pdf";
  return "pre-import";
}

interface Observation {
  readonly label: string;
  readonly startEpochMs: number;
  readonly endEpochMs: number;
  readonly request: MemoryInfraRequestWindow;
}

function peak(samples: ReadonlyArray<MemorySample>): number | null {
  return samples.length === 0 ? null : Math.max(...samples.map((s) => s.sumWorkingSetSizeBytes));
}

async function measure(
  page: Page,
  app: ElectronApplication,
  profile: Profile,
  condition: Condition,
  name: string,
  rest: boolean,
): Promise<void> {
  const file = files.get(profile);
  if (file === undefined) throw new Error("Missing prepared fixture");
  const directory = resolve(DIRECTORY, name);
  await mkdir(directory, { recursive: true });
  await openApp(page, "networkidle");
  const cdp = await page.context().newCDPSession(page);
  let probe: MemoryInfraProbe | undefined;
  const rss = startMemorySampling(app, 150);
  const observations: Observation[] = [];
  const errors: Array<{ label: string; startEpochMs: number; endEpochMs: number; reason: string }> =
    [];
  let blockedDump = false;
  const runs: unknown[] = [];
  const pressureStart = await readSystemMemoryPressure();
  const versions = await app.evaluate(() => process.versions);
  const pids = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type })),
  );
  const tab = pids.find((p) => p.type === "Tab");
  if (tab === undefined) {
    rss.stop();
    await cdp.detach();
    throw new Error("Renderer absent");
  }
  const rendererPid = tab.pid;
  async function observe(label: string): Promise<void> {
    if (condition !== "dumps" || probe === undefined) return;
    const startEpochMs = Date.now();
    if (blockedDump) {
      errors.push({
        label,
        startEpochMs,
        endEpochMs: Date.now(),
        reason: "previous-dump-unavailable; no additional in-flight request",
      });
      return;
    }
    try {
      const request = await probe.requestDump(label, rendererPid);
      observations.push({ label, startEpochMs, endEpochMs: Date.now(), request });
    } catch (error) {
      blockedDump = true;
      errors.push({ label, startEpochMs, endEpochMs: Date.now(), reason: String(error) });
    }
  }
  try {
    await cdp.send("Performance.enable");
    if (condition !== "off")
      probe = await startMemoryInfraProbe(transportFor(cdp), {
        commandTimeoutMs: 3000,
        maxEvents: 30_000,
        maxTraceBytes: 120_000_000,
      });
    await observe("base");
    for (const temperature of rest ? ["cold", "hot"] : ["cold"]) {
      const settled =
        temperature === "hot"
          ? await waitForHotBaselineToSettle(page, rss, rss.samples.at(-1)?.atMs ?? 0)
          : null;
      await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
      await installRunCollector(page, { captureOcrWords: false });
      await page.evaluate(() => {
        const core = globalThis.__anonlyCore;
        if (core === undefined) throw new Error("Core unavailable");
        for (const event of ["NER_STARTED", "NER_MODEL_LOADING"] as const) {
          core.bus.on("ner", event, () => {
            const run = globalThis.__anonlyMemoryRun;
            if (run !== undefined && run.phases[event] === undefined) {
              run.phases[event] = performance.now();
              run.phasesEpochMs[event] = Date.now();
            }
          });
        }
      });
      const baseline = await rss.sampleOnce();
      const startEpochMs = Date.now();
      await page.locator('input[type="file"]').setInputFiles(file);
      const seen = new Map<string, number>();
      const deadline = Date.now() + 180_000;
      for (;;) {
        const run = await readRun(page);
        const phase = currentPhase(run.phasesEpochMs);
        if (phase === "ready" || phase === "failed") break;
        // At most two detailed dumps per phase. Same polling in all arms.
        if ((seen.get(phase) ?? 0) < 2) {
          await observe(`${temperature}:${phase}`);
          seen.set(phase, (seen.get(phase) ?? 0) + 1);
        }
        if (Date.now() > deadline) throw new Error("Pipeline timeout");
        await page.waitForTimeout(250);
      }
      const run = await readRun(page);
      expect(run.failedAt).toBeUndefined();
      await page.getByRole("button", { name: "Cerrar documento" }).waitFor({ state: "visible" });
      const panelEpochMs = Date.now();
      await observe(`${temperature}:ready-panel`);
      await page.waitForTimeout(600);
      await rss.sampleOnce();
      const ready = run.phasesEpochMs.PIPELINE_READY;
      const imported = run.phasesEpochMs.DOCUMENT_IMPORTED;
      if (ready === undefined || imported === undefined)
        throw new Error("Phase boundaries missing");
      const phaseSamples = rss.samples.filter((s) => {
        const epoch = rss.startedAtMs + s.atMs;
        return epoch >= imported && epoch <= ready;
      });
      const postSamples = rss.samples.filter((s) => rss.startedAtMs + s.atMs > ready);
      const pipelinePeak = peak(phaseSamples);
      runs.push({
        temperature,
        startEpochMs,
        phasesEpochMs: run.phasesEpochMs,
        panelEpochMs,
        totalMs: ready - imported,
        baselineBytes: baseline.sumWorkingSetSizeBytes,
        hotBaselineSettled: settled?.settled ?? null,
        m2Bytes: pipelinePeak,
        postReadyPeakBytes: peak(postSamples),
        m1LowerBoundBytes:
          temperature === "hot" && pipelinePeak !== null
            ? pipelinePeak - (settled?.baselineBytes ?? baseline.sumWorkingSetSizeBytes)
            : null,
        groupCount: run.groupCount,
        entityCount: run.entityCount,
        workerPeakByType: run.workerPeakByType,
        observationPhases: observations
          .filter((o) => o.label.startsWith(`${temperature}:`))
          .map((o) => ({
            ...o,
            phaseAtStart: currentPhase(
              Object.fromEntries(
                Object.entries(run.phasesEpochMs).filter(([, t]) => t <= o.startEpochMs),
              ),
            ),
            phaseAtEnd: currentPhase(
              Object.fromEntries(
                Object.entries(run.phasesEpochMs).filter(([, t]) => t <= o.endEpochMs),
              ),
            ),
          })),
      });
      await closeDocument(page);
      if (rest && temperature === "hot") {
        const closeEpochMs = Date.now();
        for (const seconds of [0, 15, 60, 120]) {
          const remaining = closeEpochMs + seconds * 1000 - Date.now();
          if (remaining > 0) await page.waitForTimeout(remaining);
          if (seconds >= 15) blockedDump = false;
          await observe(`closed:${seconds}s`);
          await rss.sampleOnce();
        }
        runs.push({ kind: "rest", closeEpochMs, finalEpochMs: Date.now() });
      }
    }
    await probe?.stop();
    const events = probe?.events ?? [];
    const fragments = parseMemoryInfraEvents(events);
    const classified = pids
      .filter((p) => p.type === "Tab" || p.type === "GPU")
      .flatMap((p) =>
        correlateMemoryInfra(
          fragments,
          observations.map((o) => ({ ...o.request, pid: p.pid })),
          events,
        ).map((fragment) => ({ ...fragment, processType: p.type })),
      );
    await writeFile(resolve(directory, "trace.json"), JSON.stringify(events));
    await writeFile(resolve(directory, "categories.json"), JSON.stringify(classified));
    await writeFile(
      resolve(directory, "report.json"),
      JSON.stringify(
        {
          name,
          profile,
          condition,
          rest,
          versions,
          pids,
          runs,
          observations,
          errors,
          fixtureHash: hash(file.buffer),
          rssStartedAtMs: rss.startedAtMs,
          rssSamples: rss.samples,
          pressureStart,
          pressureEnd: await readSystemMemoryPressure(),
          truncated: probe?.truncated ?? false,
          rawMemoryFragmentCount: fragments.length,
          configuration: {
            defaults: true,
            forcedGC: false,
            footprint: false,
            heapSampler: false,
            pollMs: 250,
            rssMs: 150,
          },
        },
        null,
        2,
      ),
    );
    // A busy provider is evidence of unavailability, not a zero-memory result.
    // The pipeline must still finish, and at least the base dump must be present.
    expect(probe?.truncated ?? false).toBe(false);
    if (condition === "dumps") expect(classified.length).toBeGreaterThan(0);
  } finally {
    rss.stop();
    try {
      await probe?.stop();
    } finally {
      await cdp.detach();
    }
  }
}

test.describe("MemoryInfra pipeline — opt-in", () => {
  test.skip(process.env.ANONLY_MEMORY_INFRA_PIPELINE !== "1", "ANONLY_MEMORY_INFRA_PIPELINE=1");
  test.setTimeout(360_000);
  test.beforeAll(async () => {
    files.set("p1", await textTenPagesFile());
    files.set(
      "p2",
      await getOrGenerateScannedFixture("memory-infra-p2", new Uint8Array(await generateText50p())),
    );
    const assetDir = resolve("apps/react-client/dist/assets");
    const assets = await readdir(assetDir);
    const hashes = Object.fromEntries(
      await Promise.all(
        assets.map(async (name) => [name, hash(await readFile(resolve(assetDir, name)))]),
      ),
    );
    await mkdir(DIRECTORY, { recursive: true });
    const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"]);
    await writeFile(
      resolve(DIRECTORY, "manifest.json"),
      JSON.stringify(
        {
          session: SESSION,
          commit: commit.trim(),
          dirty: status.trim().length > 0,
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          cpu: os.cpus()[0]?.model,
          totalMemory: os.totalmem(),
          build: { assets: hashes, main: hash(await readFile("apps/desktop-shell/dist/main.js")) },
          instrument: hash(await readFile("tests/perf/support/memoryInfra.ts")),
          experiment: hash(await readFile("tests/perf/memory-infra-pipeline.spec.ts")),
        },
        null,
        2,
      ),
    );
  });
  for (const profile of ["p1", "p2"] as const) {
    for (const [order, conditions] of [
      ["abc", CONDITIONS],
      ["cba", [...CONDITIONS].reverse()],
    ] as const) {
      for (const condition of conditions) {
        test(`${profile}-${order}-${condition}`, async ({ page, electronApp }) => {
          await measure(
            page,
            electronApp,
            profile,
            condition,
            `${profile}-${order}-${condition}`,
            false,
          );
        });
      }
    }
    test(`${profile}-retention`, async ({ page, electronApp }) => {
      await measure(page, electronApp, profile, "dumps", `${profile}-retention`, true);
    });
  }
});
