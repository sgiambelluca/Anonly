import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";

import {
  installDocumentControl,
  installTransportObserver,
  readDocumentRun,
} from "./support/adr190Browser.js";
import { hashBytes, type CampaignFixture } from "./support/adr190Fixtures.js";
import { correlateRawOsd, OsdProbe, type RawOsd } from "./support/adr190OsdProbe.js";
import {
  discoverTesseractBrowserBundle,
  OSD_INK_THRESHOLD,
  OSD_SCALES,
  runOsdScaleArms,
  type CapturedOsdInput,
  type OsdScaleLabel,
  type OsdScaleRun,
  type TesseractBrowserBundle,
} from "./support/adr190OsdScale.js";
import { installEngineOverrides } from "./support/engineOverrides.js";

const QUALITY_SESSION = resolve(".measure/adr190-dpi/2026-09-27T23-28-24-682Z-quality-33332");
const OUTPUT_DIR = resolve(
  ".measure/adr190-osd-scale",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-preflight-${process.pid}`,
);
const FIXTURE_KEYS = [
  "two-lines-150-0",
  "two-lines-150-180",
  "two-lines-300-0",
  "two-lines-300-180",
] as const;
const SCALE_ORDERS: ReadonlyArray<ReadonlyArray<OsdScaleLabel>> = [
  ["historical-half", "current-1754", "native"],
  ["current-1754", "native", "historical-half"],
  ["native", "historical-half", "current-1754"],
  ["historical-half", "native", "current-1754"],
];

interface QualityManifest {
  readonly buildHash: string;
  readonly fixtures: ReadonlyArray<CampaignFixture>;
}
interface PreflightCase {
  readonly key: (typeof FIXTURE_KEYS)[number];
  readonly fixture: CampaignFixture;
  readonly expectedCorrectionAngle: number;
  readonly baseline: {
    readonly rawOsd: RawOsd;
    readonly currentInkRatio: number;
    readonly currentOrientation: number;
    readonly inputWidthPx: number;
    readonly inputHeightPx: number;
    readonly inputImageBytes: number;
  };
}
interface PreflightResult {
  readonly key: string;
  readonly fixtureHash: string;
  readonly input: Omit<CapturedOsdInput, "bytesBase64"> & { readonly sourceBytesSha256: string };
  readonly currentApp: {
    readonly rawOsd: RawOsd;
    readonly orientation: number;
    readonly inkRatio: number;
    readonly baselineMatch: boolean;
  };
  readonly scales: ReadonlyArray<OsdScaleRun>;
  readonly expectedCorrectionAngle: number;
  readonly baselineMatch: boolean;
  readonly pixelEquivalence: ReadonlyArray<{
    readonly arms: ReadonlyArray<string>;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly pixelSha256: string;
  }>;
  readonly issues: ReadonlyArray<string>;
}

const cases: PreflightCase[] = [];
const results: PreflightResult[] = [];
let bundle: TesseractBrowserBundle;

async function hashTree(
  directoryPath: string,
): Promise<Array<{ path: string; hash: string; bytes: number }>> {
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

function baselineName(key: string): string {
  return `${key}-native-rep1.json`;
}

test.describe("ADR190 OSD scale preflight (test-only Tesseract browser runtime)", () => {
  test.skip(process.env.ANONLY_ADR190_OSD_SCALE !== "1", "Explicit opt-in OSD scale preflight");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const quality = JSON.parse(
      await readFile(join(QUALITY_SESSION, "manifest.json"), "utf8"),
    ) as QualityManifest;
    const qualityBuildFiles = [
      ...(await hashTree(resolve("apps/react-client/dist"))),
      ...(await hashTree(resolve("apps/desktop-shell/dist"))),
    ];
    const buildHash = hashBytes(Buffer.from(JSON.stringify(qualityBuildFiles)));
    bundle = await discoverTesseractBrowserBundle();
    for (const key of FIXTURE_KEYS) {
      const fixture = quality.fixtures.find((item) => item.key === key);
      if (!fixture) throw new Error(`quality fixture missing: ${key}`);
      const pdf = await readFile(fixture.path);
      if (hashBytes(pdf) !== fixture.hash) throw new Error(`quality PDF hash mismatch: ${key}`);
      const record = JSON.parse(
        await readFile(join(QUALITY_SESSION, baselineName(key)), "utf8"),
      ) as {
        fixture: CampaignFixture;
        cell: { arm: string; sourceDpi: number; angle: number };
        capture: { jobs: Array<Record<string, unknown>> };
        rawOsd: RawOsd[];
      };
      if (record.fixture.hash !== fixture.hash || record.cell.arm !== "native")
        throw new Error(`quality baseline fixture/arm mismatch: ${key}`);
      const orientation = record.capture.jobs.find((job) => job.jobType === "ocr-orient");
      const rawOsd = record.rawOsd?.[0];
      const currentResult = orientation?.result as
        | { orientation?: number; inkRatio?: number }
        | undefined;
      if (!orientation || !rawOsd || typeof currentResult?.inkRatio !== "number")
        throw new Error(`quality OSD baseline incomplete: ${key}`);
      cases.push({
        key,
        fixture,
        expectedCorrectionAngle: fixture.expectedCorrectionAngle,
        baseline: {
          rawOsd,
          currentInkRatio: currentResult.inkRatio,
          currentOrientation: currentResult.orientation ?? 0,
          inputWidthPx: Number(orientation.widthPx),
          inputHeightPx: Number(orientation.heightPx),
          inputImageBytes: Number(orientation.imageBytes),
        },
      });
    }
    const manifest = {
      createdAt: new Date().toISOString(),
      phase: "preflight-only",
      qualitySession: QUALITY_SESSION,
      buildHash,
      qualityBuildHash: quality.buildHash,
      buildMatchesQuality: buildHash === quality.buildHash,
      tesseractBrowserBundle: bundle,
      fixtureHashes: cases.map(({ key, fixture }) => ({ key, hash: fixture.hash })),
      baseline: "native OCR cap records from the four matching QUALITY fixtures",
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      arms: OSD_SCALES,
      inkThreshold: OSD_INK_THRESHOLD,
      tesseract: {
        api: "production browser bundle imported by orientation-kernel",
        language: "osd",
        oem: "OEM.TESSERACT_ONLY",
        legacyCore: true,
        assets: [
          "/models/tesseract/osd.traineddata.gz",
          "/wasm/tesseract/worker.min.js",
          "/wasm/tesseract/tesseract-core*.wasm.js",
        ],
      },
      sampling:
        "one detect per arm/fixture; detectMs excludes createWorker initialization and image preparation",
    };
    await writeFile(join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`ADR190 OSD scale session: ${OUTPUT_DIR}`);
    if (buildHash !== quality.buildHash)
      throw new Error("current build hash differs from QUALITY; preflight is not comparable");
  });

  test.afterAll(async () => {
    const summary = {
      phase: "preflight-only",
      expectedFixtures: cases.length,
      completedFixtures: results.length,
      expectedCells: cases.length * 3,
      completedCells: results.reduce((sum, result) => sum + result.scales.length, 0),
      instrumentFailures: results.flatMap((result) =>
        result.issues.map((issue) => ({ key: result.key, issue })),
      ),
      baselineMismatches: results
        .filter((result) => !result.baselineMatch)
        .map((result) => result.key),
      rawNoVerdictCurrentApp: results.filter(
        (result) => result.currentApp.rawOsd.rawOrientation === null,
      ).length,
      qualityApproved: false,
    };
    await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  });

  for (let index = 0; index < FIXTURE_KEYS.length; index++) {
    const key = FIXTURE_KEYS[index];
    if (key === undefined) throw new Error(`fixture key missing at ${index}`);
    test(key, async ({ page, electronUserDataDir }) => {
      const selected = cases.find((item) => item.key === key);
      if (!selected) throw new Error(`preflight case missing: ${key}`);
      const fixtureBytes = await readFile(selected.fixture.path);
      const fixtureHash = hashBytes(fixtureBytes);
      expect(fixtureHash, "QUALITY PDF hash").toBe(selected.fixture.hash);

      await installTransportObserver(page, { retainOrientationInputs: true });
      await installSettingsOverride(page, { nerEnabled: false });
      await installEngineOverrides(page, {
        ner: { enabled: false },
        ocr: { dpi: 300 },
        workerPool: { ocrPoolSize: 2, pdfPoolSize: 2, renderPoolSize: 2 },
      });
      let probe: OsdProbe | null = null;
      const issues: string[] = [];
      let rawActual: RawOsd | null = null;
      let currentOrientation = 0;
      let currentInkRatio = 1;
      let observedInput: CapturedOsdInput | null = null;
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
        const actualReadings = correlateRawOsd(run.capture.jobs, probe.readings);
        if (actualReadings.length !== 1) throw new Error(`expected one raw OSD reading for ${key}`);
        rawActual = actualReadings[0] ?? null;
        const actualJob = run.capture.jobs.find((job) => job.jobType === "ocr-orient");
        const actualResult = actualJob?.result as {
          orientation?: number;
          inkRatio?: number;
        } | null;
        if (!actualJob || !actualResult || typeof actualResult.inkRatio !== "number")
          throw new Error(`current app OSD result missing: ${key}`);
        currentOrientation = actualResult.orientation ?? 0;
        currentInkRatio = actualResult.inkRatio;
        observedInput =
          run.capture.orientationInputs?.find((input) => input.jobId === actualJob.jobId) ?? null;
        if (!observedInput) throw new Error(`source image capture missing: ${key}`);
        if (
          observedInput.widthPx !== selected.baseline.inputWidthPx ||
          observedInput.heightPx !== selected.baseline.inputHeightPx ||
          Buffer.from(observedInput.bytesBase64, "base64").byteLength !==
            selected.baseline.inputImageBytes
        )
          throw new Error(`actual OSD source image dimensions/length differ from QUALITY: ${key}`);
      } catch (error) {
        issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      } finally {
        if (probe)
          await probe.close().catch((error: unknown) => issues.push(`CDP close: ${String(error)}`));
      }

      if (!observedInput || !rawActual) {
        const failed = {
          key,
          fixtureHash,
          currentApp: {
            rawOsd: rawActual,
            orientation: currentOrientation,
            inkRatio: currentInkRatio,
          },
          scales: [],
          expectedCorrectionAngle: selected.expectedCorrectionAngle,
          baselineMatch: false,
          pixelEquivalence: [],
          issues,
        };
        await writeFile(join(OUTPUT_DIR, `${key}.json`), JSON.stringify(failed, null, 2));
        throw new Error(issues.join("; ") || `captured input missing for ${key}`);
      }

      const order = SCALE_ORDERS[index];
      if (!order) throw new Error(`scale order missing for ${key}`);
      let scales: ReadonlyArray<OsdScaleRun> = [];
      try {
        scales = await runOsdScaleArms(
          page,
          observedInput,
          bundle,
          selected.expectedCorrectionAngle,
          order,
        );
      } catch (error) {
        issues.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      }
      const currentScale = scales.find((item) => item.arm === OSD_SCALES.current1754.label);
      const currentAppMatchesBaseline =
        rawActual.rawOrientation === selected.baseline.rawOsd.rawOrientation &&
        rawActual.rawConfidence === selected.baseline.rawOsd.rawConfidence &&
        currentOrientation === selected.baseline.currentOrientation &&
        currentInkRatio === selected.baseline.currentInkRatio;
      const currentScaleMatchesBaseline =
        currentScale?.rawOrientation === selected.baseline.rawOsd.rawOrientation &&
        currentScale.rawConfidence === selected.baseline.rawOsd.rawConfidence &&
        currentScale.inkRatio === selected.baseline.currentInkRatio;
      const equivalenceGroups = new Map<string, OsdScaleRun[]>();
      for (const scale of scales) {
        if (!scale.pixelSha256) continue;
        const group = equivalenceGroups.get(scale.pixelSha256) ?? [];
        group.push(scale);
        equivalenceGroups.set(scale.pixelSha256, group);
      }
      const record: PreflightResult = {
        key,
        fixtureHash,
        input: {
          jobId: observedInput.jobId,
          documentId: observedInput.documentId,
          pageIndex: observedInput.pageIndex,
          widthPx: observedInput.widthPx,
          heightPx: observedInput.heightPx,
          format: observedInput.format,
          sourceBytesSha256: hashBytes(Buffer.from(observedInput.bytesBase64, "base64")),
        },
        currentApp: {
          rawOsd: rawActual,
          orientation: currentOrientation,
          inkRatio: currentInkRatio,
          baselineMatch: currentAppMatchesBaseline,
        },
        scales,
        expectedCorrectionAngle: selected.expectedCorrectionAngle,
        baselineMatch: currentAppMatchesBaseline && currentScaleMatchesBaseline,
        pixelEquivalence: [...equivalenceGroups.entries()]
          .filter(([, group]) => group.length > 1)
          .map(([pixelSha256, group]) => ({
            arms: group.map((item) => item.arm),
            widthPx: group[0]?.widthPx ?? 0,
            heightPx: group[0]?.heightPx ?? 0,
            pixelSha256,
          })),
        issues,
      };
      results.push(record);
      await writeFile(join(OUTPUT_DIR, `${key}.json`), JSON.stringify(record, null, 2));

      expect(issues, "instrument errors").toEqual([]);
      expect(rawActual.rawOrientation, "current raw orientation vs QUALITY").toBe(
        selected.baseline.rawOsd.rawOrientation,
      );
      expect(rawActual.rawConfidence, "current raw confidence vs QUALITY").toBe(
        selected.baseline.rawOsd.rawConfidence,
      );
      expect(currentOrientation, "sanitized app orientation vs QUALITY").toBe(
        selected.baseline.currentOrientation,
      );
      expect(currentInkRatio, "app inkRatio vs QUALITY").toBe(selected.baseline.currentInkRatio);
      expect(currentScaleMatchesBaseline, "replayed current-1754 OSD vs QUALITY").toBe(true);
      expect(scales, "all three arms recorded").toHaveLength(3);
      for (const scale of scales) {
        expect(scale.error, `${key} ${scale.arm}`).toBeNull();
        expect(scale.inkPresent, `${key} ${scale.arm} ink threshold`).toBe(
          scale.inkRatio === null ? null : scale.inkRatio >= OSD_INK_THRESHOLD,
        );
      }
    });
  }
});
