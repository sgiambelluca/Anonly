/**
 * Medición A/B real de I-1. Cada invocación produce una sesión fría→caliente
 * para un fixture; el script de campaña externo encadena B1/A1, A2/B2, B3/A3
 * y preserva cada salida sin sobrescribirla.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  installMarginPassCountCollector,
  readMarginPassCountTotal,
} from "./support/marginPassCount.js";
import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import { qualityFingerprint } from "./support/t5Instrumentation.js";

type CampaignCase = "p2" | "qastamp";

const FIXTURES: Readonly<Record<CampaignCase, string>> = {
  p2: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
  qastamp: resolve(process.cwd(), ".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf"),
};

function requiredEnv(): { readonly caseName: CampaignCase; readonly outputDir: string } {
  const caseName = process.env.ANONLY_MARGIN_I1_CASE;
  const outputDir = process.env.ANONLY_MARGIN_I1_OUTPUT_DIR;
  if ((caseName !== "p2" && caseName !== "qastamp") || outputDir === undefined) {
    throw new Error(
      "ANONLY_MARGIN_I1_CASE (p2|qastamp) y ANONLY_MARGIN_I1_OUTPUT_DIR son requeridas.",
    );
  }
  return { caseName, outputDir };
}

async function requireNew(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error(`No se sobrescribe evidencia existente: ${path}`);
    },
    () => undefined,
  );
}

async function filePayload(path: string, name: string): Promise<E2eFilePayload> {
  return { name, mimeType: "application/pdf", buffer: await readFile(path) };
}

const OVERRIDES = {
  workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
} as const;

test.setTimeout(2_100_000);

test("I-1 A/B — una sesión fría y caliente con conteo y huella", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  test.skip(process.env.ANONLY_MARGIN_I1_ENABLED !== "1", "campaña I-1 opt-in");
  const { caseName, outputDir } = requiredEnv();
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "session.json");
  await requireNew(outputPath);
  const fixturePath = FIXTURES[caseName];
  const fixture = await filePayload(fixturePath, `${caseName}.pdf`);
  const bytes = await readFile(fixturePath);
  const fixtureSha256 = createHash("sha256").update(bytes).digest("hex");

  await installEngineOverrides(page, OVERRIDES);
  await openApp(page, "networkidle");
  const passCounts: { cold: number; hot: number } = { cold: -1, hot: -1 };
  const capture = async (capturePage: Page, temperature: "cold" | "hot"): Promise<void> => {
    passCounts[temperature] = await readMarginPassCountTotal(capturePage);
  };
  const report: ProfileReport = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `margin-i1-${caseName}`,
    fixture,
    caseName === "p2" ? 1_800_000 : 180_000,
    [installMarginPassCountCollector],
    capture,
  );
  const quality = {
    cold: qualityFingerprint((report.cold.ocrWords ?? []).map((entry) => entry.words)),
    hot: qualityFingerprint((report.hot.ocrWords ?? []).map((entry) => entry.words)),
  };
  const output = {
    case: caseName,
    fixture: { path: fixturePath, bytes: bytes.byteLength, sha256: fixtureSha256 },
    passCounts,
    ocrDurationMs: {
      cold: report.cold.ocrDurationMs ?? null,
      hot: report.hot.ocrDurationMs ?? null,
    },
    totalMs: { cold: report.cold.totalMs, hot: report.hot.totalMs },
    quality,
    pipeline: { cold: report.cold.ok, hot: report.hot.ok },
    capturedAt: new Date().toISOString(),
  } as const;
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  expect(report.cold.ok).toBe(true);
  expect(report.hot.ok).toBe(true);
  expect(passCounts.cold).toBeGreaterThanOrEqual(0);
  expect(passCounts.hot).toBeGreaterThanOrEqual(0);
});
