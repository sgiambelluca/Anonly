/**
 * `margin-ink-campaign.spec.ts` — campaña de medición real de M-1 + M-2
 * (`docs/roadmap/Margenes_Menos_Pixeles_Handoff.md` §4).
 *
 * Separado de `margin-ink.spec.ts` (que solo tiene el caso de humo del §2.1,
 * una página, sin ciclo frío/caliente) porque este archivo reusa
 * `memoryProfile.ts#measureProfile` para tener una espera robusta a
 * `PIPELINE_READY`/`PIPELINE_FAILED` y el `extraCollectors`/`postRunCapture`
 * que el Handoff pide reutilizar — mismo patrón que
 * `imagedata-profile-campaign.spec.ts` de la fase anterior. **No es una
 * campaña de tiempo** (Handoff §0): la memoria/RSS que `measureProfile`
 * también mide no se usa ni se reporta acá; se reutiliza el mecanismo
 * únicamente por su ciclo de espera y su canal de captura.
 *
 * El ciclo frío→cerrar→caliente de `measureProfile` da, gratis, la segunda
 * corrida de P2 que el Handoff §4.3 exige para el control de determinismo:
 * frío y caliente son dos pasadas independientes de principio a fin sobre el
 * mismo archivo, así que comparar sus registros de tira es exactamente esa
 * verificación. Para los otros tres fixtures (una sola corrida requerida) se
 * reporta igual el par frío/caliente, sin exigir nada de él: es evidencia
 * extra sin costo adicional de invocación.
 *
 * Variables requeridas: `ANONLY_MARGIN_INK_ENABLED=1` (opt-in, ver
 * `margin-ink.spec.ts`), `ANONLY_MARGIN_INK_CASE` (p2|qastamp|t5rotated|
 * whitemargins), `ANONLY_MARGIN_INK_OUTPUT_DIR`.
 *
 * Comando (Handoff §4.1):
 * ```
 * VITE_E2E=1 pnpm --filter @anonly/react-client build
 * pnpm --filter @anonly/desktop-shell build
 * ANONLY_MARGIN_INK_ENABLED=1 ANONLY_MARGIN_INK_CASE=... \
 *   ANONLY_MARGIN_INK_OUTPUT_DIR=... \
 *   pnpm exec playwright test --config=playwright.perf.config.ts \
 *   tests/perf/margin-ink-campaign.spec.ts --workers=1 --retries=0
 * ```
 */
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  analyzeMarginInk,
  installMarginInkCollector,
  readMarginInkAnalysis,
  type MarginInkAnalysis,
  type MarginInkStripRecord,
} from "./support/marginInk.js";
import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import { qualityFingerprint } from "./support/t5Instrumentation.js";

// ─── Los cuatro fixtures ya congelados (Handoff §1) ────────────────────────

type MarginInkCase = "p2" | "qastamp" | "t5rotated" | "whitemargins";

interface CaseFixture {
  readonly path: string;
  readonly runTimeoutMs: number;
}

const CASE_FIXTURES: Readonly<Record<MarginInkCase, CaseFixture>> = {
  p2: {
    path: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
    runTimeoutMs: 1_800_000,
  },
  qastamp: {
    path: resolve(process.cwd(), ".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf"),
    runTimeoutMs: 180_000,
  },
  t5rotated: {
    path: resolve(process.cwd(), ".measure/fixtures/t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf"),
    runTimeoutMs: 180_000,
  },
  whitemargins: {
    path: resolve(process.cwd(), ".measure/fixtures/white-margins-848789ae0cc9e3d9.pdf"),
    runTimeoutMs: 180_000,
  },
};

function requireMarginInkEnvironment(env: NodeJS.ProcessEnv): {
  readonly caseName: MarginInkCase;
  readonly outputDir: string;
} {
  const caseName = env.ANONLY_MARGIN_INK_CASE;
  const outputDir = env.ANONLY_MARGIN_INK_OUTPUT_DIR;
  if (
    (caseName !== "p2" &&
      caseName !== "qastamp" &&
      caseName !== "t5rotated" &&
      caseName !== "whitemargins") ||
    outputDir === undefined
  ) {
    throw new Error(
      "ANONLY_MARGIN_INK_CASE (p2|qastamp|t5rotated|whitemargins) y " +
        "ANONLY_MARGIN_INK_OUTPUT_DIR son requeridas.",
    );
  }
  return { caseName, outputDir };
}

/** Mismo criterio que `imagedata-profile-campaign.spec.ts`: el directorio se
 * niega a sobreescribir un `analysis.json` ya existente — una corrida
 * inválida se conserva rotulada, nunca se pisa en silencio. */
async function assertOutputFileIsNew(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error(`El archivo de salida ya existe, no se sobrescribe: ${path}`);
    },
    () => undefined,
  );
}

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

/** Identidad de ESTA build concreta (instrumentada) — distinta del
 * `manifest.json` estático de §1, que es la referencia sin instrumento. */
