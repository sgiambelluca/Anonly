import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import { measureProfile, printReport } from "./support/memoryProfile.js";
import {
  classifyTopology,
  createUniqueOutputDir,
  qualityFingerprint,
  requireT5Environment,
} from "./support/t5Instrumentation.js";

async function hashFiles(paths: ReadonlyArray<string>): Promise<Readonly<Record<string, string>>> {
  const entries = await Promise.all(
    paths.map(async (path) => {
      try {
        const bytes = await readFile(path);
        return [path, createHash("sha256").update(bytes).digest("hex")] as const;
      } catch {
        return [path, "missing"] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

async function identityManifest(
  stage: "AB" | "BC",
  condition: "A" | "B" | "C",
  factoryChunks: string,
): Promise<Readonly<Record<string, unknown>>> {
  const root = process.cwd();
  const sourcePaths = [
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
    "packages/anonymization-core/ocr-engine/src/worker/kernel.ts",
    "packages/anonymization-core/ocr-engine/src/worker/orientation-kernel.ts",
    "packages/anonymization-core/ocr-engine/src/worker/orientation-entry.ts",
    "apps/react-client/src/core-adapter/index.ts",
  ].map((path) => resolve(root, path));
  const instrumentPaths = [
    "tests/perf/osd-sharing.spec.ts",
    "tests/perf/support/t5Instrumentation.ts",
    "tests/perf/support/cdpHeap.ts",
    "tests/perf/support/memoryProfile.ts",
  ].map((path) => resolve(root, path));
  const buildDirectory = resolve(root, "apps/react-client/dist/assets");
  const buildPaths = (await readdir(buildDirectory)).map((file) => resolve(buildDirectory, file));
  return {
    sources: await hashFiles(sourcePaths),
    build: await hashFiles(buildPaths),
    instrument: await hashFiles(instrumentPaths),
    dependencies: await hashFiles([resolve(root, "pnpm-lock.yaml")]),
    assetsLock: await hashFiles([resolve(root, "assets.lock.json")]),
    effectiveConfig: {
      pdfPoolSize: 4,
      ocrPoolSize: 2,
      ocrConsumers: "A=2;B=3;C=3",
      nerPoolSize: 2,
      renderPoolSize: 4,
      nerEnabled: true,
      languages: ["spa", "eng"],
      dpi: 300,
      maxLiveImageBytes: 128 * 1024 * 1024,
    },
    campaign: {
      stage,
      condition,
      imageData: condition === "C" ? "native-stable-copy" : "historical-structural",
    },
    factoryChunks: JSON.parse(factoryChunks) as unknown,
  };
}

test.setTimeout(2_100_000);

test("T5 OSD shared profile", async ({ page, electronApp, electronUserDataDir }) => {
  test.skip(
    process.env.ANONLY_T5_ENABLED !== "1",
    "T-5 es un experimento opt-in; use ANONLY_T5_ENABLED=1 con los demás parámetros.",
  );
  const run = requireT5Environment(process.env);
  await createUniqueOutputDir(run.outputDir);
  const fixture = await readFile(resolve(run.fixture));
  const fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
  const file = { name: "p2-frozen.pdf", mimeType: "application/pdf", buffer: fixture };

  await installEngineOverrides(page, {
    workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
  });
  await openApp(page, "networkidle");

  const report = await measureProfile(page, electronApp, electronUserDataDir, "t5-p2", file);
  printReport(report);
  const targets = [...report.cold.heapSamples, ...report.hot.heapSamples]
    .flatMap((sample) => sample.targets)
    .filter(
      (target, index, all) =>
        all.findIndex((candidate) => candidate.sessionId === target.sessionId) === index,
    );
  const output = resolve(run.outputDir, `pair-${run.pair}-${run.condition}.json`);
  await writeFile(
    output,
    JSON.stringify(
      {
        fixture: { path: resolve(run.fixture), bytes: fixture.byteLength, sha256: fixtureSha256 },
        manifest: await identityManifest(run.stage, run.condition, run.factoryChunks),
        stage: run.stage,
        condition: run.condition,
        pair: run.pair,
        identity: report.identity,
        cold: report.cold,
        hot: report.hot,
        topology: {
          cold: classifyTopology(report.cold.workerEvents, targets),
          hot: classifyTopology(report.hot.workerEvents, targets),
          cdpTargets: targets,
        },
        quality: {
          cold: qualityFingerprint((report.cold.ocrWords ?? []).map((page) => page.words)),
          hot: qualityFingerprint((report.hot.ocrWords ?? []).map((page) => page.words)),
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  expect(report.cold.ok, "cold OCR run failed").toBe(true);
  expect(report.hot.ok, "hot OCR run failed").toBe(true);
  expect(report.cold.workerPeakByType["ocr-page"]).toBe(2);
  expect(report.hot.workerPeakByType["ocr-page"]).toBe(2);
});
