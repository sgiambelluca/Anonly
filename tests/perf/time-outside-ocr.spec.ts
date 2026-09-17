import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { type E2eFilePayload } from "../e2e/support/fixtures.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  closeTimedDocument,
  fixtureInfo,
  hostIdentity,
  runTimedImport,
  type TimeReport,
  writeTimeReport,
} from "./support/timeProfile.js";

type Profile = "p1" | "p2";
const P2 = resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf");
const P1 = resolve(process.cwd(), ".measure/fixtures/text-10p-frozen.pdf");
const EXPECTED_OCR_SHA = "c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49";
const OVERRIDES = {
  workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
} as const;

async function fixture(
  profile: Profile,
): Promise<{ readonly path: string; readonly file: E2eFilePayload; readonly bytes: Buffer }> {
  if (profile === "p1") {
    const bytes = await readFile(P1);
    return {
      path: P1,
      file: { name: "text-10p-frozen.pdf", mimeType: "application/pdf", buffer: bytes },
      bytes,
    };
  }
  const bytes = await readFile(P2);
  return {
    path: P2,
    file: { name: "p2-scanned-50p.pdf", mimeType: "application/pdf", buffer: bytes },
    bytes,
  };
}

async function requireNew(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`No se sobrescribe evidencia: ${path}`);
}

async function measure(
  profile: Profile,
  page: Parameters<typeof runTimedImport>[0],
  runIndex: number,
): Promise<void> {
  const outputRoot = process.env.ANONLY_TIME_OUTSIDE_OCR_OUTPUT_DIR;
  if (outputRoot === undefined) throw new Error("ANONLY_TIME_OUTSIDE_OCR_OUTPUT_DIR es requerida");
  const outputPath = resolve(outputRoot, `${profile}-run${runIndex}.json`);
  await requireNew(outputPath);
  const selected = await fixture(profile);
  await installEngineOverrides(page, OVERRIDES);
  await openApp(page, "networkidle");
  const cold = await runTimedImport(
    page,
    selected.file,
    "cold",
    profile === "p2" ? 1_800_000 : 180_000,
  );
  await closeTimedDocument(page);
  const hot = await runTimedImport(
    page,
    selected.file,
    "hot",
    profile === "p2" ? 1_800_000 : 180_000,
  );
  await closeTimedDocument(page);
  const report: TimeReport = {
    profile,
    fixture: fixtureInfo(selected.path, selected.bytes),
    identity: hostIdentity(),
    cold,
    hot,
    capturedAt: new Date().toISOString(),
  };
  await writeTimeReport(report, outputPath);
  expect(cold.ok).toBe(true);
  expect(hot.ok).toBe(true);
  // OCR/NER runs expose their canonical hash for post-run comparison. The
  // equality check is reported from the raw JSON so a mismatch never gets
  // hidden behind a passing timing assertion.
  expect(cold.entityCount).toBe(hot.entityCount);
  expect(cold.groupCount).toBe(hot.groupCount);
  if (profile === "p2") {
    expect(cold.ocrFingerprint).toBe(EXPECTED_OCR_SHA);
    expect(hot.ocrFingerprint).toBe(EXPECTED_OCR_SHA);
    expect(cold.detectionFingerprint).toBe(hot.detectionFingerprint);
  } else expect(cold.qualityFingerprint).toBe(hot.qualityFingerprint);
  if (process.env.ANONLY_M2_REQUIRED === "1") {
    for (const run of [cold, hot]) {
      expect(run.m2.inferenceMs).toBeGreaterThan(0);
      expect(run.m2.groupingNerHandlersMs).toBeDefined();
    }
  }
  if (profile === "p2") {
    for (const run of [cold, hot]) {
      expect(run.intervalsMs.importedToReadyMs).not.toBeNull();
      expect(run.intervalsMs.ocrStartedToReadyMs).not.toBeNull();
      expect(run.intervalsMs.ocrMs).not.toBeNull();
      expect(run.intervalsMs.parsedToOcrStartedMs).not.toBeNull();
      expect(run.intervalsMs.ocrFinishedToReadyMs).not.toBeNull();
      expect(run.intervalsMs.importedToParsedMs).not.toBeNull();
      expect(
        Math.abs(
          run.intervalsMs.importedToReadyMs! -
            (run.intervalsMs.importedToParsedMs! +
              run.intervalsMs.parsedToOcrStartedMs! +
              run.intervalsMs.ocrMs! +
              run.intervalsMs.ocrFinishedToReadyMs!),
        ),
      ).toBeLessThanOrEqual(5);
    }
  }
}

test.setTimeout(2_100_000);
test.describe("campaña M-1 tiempo fuera de OCR (opt-in)", () => {
  test.skip(process.env.ANONLY_TIME_OUTSIDE_OCR !== "1", "campaña opt-in");
  test("P1 — control nativo, frío→caliente", async ({ page }, testInfo) => {
    await measure("p1", page, testInfo.repeatEachIndex);
  });
  test("P2 — escaneado 50 páginas, frío→caliente", async ({ page }, testInfo) => {
    await measure("p2", page, testInfo.repeatEachIndex);
  });
});