async function buildManifest(caseName: MarginInkCase): Promise<Readonly<Record<string, unknown>>> {
  const root = process.cwd();
  const sourcePaths = [
    "packages/anonymization-core/ocr-engine/src/worker/kernel.ts",
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
    "apps/react-client/src/core-adapter/index.ts",
  ].map((path) => resolve(root, path));
  const buildDirectory = resolve(root, "apps/react-client/dist/assets");
  const buildPaths = (await readdir(buildDirectory)).map((file) => resolve(buildDirectory, file));
  return {
    campaign: "20260916-351fc4d3",
    case: caseName,
    sources: await hashFiles(sourcePaths),
    build: await hashFiles(buildPaths),
    dependencies: await hashFiles([resolve(root, "pnpm-lock.yaml")]),
    assetsLock: await hashFiles([resolve(root, "assets.lock.json")]),
    effectiveConfig: {
      pdfPoolSize: 4,
      ocrPoolSize: 2,
      nerPoolSize: 2,
      renderPoolSize: 4,
      nerEnabled: true,
      languages: ["spa", "eng"],
      dpi: 300,
      maxLiveImageBytes: 128 * 1024 * 1024,
    },
    capturedAt: new Date().toISOString(),
  };
}

async function toFilePayload(path: string, name: string): Promise<E2eFilePayload> {
  const buffer = await readFile(path);
  return { name, mimeType: "application/pdf", buffer };
}

const MARGIN_INK_OVERRIDES = {
  workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
} as const;

/** `undefined` cuando el lote está vacío (build limpio o corrida inválida) —
 * `analyzeMarginInk` no se llama sobre un array vacío para no reportar un
 * "0 violaciones" que no significa nada. */
function safeAnalyze(records: ReadonlyArray<MarginInkStripRecord>): MarginInkAnalysis | null {
  return records.length > 0 ? analyzeMarginInk(records) : null;
}

/** Compara dos lotes de registros IGNORANDO `documentId` (una `Word`
 * carga/importación nueva por corrida trae un UUID nuevo — Handoff §4.3: lo
 * que tiene que coincidir es el CONTENIDO, no la identidad de la carga). */
function stripDocumentId(
  records: ReadonlyArray<MarginInkStripRecord>,
): ReadonlyArray<Omit<MarginInkStripRecord, "documentId">> {
  return [...records]
    .sort((a, b) => a.pageIndex - b.pageIndex || a.strip.localeCompare(b.strip))
    .map(({ documentId: _documentId, ...rest }) => rest);
}

test.setTimeout(2_100_000);

test("campaña de tinta de márgenes — un fixture", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  const { caseName, outputDir } = requireMarginInkEnvironment(process.env);
  test.skip(
    process.env.ANONLY_MARGIN_INK_ENABLED !== "1",
    "Análisis de tinta de márgenes opt-in: use ANONLY_MARGIN_INK_ENABLED=1.",
  );
  const fixtureSpec = CASE_FIXTURES[caseName];
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "analysis.json");
  await assertOutputFileIsNew(outputPath);

  const fixtureBytes = await readFile(fixtureSpec.path);
  const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  const file = await toFilePayload(fixtureSpec.path, `${caseName}.pdf`);

  await installEngineOverrides(page, MARGIN_INK_OVERRIDES);
  await openApp(page, "networkidle");

  const captured: {
    cold: ReadonlyArray<MarginInkStripRecord>;
    hot: ReadonlyArray<MarginInkStripRecord>;
  } = {
    cold: [],
    hot: [],
  };
  const postRunCapture = async (capturePage: Page, temperature: "cold" | "hot"): Promise<void> => {
    const records = await readMarginInkAnalysis(capturePage);
    if (temperature === "cold") captured.cold = records;
    else captured.hot = records;
  };

  const report: ProfileReport = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `margin-ink-${caseName}`,
    file,
    fixtureSpec.runTimeoutMs,
    [installMarginInkCollector],
    postRunCapture,
  );

  // Una violación de invariante acá es exactamente lo que tiene que frenar
  // la campaña (Handoff §2.4): agregar igual sobre un lote inconsistente
  // sería la falla silenciosa que el Handoff advierte.
  const coldAnalysis = safeAnalyze(captured.cold);
  const hotAnalysis = safeAnalyze(captured.hot);

  const manifest = await buildManifest(caseName);
  const coldFingerprint = qualityFingerprint((report.cold.ocrWords ?? []).map((p) => p.words));
  const hotFingerprint = qualityFingerprint((report.hot.ocrWords ?? []).map((p) => p.words));

  // Handoff §4.3: determinismo cruzado frío/caliente — el contenido (sin
  // `documentId`, que es un UUID por carga) tiene que ser idéntico. Se
  // calcula para TODOS los casos (no solo P2): es evidencia gratis y una
  // discrepancia en cualquier fixture es igual de relevante.
  const coldVsHotIdentical =
    captured.cold.length > 0 &&
    captured.hot.length > 0 &&
    JSON.stringify(stripDocumentId(captured.cold)) ===
      JSON.stringify(stripDocumentId(captured.hot));

  const output = {
    manifest,
    fixture: { path: fixtureSpec.path, bytes: fixtureBytes.byteLength, sha256: fixtureSha256 },
    case: caseName,
    cold: { ok: report.cold.ok, records: captured.cold, analysis: coldAnalysis },
    hot: { ok: report.hot.ok, records: captured.hot, analysis: hotAnalysis },
    coldVsHotIdentical,
    quality: { cold: coldFingerprint, hot: hotFingerprint },
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
});
