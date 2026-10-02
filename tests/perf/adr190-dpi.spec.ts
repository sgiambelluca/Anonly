import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";

import {
  installDocumentControl,
  installTransportObserver,
  readDocumentRun,
} from "./support/adr190Browser.js";
import {
  campaignCells,
  classifyJobs,
  decodeVerdict,
  fixtureKey,
  hasQualityFailure,
  NORMALIZATION,
  scoreReading,
  validateCampaignPage,
} from "./support/adr190Dpi.js";
import {
  generateCampaignFixtures,
  hashBytes,
  verifyRotationPixelControl,
  type CampaignFixture,
} from "./support/adr190Fixtures.js";
import { correlateRawOsd, OsdProbe } from "./support/adr190OsdProbe.js";
import { installEngineOverrides } from "./support/engineOverrides.js";
import { startMemorySampling } from "./support/memorySampler.js";

const runCommand = promisify(execFile);
const PHASES = ["preflight", "quality", "time", "memory", "controls"] as const;
type Phase = (typeof PHASES)[number];
const requestedPhase = process.env.ANONLY_ADR190_PHASE ?? "preflight";
if (!PHASES.includes(requestedPhase as Phase))
  throw new Error(`Unknown ADR190 phase ${requestedPhase}`);
const phase = requestedPhase as Phase;
const cells = campaignCells(phase);
const qualityProbe = phase === "preflight" || phase === "quality" || phase === "controls";
const directory = resolve(
  ".measure/adr190-dpi",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${phase}-${process.pid}`,
);
let fixtures: Map<string, CampaignFixture>;
const results: Array<{
  fixture: CampaignFixture;
  cell: (typeof cells)[number];
  words: unknown;
  quality: ReturnType<typeof scoreReading>;
  instrumentError: string | null;
  [key: string]: unknown;
}> = [];

async function hashTree(
  directoryPath: string,
): Promise<Array<{ path: string; hash: string; bytes: number }>> {
  const output: Array<{ path: string; hash: string; bytes: number }> = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) output.push(...(await hashTree(path)));
    else {
      const bytes = await readFile(path);
      output.push({ path, hash: hashBytes(bytes), bytes: bytes.length });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

test.describe("ADR190 DPI campaign (instrument success does not approve OCR quality)", () => {
  test.skip(process.env.ANONLY_ADR190_DPI !== "1", "Explicit opt-in campaign");
  test.setTimeout(300_000);
  test.beforeAll(async () => {
    await mkdir(directory, { recursive: true });
    fixtures = await generateCampaignFixtures(cells, join(directory, "fixtures"));
    const rotationPixelControl = await verifyRotationPixelControl(
      join(directory, "rotation-pixel-control.json"),
    );
    const head = await runCommand("git", ["rev-parse", "HEAD"]);
    const status = await runCommand("git", ["status", "--porcelain=v1"]);
    const diff = await runCommand("git", ["diff", "HEAD", "--binary"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const untrackedListing = await runCommand("git", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    const untrackedPaths = untrackedListing.stdout
      .split("\0")
      .filter((path) => /^(packages|apps|tests|docs)\//.test(path));
    const untrackedFiles = await Promise.all(
      untrackedPaths.map(async (path) => {
        const content = await readFile(resolve(path));
        return { path, hash: hashBytes(content), bytes: content.length };
      }),
    );
    const manifest = {
      createdAt: new Date().toISOString(),
      phase,
      source: {
        head: head.stdout.trim(),
        status: status.stdout,
        trackedDiffHash: hashBytes(Buffer.from(diff.stdout)),
        untrackedPaths,
        untrackedFiles,
      },
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      buildHash: hashBytes(Buffer.from(JSON.stringify(buildFiles))),
      buildFiles,
      fixtures: [...fixtures.values()],
      rotationPixelControl,
      matrix: cells,
      normalization: NORMALIZATION,
      settings: { nerEnabled: false, ocrDpi: 300, ocrPool: 2 },
      observer: {
        transport:
          "light Worker wrapper common to both arms; only metadata and synthetic outputs retained",
        rawOsd: qualityProbe
          ? "recursive CDP auto-attach pause/install/resume; excluded from unsampled timings"
          : "not observed in this phase; join quality data by fixture hash",
        memory:
          phase === "memory"
            ? "sum app.getAppMetrics working sets in bytes; shared pages counted repeatedly; 150ms sampled; no attribution to OCR alone"
            : "none",
      },
    };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`ADR190 session: ${directory}`);
  });
  test.afterAll(async () => {
    if (!fixtures) return;
    const equivalence = results
      .filter((r) => r.cell.sourceDpi === 300 && r.cell.arm === "native")
      .map((native) => {
        const forced = results.find(
          (r) =>
            r.cell.arm === "forced300" &&
            r.fixture.hash === native.fixture.hash &&
            r.cell.repetition === native.cell.repetition,
        );
        return {
          fixture: native.fixture.key,
          repetition: native.cell.repetition,
          identicalQuality: forced
            ? JSON.stringify(native.quality) === JSON.stringify(forced.quality)
            : null,
          identicalWords: forced
            ? JSON.stringify(native.words) === JSON.stringify(forced.words)
            : null,
        };
      });
    await writeFile(
      join(directory, "summary.json"),
      JSON.stringify(
        {
          phase,
          expectedCells: cells.length,
          completedCells: results.length,
          instrumentFailures: results.filter((r) => r.instrumentError),
          qualityFailures: results
            .filter((r) => hasQualityFailure(r.quality))
            .map((r) => ({ cell: r.cell, quality: r.quality })),
          equivalence,
          qualityApproved: false,
        },
        null,
        2,
      ),
    );
    if (phase === "preflight") {
      expect(results.length).toBe(cells.length);
      expect(
        equivalence.every((pair) => pair.identicalQuality && pair.identicalWords),
        "source300 equivalence",
      ).toBe(true);
    }
  });

  for (const cell of cells) {
    test(`${fixtureKey(cell)} ${cell.arm} repetition=${cell.repetition}`, async ({
      page,
      electronApp,
      electronUserDataDir,
    }) => {
      const fixture = fixtures.get(fixtureKey(cell));
      if (!fixture) throw new Error("fixture missing");
      const bytes = await readFile(fixture.path);
      expect(hashBytes(bytes), "immutable source bytes").toBe(fixture.hash);
      await installTransportObserver(page);
      await installSettingsOverride(page, { nerEnabled: false });
      await installEngineOverrides(page, {
        ner: { enabled: false },
        ocr: { dpi: 300 },
        workerPool: { ocrPoolSize: 2, pdfPoolSize: 2, renderPoolSize: 2 },
      });
      let probe: OsdProbe | undefined;
      let sampler: ReturnType<typeof startMemorySampling> | undefined;
      let instrumentError: string | null = null;
      try {
        if (qualityProbe) probe = await OsdProbe.connect(electronUserDataDir);
        await openApp(page, "networkidle");
        await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
        await installDocumentControl(page, cell.arm);
        const runtime = await electronApp.evaluate(({ app }) => ({
          electron: process.versions.electron,
          chromium: process.versions.chrome,
          version: app.getVersion(),
        }));
        if (phase === "memory") sampler = startMemorySampling(electronApp, 150);
        const startedAt = Date.now();
        await page.locator('input[type="file"]').setInputFiles({
          name: `${fixture.key}.pdf`,
          mimeType: "application/pdf",
          buffer: bytes,
        });
        await page.waitForFunction(
          () => globalThis.__adr190?.ready || globalThis.__adr190?.failure !== null,
          undefined,
          { timeout: 240_000 },
        );
        const endedAt = Date.now();
        if (sampler) {
          await sampler.sampleOnce();
          sampler.stop();
        }
        await probe?.drain();
        const run = await readDocumentRun(page);
        const raw = probe ? correlateRawOsd(run.capture.jobs, probe.readings) : null;
        const quality = scoreReading(
          fixture.expectedText,
          run.words,
          run.entities
            .filter((entity) => entity.entityType === "DNI")
            .map((entity) => entity.value),
          fixture.expectedDni,
        );
        try {
          const expectedDpi =
            cell.arm === "forced300" || cell.density === "region"
              ? 300
              : Math.min(run.caps[0]?.originalCap ?? 300, 300);
          validateCampaignPage(run.capture, 0, expectedDpi);
          if (!run.ready || run.failure !== null)
            throw new Error(`pipeline failed ${JSON.stringify(run.failure)}`);
          if (probe?.issues.length) throw new Error(probe.issues.join("; "));
          const cap = run.caps[0]?.originalCap;
          if (cap == null && cell.density !== "region")
            throw new Error("source cap not observable");
          const recognitions = run.capture.jobs.filter((job) => job.jobType === "ocr-page");
          if (cell.density === "region") {
            if (run.regions.length !== 1)
              throw new Error("mixed fixture did not produce one real OCR region");
            const observedRegion = run.regions[0] as {
              pageIndex?: unknown;
              bbox?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
            };
            const expectedRegion = fixture.regionBbox;
            if (!expectedRegion || observedRegion.pageIndex !== 0 || !observedRegion.bbox)
              throw new Error("region page/geometry missing");
            for (const key of ["x", "y", "width", "height"] as const) {
              const value = observedRegion.bbox[key];
              if (typeof value !== "number" || Math.abs(value - expectedRegion[key]) > 1)
                throw new Error(`region geometry differs at ${key}`);
            }
            const osdJobs = run.capture.jobs.filter((job) => job.jobType === "ocr-orient");
            const expectedWidthPx = Math.ceil((expectedRegion.width * 300) / 72);
            const expectedHeightPx = Math.ceil((expectedRegion.height * 300) / 72);
            if (
              !osdJobs.length ||
              osdJobs.some(
                (job) => job.widthPx !== expectedWidthPx || job.heightPx !== expectedHeightPx,
              )
            )
              throw new Error("region OSD crop dimensions differ from fixed 300-DPI geometry");
            if (recognitions.some((job) => job.upscale !== 1))
              throw new Error("region was upscaled");
            if (
              run.ocrPages.some(
                (output) =>
                  typeof output === "object" && output !== null && "unreadableInk" in output,
              )
            )
              throw new Error("region emitted unreadableInk");
          }
        } catch (error: unknown) {
          instrumentError = String(error);
        }
        const record = {
          cell,
          fixture,
          runtime,
          ...run,
          jobs: classifyJobs(run.capture.jobs),
          rawOsd: raw,
          rawConfidenceReason: qualityProbe
            ? null
            : "not observed in time/memory phase; join quality by fixture hash",
          orientations: run.capture.jobs
            .filter((job) => job.jobType === "ocr-orient" && job.terminal === "COMPLETED")
            .map((job) => ({
              jobId: job.jobId,
              ...decodeVerdict(job.result),
              rawOsdCorrect:
                raw?.find((r) => r.hostJobId === job.jobId)?.rawOrientation == null
                  ? null
                  : raw.find((r) => r.hostJobId === job.jobId)?.rawOrientation ===
                    fixture.expectedCorrectionAngle,
            })),
          quality,
          totalMs: endedAt - startedAt,
          timingHasCdpProbe: qualityProbe,
          memory: sampler
            ? {
                samples: sampler.samples,
                sampleDurationsMs: sampler.sampleDurationsMs,
                intervalMs: 150,
                peakSumWorkingSetSizeBytes: sampler.samples.length
                  ? Math.max(...sampler.samples.map((s) => s.sumWorkingSetSizeBytes))
                  : null,
              }
            : null,
          instrumentError,
        };
        results.push(record);
        await writeFile(
          join(directory, `${fixture.key}-${cell.arm}-rep${cell.repetition}.json`),
          JSON.stringify(record, null, 2),
        );
        // Evidence outside measurement: releasing a document must recreate OCR workers.
        if (phase === "preflight" && cell.sourceDpi === 300) {
          const previousWorkers = new Set(run.capture.jobs.map((job) => job.worker));
          const beforeCount = run.capture.jobs.length;
          const closeButton = page.getByRole("button", { name: "Cerrar documento" });
          await closeButton.click();
          const confirmDialog = page.getByRole("dialog", { name: "Cerrar documento" });
          await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();
          await expect(page.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
          await page.evaluate(() => {
            const currentRun = globalThis.__adr190;
            if (!currentRun) throw new Error("missing observer");
            currentRun.ready = false;
            currentRun.failure = null;
          });
          await page.locator('input[type="file"]').setInputFiles({
            name: `${fixture.key}.pdf`,
            mimeType: "application/pdf",
            buffer: bytes,
          });
          await page.waitForFunction(
            () => globalThis.__adr190?.ready || globalThis.__adr190?.failure !== null,
            undefined,
            { timeout: 240_000 },
          );
          const reopened = await readDocumentRun(page);
          const newJobs = reopened.capture.jobs.slice(beforeCount);
          const released = run.capture.workers
            .filter((worker) => previousWorkers.has(worker.id))
            .every((worker) => worker.terminatedAt !== null);
          const recreated =
            newJobs.length > 0 && newJobs.every((job) => !previousWorkers.has(job.worker));
          const reopenRaw = probe ? correlateRawOsd(reopened.capture.jobs, probe.readings) : null;
          await writeFile(
            join(directory, `${fixture.key}-${cell.arm}-worker-recreation.json`),
            JSON.stringify(
              {
                outsideMeasurement: true,
                released,
                recreated,
                firstWorkers: [...previousWorkers],
                reopened,
                raw: reopenRaw,
              },
              null,
              2,
            ),
          );
          expect(
            released && recreated,
            "OCR workers released and recreated between documents",
          ).toBe(true);
        }
        console.log(
          JSON.stringify({
            cell,
            cap: run.caps[0]?.originalCap,
            recognitionDpis: record.jobs
              .filter((j) => j.jobType === "ocr-page")
              .map((j) => [j.dpi, j.upscale, j.orientation]),
            rawOsd: raw,
            quality,
            instrumentError,
          }),
        );
        expect(instrumentError, "instrument completeness only").toBeNull();
      } catch (error: unknown) {
        await writeFile(
          join(directory, `${fixture.key}-${cell.arm}-rep${cell.repetition}-failure.json`),
          JSON.stringify(
            {
              cell,
              fixture,
              error: String(error),
              run: await readDocumentRun(page).catch(() => null),
              raw: probe?.readings,
              probeIssues: probe?.issues,
            },
            null,
            2,
          ),
        );
        throw error;
      } finally {
        sampler?.stop();
        await probe?.close();
      }
    });
  }
});
