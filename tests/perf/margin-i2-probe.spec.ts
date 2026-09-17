/** Medición opt-in de I-2 sobre Electron real; el patch del kernel es descartable. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import { measureProfile } from "./support/memoryProfile.js";
import { qualityFingerprint } from "./support/t5Instrumentation.js";

type Case = "p2" | "qastamp" | "t5rotated" | "whitemargins";
type Temperature = "cold" | "hot";

interface Metric {
  readonly stripX0: number;
  readonly stripWidth: number;
  readonly stripHeight: number;
  readonly residualY0: number | null;
  readonly residualY1: number | null;
  readonly cropY0: number;
  readonly cropY1: number;
  readonly recognizeMs: number;
}

declare global {
  var __anonlyMarginI2Probe: unknown[] | undefined;
}

const FIXTURES: Readonly<Record<Case, string>> = {
  p2: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
  qastamp: resolve(process.cwd(), ".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf"),
  t5rotated: resolve(
    process.cwd(),
    ".measure/fixtures/t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf",
  ),
  whitemargins: resolve(process.cwd(), ".measure/fixtures/white-margins-848789ae0cc9e3d9.pdf"),
};

async function installCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente");
    const coreWithOcr = core as typeof core & {
      readonly engines: {
        readonly ocr: {
          readonly ctx?: {
            readonly cache?: { readonly get: <T>(key: string) => T | undefined };
          };
        };
      };
    };
    const ocr = coreWithOcr.engines.ocr;
    const collected: unknown[] = [];
    globalThis.__anonlyMarginI2Probe = collected;
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const pageRecord = payload as { documentId?: unknown; pageIndex?: unknown };
      if (typeof pageRecord.documentId !== "string" || typeof pageRecord.pageIndex !== "number")
        return;
      const key = `margin-i2:${pageRecord.documentId}:${pageRecord.pageIndex}`;
      const value = ocr.ctx?.cache?.get<unknown>(key);
      if (value === undefined) throw new Error(`Falta instrumento I-2: ${key}`);
      collected.push({ pageIndex: pageRecord.pageIndex, metrics: value });
    });
  });
}

async function readCollector(page: Page): Promise<unknown[]> {
  return page.evaluate(() => globalThis.__anonlyMarginI2Probe ?? []);
}

function parseMetric(value: unknown): Metric {
  if (typeof value !== "object" || value === null) throw new Error("Métrica I-2 inválida");
  const metric = value as Partial<Metric>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (
    !finite(metric.stripX0) ||
    !finite(metric.stripWidth) ||
    !finite(metric.stripHeight) ||
    !finite(metric.cropY0) ||
    !finite(metric.cropY1) ||
    !finite(metric.recognizeMs) ||
    (metric.residualY0 !== null && !finite(metric.residualY0)) ||
    (metric.residualY1 !== null && !finite(metric.residualY1))
  ) {
    throw new Error("Campos de métrica I-2 inválidos");
  }
  if (
    metric.stripWidth <= 0 ||
    metric.stripHeight <= 0 ||
    metric.cropY0 < 0 ||
    metric.cropY1 > metric.stripHeight ||
    metric.cropY0 >= metric.cropY1 ||
    metric.recognizeMs < 0
  )
    throw new Error("Geometría I-2 inválida");
  return metric as Metric;
}

function parseCollected(value: ReadonlyArray<unknown>): ReadonlyArray<{
  readonly pageIndex: number;
  readonly metrics: ReadonlyArray<Metric>;
}> {
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("Página I-2 inválida");
    const record = entry as { pageIndex?: unknown; metrics?: unknown };
    if (typeof record.pageIndex !== "number" || !Array.isArray(record.metrics)) {
      throw new Error("Registro de página I-2 inválido");
    }
    return { pageIndex: record.pageIndex, metrics: record.metrics.map(parseMetric) };
  });
}

test.setTimeout(2_100_000);

test("I-2 — geometría, calidad y tiempo por variante", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  test.skip(process.env.ANONLY_MARGIN_I2_ENABLED !== "1", "campaña I-2 opt-in");
  const caseName = process.env.ANONLY_MARGIN_I2_CASE;
  const outputDir = process.env.ANONLY_MARGIN_I2_OUTPUT_DIR;
  const condition = process.env.ANONLY_MARGIN_I2_CONDITION;
  if (
    (caseName !== "p2" &&
      caseName !== "qastamp" &&
      caseName !== "t5rotated" &&
      caseName !== "whitemargins") ||
    outputDir === undefined ||
    condition === undefined
  ) {
    throw new Error("ANONLY_MARGIN_I2_CASE, OUTPUT_DIR y CONDITION requeridas");
  }
  const outputPath = resolve(outputDir, "session.json");
  await mkdir(outputDir, { recursive: true });
  await access(outputPath).then(
    () => {
      throw new Error(`Salida ya existe: ${outputPath}`);
    },
    () => undefined,
  );

  const fixturePath = FIXTURES[caseName];
  const bytes = await readFile(fixturePath);
  const fixture: E2eFilePayload = {
    name: `${caseName}.pdf`,
    mimeType: "application/pdf",
    buffer: bytes,
  };
  const captured: Record<Temperature, unknown[]> = { cold: [], hot: [] };
  await installEngineOverrides(page, {
    workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
  });
  await openApp(page, "networkidle");
  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `margin-i2-${caseName}`,
    fixture,
    caseName === "p2" ? 1_800_000 : 180_000,
    [installCollector],
    async (capturePage, temperature) => {
      captured[temperature] = await readCollector(capturePage);
    },
  );
  const pages = {
    cold: parseCollected(captured.cold),
    hot: parseCollected(captured.hot),
  };
  const words = {
    cold: (report.cold.ocrWords ?? []).map((entry) => entry.words),
    hot: (report.hot.ocrWords ?? []).map((entry) => entry.words),
  };
  const output = {
    case: caseName,
    condition,
    fixture: {
      path: fixturePath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    pages,
    quality: { cold: qualityFingerprint(words.cold), hot: qualityFingerprint(words.hot) },
    rotatedWords:
      caseName === "qastamp"
        ? {
            cold: words.cold.flat().filter((word) => word.bbox.rotation !== undefined),
            hot: words.hot.flat().filter((word) => word.bbox.rotation !== undefined),
          }
        : undefined,
    ocrDurationMs: {
      cold: report.cold.ocrDurationMs ?? null,
      hot: report.hot.ocrDurationMs ?? null,
    },
    pipeline: { cold: report.cold.ok, hot: report.hot.ok },
    capturedAt: new Date().toISOString(),
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  expect(report.cold.ok).toBe(true);
  expect(report.hot.ok).toBe(true);
  expect(pages.cold.length).toBe(output.quality.cold.pages);
  expect(pages.hot.length).toBe(output.quality.hot.pages);
});
