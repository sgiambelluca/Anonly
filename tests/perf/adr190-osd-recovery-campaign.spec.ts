import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";

import {
  installDocumentControl,
  installTransportObserver,
  readDocumentRun,
} from "./support/adr190Browser.js";
import {
  DENSITIES,
  SOURCE_DPIS,
  decodeWords,
  scoreReading,
  type Cell,
  validateCampaignPage,
} from "./support/adr190Dpi.js";
import {
  generateCampaignFixtures,
  hashBytes,
  type CampaignFixture,
} from "./support/adr190Fixtures.js";
import { correlateRawOsd, OsdProbe, type RawOsd } from "./support/adr190OsdProbe.js";
import {
  correlateOcrAttempts,
  collectInstrumentFailures,
  firstOcrAttempt,
  hasExactDniToken,
  firstReadingMatchesQuality,
  rankCandidates,
  summarizeReliableWordEvidence,
  type OcrAttempt,
} from "./support/adr190Recovery.js";
import { installEngineOverrides } from "./support/engineOverrides.js";

const QUALITY_SESSION = resolve(".measure/adr190-dpi/2026-09-27T23-28-24-682Z-quality-33332");
const OUTPUT_DIR = resolve(
  ".measure/adr190-osd-recovery",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-campaign-${process.pid}`,
);
const QUALITY_KEYS = DENSITIES.flatMap((density) =>
  SOURCE_DPIS.flatMap((dpi) => [0, 90, 180, 270].map((angle) => `${density}-${dpi}-${angle}`)),
);
const CONTROL_DENSITIES = ["blank", "noise", "shapes"] as const;
const CONTROL_KEYS = CONTROL_DENSITIES.flatMap((density) =>
  SOURCE_DPIS.map((dpi) => `${density}-${dpi}-0`),
);
const FIXTURE_KEYS = [...QUALITY_KEYS, ...CONTROL_KEYS];
const ANGLES: ReadonlyArray<0 | 90 | 180 | 270 | null> = [null, 0, 90, 180, 270];
const TEST_CASES = FIXTURE_KEYS.flatMap((key) => ANGLES.map((angle) => ({ key, angle })));

interface QualityRecord {
  readonly fixture: CampaignFixture;
  readonly cell: { readonly sourceDpi: number; readonly angle: number; readonly arm: string };
  readonly capture: { readonly jobs: Array<Record<string, unknown>> };
  readonly words: unknown;
  readonly rawOsd: RawOsd[];
}

interface FixtureBaseline {
  readonly fixture: CampaignFixture;
  readonly sourceDpi: number;
  readonly expectedCorrectionAngle: number;
  readonly effectiveDpi: number;
  readonly ocrRaster: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly imageBytes: number;
  };
  readonly firstWords: unknown;
  readonly rawOsd: RawOsd;
  readonly productionOrientation: unknown;
  readonly inkRatio: unknown;
}

interface AttemptView {
  readonly jobId: string;
  readonly durationMs: number | null;
  readonly terminal: string | null;
  readonly error: unknown;
  readonly dpi: number | null;
  readonly sourceOrientation: number | null;
  readonly dispatchedOrientation: number | null;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly imageBytes: number;
  readonly imageSha256: string;
  readonly pageConfidence: number | null;
  readonly reliableWordCount: number;
  readonly words: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
  readonly quality:
    | (Omit<ReturnType<typeof scoreReading>, "dniRecovered" | "reliableMissingDni"> & {
        readonly dniTokenPresent: boolean | null;
      })
    | null;
}

interface ProbeRecord {
  readonly key: string;
  readonly group: "quality" | "control";
  readonly fixtureHash: string;
  readonly angle: number | null;
  readonly angleMode: "production-osd" | "forced";
  readonly expectedCorrectionAngle: number;
  readonly effectiveDpi: number;
  readonly expectedEffectiveDpi: number;
  readonly currentRawOsd: RawOsd;
  readonly currentProductionOrientation: unknown;
  readonly currentInkRatio: number;
  readonly finalPipelineDniEntities: ReadonlyArray<{
    readonly value: string;
    readonly pageIndex: number;
  }>;
  readonly finalWords: ReadonlyArray<{ readonly text: string; readonly confidence: number }>;
  readonly finalOcrPageEvents: ReadonlyArray<unknown>;
  readonly unreadableInkEvents: ReadonlyArray<unknown>;
  readonly totalOcrDurationMs: number;
  readonly firstQualityParity: ReturnType<typeof firstReadingMatchesQuality> | null;
  readonly inputHashMatchesQuality: boolean | null;
  readonly ocrAttempts: ReadonlyArray<AttemptView>;
  readonly triggerCandidates: {
    readonly osdNoVerdict: boolean;
    readonly inkAtProductionThreshold: boolean;
    readonly firstReadingReliableWords: number;
    readonly firstReadingWords: number;
    readonly attemptReliableWordCounts: ReadonlyArray<number>;
    readonly anyAttemptReliableWords: boolean;
    readonly maxAttemptReliableWords: number;
    readonly finalReliableWords: number;
    readonly anyFinalReliableWords: boolean;
    readonly anyAttemptOrFinalReliableWords: boolean;
  };
  readonly issues: ReadonlyArray<string>;
}

const baselines = new Map<string, FixtureBaseline>();
const fixtures = new Map<string, CampaignFixture>();
const results: ProbeRecord[] = [];

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

function toAttemptView(attempt: OcrAttempt, fixture: CampaignFixture): AttemptView {
  let words: ReturnType<typeof decodeWords> = [];
  let quality: AttemptView["quality"] = null;
  let pageConfidence: number | null = null;
  if (attempt.job.terminal === "COMPLETED") {
    words = decodeWords(attempt.job.result);
    const result = attempt.job.result as { confidence?: unknown } | null;
    pageConfidence = typeof result?.confidence === "number" ? result.confidence : null;
    const {
      dniRecovered: _dniRecovered,
      reliableMissingDni: _reliableMissingDni,
      ...tokenQuality
    } = scoreReading(fixture.expectedText, words, [], fixture.expectedDni);
    quality = {
      ...tokenQuality,
      dniTokenPresent:
        fixture.expectedDni === null ? null : hasExactDniToken(words, fixture.expectedDni),
    };
  }
  const reliableWordCount = words.filter((word) => word.confidence >= 0.6).length;
  return {
    jobId: attempt.job.jobId,
    durationMs:
      attempt.job.finishedAt === null ? null : attempt.job.finishedAt - attempt.job.startedAt,
    terminal: attempt.job.terminal,
    error: attempt.job.error,
    dpi: attempt.job.dpi,
    sourceOrientation: attempt.input.sourceOrientation,
    dispatchedOrientation: attempt.input.dispatchedOrientation,
    widthPx: attempt.input.widthPx,
    heightPx: attempt.input.heightPx,
    imageBytes: attempt.job.imageBytes,
    imageSha256: attempt.imageSha256,
    pageConfidence,
    reliableWordCount,
    words: words.map(({ text, confidence }) => ({ text, confidence })),
    quality,
  };
}

test.describe("ADR190 missing-OSD recovery campaign (actual OCR worker)", () => {
  test.skip(
    process.env.ANONLY_ADR190_OSD_RECOVERY_CAMPAIGN !== "1",
    "Explicit opt-in recovery campaign; not run by default",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const qualityManifest = JSON.parse(
      await readFile(join(QUALITY_SESSION, "manifest.json"), "utf8"),
    ) as { buildHash: string; fixtures: CampaignFixture[] };
    for (const key of QUALITY_KEYS) {
      const filename = `${key}-native-rep1.json`;
      const record = JSON.parse(
        await readFile(join(QUALITY_SESSION, filename), "utf8"),
      ) as QualityRecord;
      if (record.cell.arm !== "native" || record.fixture.key !== key)
        throw new Error(`QUALITY baseline is not native/expected fixture: ${key}`);
      const fixture = qualityManifest.fixtures.find((item) => item.key === key);
      if (!fixture || fixture.hash !== record.fixture.hash)
        throw new Error(`QUALITY fixture hash mismatch: ${key}`);
      const pdfBytes = await readFile(fixture.path);
      if (hashBytes(pdfBytes) !== fixture.hash) throw new Error(`QUALITY PDF mutated: ${key}`);
      const attempts = record.capture.jobs.filter((job) => job.jobType === "ocr-page");
      const firstAttempt = attempts.sort((a, b) => Number(a.startedAt) - Number(b.startedAt))[0];
      const orientationJob = record.capture.jobs.find((job) => job.jobType === "ocr-orient");
      const rawOsd = record.rawOsd[0];
      const page = firstAttempt?.result as { words?: unknown } | null;
      const ocrResult = orientationJob?.result as
        | { orientation?: unknown; inkRatio?: unknown }
        | undefined;
      if (
        !firstAttempt ||
        typeof firstAttempt.dpi !== "number" ||
        typeof firstAttempt.widthPx !== "number" ||
        typeof firstAttempt.heightPx !== "number" ||
        typeof firstAttempt.imageBytes !== "number" ||
        !page?.words ||
        !orientationJob ||
        !rawOsd ||
        !ocrResult ||
        typeof ocrResult.inkRatio !== "number"
      )
        throw new Error(`QUALITY campaign baseline incomplete: ${key}`);
      baselines.set(key, {
        fixture,
        sourceDpi: record.cell.sourceDpi,
        expectedCorrectionAngle: fixture.expectedCorrectionAngle,
        effectiveDpi: firstAttempt.dpi,
        ocrRaster: {
          widthPx: firstAttempt.widthPx,
          heightPx: firstAttempt.heightPx,
          imageBytes: firstAttempt.imageBytes,
        },
        firstWords: page.words,
        rawOsd,
        productionOrientation: ocrResult.orientation,
        inkRatio: ocrResult.inkRatio,
      });
      fixtures.set(key, fixture);
    }

    const controlCells: Cell[] = CONTROL_DENSITIES.flatMap((density) =>
      SOURCE_DPIS.map((sourceDpi) => ({
        sourceDpi,
        density,
        angle: 0 as const,
        arm: "native" as const,
        repetition: 1,
      })),
    );
    const generated = await generateCampaignFixtures(controlCells, join(OUTPUT_DIR, "fixtures"));
    for (const [key, fixture] of generated) fixtures.set(key, fixture);
    if (baselines.size !== 64 || generated.size !== CONTROL_KEYS.length)
      throw new Error("recovery campaign fixture count mismatch");

    const buildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(buildFiles)));
    if (buildHash !== qualityManifest.buildHash)
      throw new Error("current build differs from QUALITY; recovery campaign is not comparable");
    const manifest = {
      createdAt: new Date().toISOString(),
      phase: "recovery-angle-campaign-instrument-only",
      status: "actual OCR worker; orientation override is test-only transport interception",
      qualitySession: QUALITY_SESSION,
      buildHash,
      qualityBuildHash: qualityManifest.buildHash,
      buildMatchesQuality: true,
      qualityFixtures: [...baselines.values()].map((baseline) => ({
        key: baseline.fixture.key,
        pdfSha256: baseline.fixture.hash,
        sourceDpi: baseline.sourceDpi,
        effectiveDpi: baseline.effectiveDpi,
        sourceRaster: baseline.ocrRaster,
        qualityRawOsd: baseline.rawOsd,
      })),
      controlFixtures: [...generated.values()].map((fixture) => ({
        key: fixture.key,
        pdfSha256: fixture.hash,
      })),
      orientations: ANGLES,
      fixtureCount: fixtures.size,
      expectedReadings: 380,
      baselineRasterHashesAvailable: false,
      limitation:
        "QUALITY stores OCR raster dimensions and byte lengths but no payload hash; this campaign hashes every actual OCR request and compares cross-angle equality plus QUALITY metadata.",
      forcedPath:
        "Worker.postMessage test observer changes only ocr-page payload.orientation before the real production OCR worker receives the unchanged image buffer and DPI.",
    };
    await writeFile(join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`ADR190 OSD recovery campaign: ${OUTPUT_DIR}`);
  });

  test.afterAll(async () => {
    const imageConsistency = FIXTURE_KEYS.map((key) => {
      const rows = results.filter((result) => result.key === key);
      const hashes = rows.flatMap((row) =>
        row.ocrAttempts[0] ? [row.ocrAttempts[0].imageSha256] : [],
      );
      return {
        key,
        expectedObservations: ANGLES.length,
        completedObservations: rows.length,
        completedAngleModes: rows.map((row) => row.angle),
        identicalFirstInputHashAcrossAngles:
          hashes.length === ANGLES.length && new Set(hashes).size === 1,
        firstInputHashes: hashes,
        dpiAndRasterMetadataConsistent:
          rows.length === ANGLES.length &&
          new Set(
            rows.map(
              (row) =>
                `${row.effectiveDpi}:${row.ocrAttempts[0]?.widthPx}:${row.ocrAttempts[0]?.heightPx}:${row.ocrAttempts[0]?.imageBytes}`,
            ),
          ).size === 1,
        distinctDispatchedAngles: [
          ...new Set(rows.map((row) => row.ocrAttempts[0]?.dispatchedOrientation)),
        ],
      };
    });
    const summary = {
      phase: "recovery-angle-campaign-instrument-only",
      expectedFixtureCount: 76,
      completedFixtureCount: new Set(results.map((row) => row.key)).size,
      expectedObservations: 380,
      completedObservations: results.length,
      expectedQualityObservations: QUALITY_KEYS.length * ANGLES.length,
      completedQualityObservations: results.filter((row) => row.group === "quality").length,
      expectedControlObservations: CONTROL_KEYS.length * ANGLES.length,
      completedControlObservations: results.filter((row) => row.group === "control").length,
      instrumentFailures: [
        ...collectInstrumentFailures(results),
        ...imageConsistency
          .filter((row) => row.completedObservations !== ANGLES.length)
          .map((row) => ({
            key: row.key,
            issue: `incomplete fixture observations: ${row.completedObservations}/${ANGLES.length}`,
          })),
        ...imageConsistency
          .filter(
            (row) =>
              row.completedObservations === ANGLES.length &&
              (!row.identicalFirstInputHashAcrossAngles || !row.dpiAndRasterMetadataConsistent),
          )
          .map((row) => ({
            key: row.key,
            issue: "OCR raster hash/DPI/dimensions differ across forced-angle runs",
          })),
      ],
      qualityBaselineParity: results
        .filter((row) => row.angle === null && row.firstQualityParity)
        .map((row) => ({ key: row.key, ...row.firstQualityParity })),
      imageConsistency,
      controlFalseReliableWordObservations: results
        .filter((row) => row.group === "control")
        .map((row) => ({ key: row.key, angle: row.angle, ...row.triggerCandidates })),
      offlineRanking: FIXTURE_KEYS.map((key) => {
        const candidates = results
          .filter((row) => row.key === key)
          .flatMap((row) => {
            const first = row.ocrAttempts[0];
            if (!first || first.terminal !== "COMPLETED") return [];
            return [
              {
                mode: row.angleMode,
                requestedAngle: row.angle,
                angle: first.dispatchedOrientation,
                reliableWordCount: first.reliableWordCount,
                pageConfidence: first.pageConfidence,
              },
            ];
          });
        return {
          key,
          group: results.find((row) => row.key === key)?.group ?? "missing",
          candidateCount: candidates.length,
          current: rankCandidates(candidates, "current"),
          pageConfidenceFirst: rankCandidates(candidates, "page-confidence-first"),
        };
      }),
      qualityApproved: false,
    };
    await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(OUTPUT_DIR, "observations.json"), JSON.stringify(results, null, 2));
    expect(
      summary.instrumentFailures,
      "instrument errors and metadata mismatches must fail closed",
    ).toEqual([]);
    expect(
      results.length,
      "recovery campaign must fail closed unless all 380 observations complete",
    ).toBe(380);
    expect(
      imageConsistency.filter((row) => row.completedObservations !== ANGLES.length),
      "every fixture must have production plus four forced observations",
    ).toEqual([]);
    expect(
      imageConsistency.filter(
        (row) =>
          row.completedObservations === ANGLES.length &&
          (!row.identicalFirstInputHashAcrossAngles || !row.dpiAndRasterMetadataConsistent),
      ),
      "forced angles must retain the same OCR raster and effective DPI",
    ).toEqual([]);
  });

  for (const { key, angle } of TEST_CASES) {
    test(`${key} ${angle === null ? "production" : `forced-${angle}`}`, async ({
      page,
      electronUserDataDir,
    }) => {
      const fixture = fixtures.get(key);
      if (!fixture) throw new Error(`fixture missing: ${key}`);
      const baseline = baselines.get(key);
      const group: "quality" | "control" = baseline ? "quality" : "control";
      const sourceDpi = baseline?.sourceDpi ?? Number(key.split("-").at(-2));
      const expectedEffectiveDpi =
        baseline?.effectiveDpi ?? baselines.get(`two-lines-${sourceDpi}-0`)?.effectiveDpi;
      if (expectedEffectiveDpi === undefined)
        throw new Error(`effective DPI baseline missing for ${key}`);
      const pdfBytes = await readFile(fixture.path);
      const fixtureHash = hashBytes(pdfBytes);
      expect(fixtureHash, `${key} immutable PDF hash`).toBe(fixture.hash);
      const issues: string[] = [];
      await installTransportObserver(page, {
        retainOcrPageInputs: true,
        ...(angle === null ? {} : { forceOcrPageOrientation: angle }),
      });
      await installSettingsOverride(page, { nerEnabled: false });
      await installEngineOverrides(page, {
        ner: { enabled: false },
        ocr: { dpi: 300 },
        workerPool: { ocrPoolSize: 2, pdfPoolSize: 2, renderPoolSize: 2 },
      });
      let probe: OsdProbe | null = null;
      try {
        probe = await OsdProbe.connect(electronUserDataDir);
        await openApp(page, "networkidle");
        await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
        await installDocumentControl(page, "native");
        await page.locator('input[type="file"]').setInputFiles({
          name: `${key}.pdf`,
          mimeType: "application/pdf",
          buffer: pdfBytes,
        });
        await page.waitForFunction(
          () => globalThis.__adr190?.ready || globalThis.__adr190?.failure !== null,
          undefined,
          { timeout: 180_000 },
        );
        const run = await readDocumentRun(page);
        await probe.drain();
        if (!run.ready || run.failure !== null)
          throw new Error(`pipeline failed: ${JSON.stringify(run.failure)}`);
        if (probe.issues.length) throw new Error(probe.issues.join("; "));
        validateCampaignPage(run.capture, 0, expectedEffectiveDpi);
        const attempts = correlateOcrAttempts(run.capture);
        if (!attempts.length) throw new Error("no real OCR page dispatch captured");
        const first = firstOcrAttempt(attempts);
        if (!first) throw new Error("first OCR dispatch missing");
        if (first.job.dpi !== expectedEffectiveDpi)
          throw new Error(`first OCR DPI ${first.job.dpi} != QUALITY ${expectedEffectiveDpi}`);
        if (angle !== null && first.input.dispatchedOrientation !== angle)
          throw new Error(
            `first dispatch orientation ${first.input.dispatchedOrientation} != forced ${angle}`,
          );
        if (
          baseline &&
          (first.input.widthPx !== baseline.ocrRaster.widthPx ||
            first.input.heightPx !== baseline.ocrRaster.heightPx ||
            first.job.imageBytes !== baseline.ocrRaster.imageBytes)
        )
          throw new Error("first OCR raster dimensions/byte length differ from QUALITY baseline");
        if (
          attempts
            .slice(1)
            .some(
              (attempt) => attempt.input.dispatchedOrientation !== attempt.input.sourceOrientation,
            )
        )
          throw new Error("orientation override leaked into a later OCR retry");
        if (attempts.some((attempt) => attempt.job.dpi !== expectedEffectiveDpi))
          throw new Error("OCR retry effective DPI differs from first dispatch baseline");

        const orientationJobs = run.capture.jobs
          .filter((job) => job.jobType === "ocr-orient")
          .sort((a, b) => a.startedAt - b.startedAt);
        const rawOsdReadings = correlateRawOsd(run.capture.jobs, probe.readings);
        const orientationJob = orientationJobs[0];
        const rawOsd = rawOsdReadings.find((item) => item.hostJobId === orientationJob?.jobId);
        const orientationResult = orientationJob?.result as
          | { orientation?: unknown; inkRatio?: unknown }
          | undefined;
        if (
          !orientationJob ||
          !rawOsd ||
          !orientationResult ||
          typeof orientationResult.inkRatio !== "number"
        )
          throw new Error("production OSD metadata missing");
        const attemptsView = attempts.map((attempt) => toAttemptView(attempt, fixture));
        const firstWords = attemptsView[0]?.words ?? [];
        const reliableEvidence = summarizeReliableWordEvidence(
          attemptsView.map((attempt) => attempt.words),
          run.words,
        );
        let firstQualityParity: ReturnType<typeof firstReadingMatchesQuality> | null = null;
        if (angle === null && baseline) {
          const firstBaseline = {
            words: baseline.firstWords,
            rawOrientation: baseline.rawOsd.rawOrientation,
            rawConfidence: baseline.rawOsd.rawConfidence,
            rawError: baseline.rawOsd.error,
            inkRatio: baseline.inkRatio,
            productionOrientation: baseline.productionOrientation,
          };
          firstQualityParity = firstReadingMatchesQuality(
            {
              words:
                first.job.result && typeof first.job.result === "object"
                  ? (first.job.result as { words?: unknown }).words
                  : null,
              rawOrientation: rawOsd.rawOrientation,
              rawConfidence: rawOsd.rawConfidence,
              rawError: rawOsd.error,
              inkRatio: orientationResult.inkRatio,
              productionOrientation: orientationResult.orientation,
            },
            firstBaseline,
          );
          if (!firstQualityParity.matches)
            issues.push("production first reading differs from QUALITY baseline");
        }
        const record: ProbeRecord = {
          key,
          group,
          fixtureHash,
          angle,
          angleMode: angle === null ? "production-osd" : "forced",
          expectedCorrectionAngle: fixture.expectedCorrectionAngle,
          effectiveDpi: first.job.dpi!,
          expectedEffectiveDpi,
          currentRawOsd: rawOsd,
          currentProductionOrientation: orientationResult.orientation,
          currentInkRatio: orientationResult.inkRatio,
          finalPipelineDniEntities: run.entities
            .filter((entity) => entity.entityType === "DNI")
            .map(({ value, pageIndex }) => ({ value, pageIndex })),
          finalWords: run.words.map(({ text, confidence }) => ({ text, confidence })),
          finalOcrPageEvents: run.ocrPages,
          unreadableInkEvents: run.unreadableInkEvents,
          totalOcrDurationMs: attempts.reduce(
            (total, attempt) =>
              total +
              (attempt.job.finishedAt === null
                ? 0
                : attempt.job.finishedAt - attempt.job.startedAt),
            0,
          ),
          firstQualityParity,
          inputHashMatchesQuality: null,
          ocrAttempts: attemptsView,
          triggerCandidates: {
            osdNoVerdict: rawOsd.rawOrientation === null || rawOsd.rawConfidence === null,
            inkAtProductionThreshold: orientationResult.inkRatio >= 0.002,
            firstReadingReliableWords: reliableEvidence.firstAttemptReliableWords,
            firstReadingWords: firstWords.length,
            attemptReliableWordCounts: reliableEvidence.attemptReliableWordCounts,
            anyAttemptReliableWords: reliableEvidence.anyAttemptReliableWords,
            maxAttemptReliableWords: reliableEvidence.maxAttemptReliableWords,
            finalReliableWords: reliableEvidence.finalReliableWords,
            anyFinalReliableWords: reliableEvidence.anyFinalReliableWords,
            anyAttemptOrFinalReliableWords: reliableEvidence.anyAttemptOrFinalReliableWords,
          },
          issues,
        };
        results.push(record);
        await writeFile(
          join(OUTPUT_DIR, `${key}-${angle === null ? "production" : `forced-${angle}`}.json`),
          JSON.stringify(record, null, 2),
        );
        expect(issues, `${key} ${angle} instrumentation`).toEqual([]);
      } catch (error) {
        issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        await writeFile(
          join(
            OUTPUT_DIR,
            `${key}-${angle === null ? "production" : `forced-${angle}`}-failure.json`,
          ),
          JSON.stringify({ key, angle, fixtureHash, issues }, null, 2),
        );
        throw error;
      } finally {
        if (probe)
          await probe.close().catch((error: unknown) => issues.push(`CDP close: ${String(error)}`));
      }
    });
  }
});
