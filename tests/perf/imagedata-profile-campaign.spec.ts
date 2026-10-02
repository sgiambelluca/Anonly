/**
 * `imagedata-profile-campaign.spec.ts` — campaña de medición real del
 * perfilado de ImageData (`docs/roadmap/ImageData_Perfilado_Handoff.md` §4).
 *
 * Separado de `imagedata-profile.spec.ts` (que solo tiene el caso de humo
 * del §2, corrido con la aplicación abierta sin medir memoria) porque este
 * archivo reusa el ciclo frío→cerrar→caliente + muestreo RSS/heap completo
 * de `memoryProfile.ts#measureProfile` — mismo criterio de separación que
 * ya aplica entre `memory.spec.ts` y `osd-sharing.spec.ts`.
 *
 * Una invocación = una sesión (frío+caliente) de UN caso, UNA condición
 * (instrumentado|limpio) y UN par — mismo patrón que `osd-sharing.spec.ts`
 * con `requireT5Environment`. El orquestador (quien corre la campaña, no
 * este archivo) decide el orden I1/C1, C2/I2, I3/C3 invocando Playwright una
 * vez por celda, alternando el build entre invocaciones (Handoff §4.3).
 *
 * Variables requeridas (ver `requireImageDataProfileEnvironment`):
 * `ANONLY_IMAGEDATA_CASE` (p2|qastamp|t5rotated|whitemargins),
 * `ANONLY_IMAGEDATA_CONDITION` (instrumented|clean),
 * `ANONLY_IMAGEDATA_PAIR` (1..3), `ANONLY_IMAGEDATA_OUTPUT_DIR` — el
 * directorio `case-<n>/` COMPARTIDO por los pares de ese caso (Handoff §5:
 * `case-<n>/pair-<k>-<instrumented|clean>.json`); lo que se niega a
 * sobreescribir es el ARCHIVO de esa celda puntual, no el directorio.
 *
 * Comando (Handoff §4.1, repetido acá para no depender de memoria):
 * ```
 * VITE_E2E=1 pnpm --filter @anonly/react-client build
 * pnpm --filter @anonly/desktop-shell build
 * ANONLY_IMAGEDATA_PROFILE_ENABLED=1 ANONLY_IMAGEDATA_CASE=... \
 *   ANONLY_IMAGEDATA_CONDITION=... ANONLY_IMAGEDATA_PAIR=... \
 *   ANONLY_IMAGEDATA_OUTPUT_DIR=... \
 *   pnpm exec playwright test --config=playwright.perf.config.ts \
 *   tests/perf/imagedata-profile-campaign.spec.ts --workers=1 --retries=0
 * ```
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import {
  aggregateImageDataProfile,
  installImageDataProfileCollector,
  readImageDataProfile,
  type ImageDataProfilePageRecord,
} from "./support/imageDataProfile.js";
import { measureProfile, type ProfileReport } from "./support/memoryProfile.js";
import { qualityFingerprint } from "./support/t5Instrumentation.js";

// ─── Casos mínimos (Handoff §3) — fixtures YA CONGELADOS ───────────────────

type ImageDataCase = "p2" | "qastamp" | "t5rotated" | "whitemargins";
type ImageDataCondition = "instrumented" | "clean";

const CASE_NUMBER: Readonly<Record<ImageDataCase, number>> = {
  p2: 1,
  t5rotated: 2,
  qastamp: 3,
  whitemargins: 4,
};

interface CaseFixture {
  readonly path: string;
  readonly maxPair: number;
  readonly runTimeoutMs: number;
}

const CASE_FIXTURES: Readonly<Record<ImageDataCase, CaseFixture>> = {
  p2: {
    path: resolve(process.cwd(), ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"),
    maxPair: 3,
    runTimeoutMs: 1_800_000,
  },
  qastamp: {
    path: resolve(process.cwd(), ".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf"),
    maxPair: 3,
    runTimeoutMs: 180_000,
  },
  t5rotated: {
    path: resolve(process.cwd(), ".measure/fixtures/t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf"),
    maxPair: 1,
    runTimeoutMs: 180_000,
  },
  whitemargins: {
    path: resolve(process.cwd(), ".measure/fixtures/white-margins-848789ae0cc9e3d9.pdf"),
    maxPair: 1,
    runTimeoutMs: 180_000,
  },
};

function requireImageDataProfileEnvironment(env: NodeJS.ProcessEnv): {
  readonly caseName: ImageDataCase;
  readonly condition: ImageDataCondition;
  readonly pair: number;
  readonly outputDir: string;
} {
  const caseName = env.ANONLY_IMAGEDATA_CASE;
  const condition = env.ANONLY_IMAGEDATA_CONDITION;
  const pair = Number(env.ANONLY_IMAGEDATA_PAIR);
  const outputDir = env.ANONLY_IMAGEDATA_OUTPUT_DIR;
  if (
    (caseName !== "p2" &&
      caseName !== "qastamp" &&
      caseName !== "t5rotated" &&
      caseName !== "whitemargins") ||
    (condition !== "instrumented" && condition !== "clean") ||
    !Number.isInteger(pair) ||
    pair < 1 ||
    pair > 3 ||
    outputDir === undefined
  ) {
    throw new Error(
      "ANONLY_IMAGEDATA_CASE (p2|qastamp|t5rotated|whitemargins), " +
        "ANONLY_IMAGEDATA_CONDITION (instrumented|clean), ANONLY_IMAGEDATA_PAIR (1..3) " +
        "y ANONLY_IMAGEDATA_OUTPUT_DIR son requeridas.",
    );
  }
  return { caseName, condition, pair, outputDir };
}

/**
 * Handoff §5: la salida es `case-<n>/pair-<k>-<instrumented|clean>.json` —
 * el directorio `case-<n>` es compartido por los pares de un mismo caso
 * (hasta 3 archivos adentro), así que lo que tiene que negarse a
 * sobreescribir es el ARCHIVO de esa celda puntual, no el directorio entero
 * (a diferencia de `t5Instrumentation.ts#createUniqueOutputDir`, donde cada
 * `pair-N/<condición>/` era exclusivo de una sola corrida).
 */
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

/** Identidad de ESTA build concreta (instrumentada o limpia) — distinta del `manifest.json` estático de §1, que es la referencia sin instrumento. */
async function buildManifest(
  caseName: ImageDataCase,
  condition: ImageDataCondition,
  pair: number,
): Promise<Readonly<Record<string, unknown>>> {
  const root = process.cwd();
  const sourcePaths = [
    "packages/anonymization-core/ocr-engine/src/worker/kernel.ts",
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
    "apps/react-client/src/core-adapter/index.ts",
  ].map((path) => resolve(root, path));
  const buildDirectory = resolve(root, "apps/react-client/dist/assets");
  const buildPaths = (await readdir(buildDirectory)).map((file) => resolve(buildDirectory, file));
  return {
    campaign: "20260915-351fc4d3",
    case: caseName,
    caseNumber: CASE_NUMBER[caseName],
    condition,
    pair,
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

const IMAGE_DATA_PROFILE_OVERRIDES = {
  workerPool: { pdfPoolSize: 4, ocrPoolSize: 2, nerPoolSize: 2, renderPoolSize: 4 },
} as const;

test.setTimeout(2_100_000);

test("campaña de perfilado de ImageData — una celda caso/condición/par", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  const { caseName, condition, pair, outputDir } = requireImageDataProfileEnvironment(process.env);
  test.skip(
    process.env.ANONLY_IMAGEDATA_PROFILE_ENABLED !== "1",
    "Perfilado de ImageData opt-in: use ANONLY_IMAGEDATA_PROFILE_ENABLED=1.",
  );
  const fixtureSpec = CASE_FIXTURES[caseName];
  if (pair > fixtureSpec.maxPair) {
    throw new Error(
      `Caso "${caseName}" solo tiene ${fixtureSpec.maxPair} par(es) autorizado(s) (Handoff §4.3); pedido: ${pair}.`,
    );
  }
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `pair-${pair}-${condition}.json`);
  await assertOutputFileIsNew(outputPath);

  const fixtureBytes = await readFile(fixtureSpec.path);
  const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  const file = await toFilePayload(fixtureSpec.path, `${caseName}.pdf`);

  await installEngineOverrides(page, IMAGE_DATA_PROFILE_OVERRIDES);
  await openApp(page, "networkidle");

  const captured: {
    cold: ReadonlyArray<ImageDataProfilePageRecord>;
    hot: ReadonlyArray<ImageDataProfilePageRecord>;
  } = {
    cold: [],
    hot: [],
  };
  const postRunCapture = async (capturePage: Page, temperature: "cold" | "hot"): Promise<void> => {
    const records = await readImageDataProfile(capturePage);
    if (temperature === "cold") captured.cold = records;
    else captured.hot = records;
  };

  const report: ProfileReport = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    `imagedata-${caseName}-${condition}-pair${pair}`,
    file,
    fixtureSpec.runTimeoutMs,
    [installImageDataProfileCollector],
    postRunCapture,
  );

  // La agregación es orientativa cuando `condition === "clean"` (sin
  // instrumento, `captured.*` está vacío por construcción — ver
  // `installImageDataProfileCollector`, nunca lanza sobre un array vacío).
  // Cuando SÍ hay instrumento, una violación de invariante acá es exactamente
  // lo que tiene que frenar la campaña (Handoff §5).
  const coldAggregate = captured.cold.length > 0 ? aggregateImageDataProfile(captured.cold) : null;
  const hotAggregate = captured.hot.length > 0 ? aggregateImageDataProfile(captured.hot) : null;

  const manifest = await buildManifest(caseName, condition, pair);

  const coldFingerprint = qualityFingerprint((report.cold.ocrWords ?? []).map((p) => p.words));
  const hotFingerprint = qualityFingerprint((report.hot.ocrWords ?? []).map((p) => p.words));

  const output = {
    manifest,
    fixture: { path: fixtureSpec.path, bytes: fixtureBytes.byteLength, sha256: fixtureSha256 },
    case: caseName,
    condition,
    pair,
    cold: { report: report.cold, imageDataProfile: captured.cold, aggregate: coldAggregate },
    hot: { report: report.hot, imageDataProfile: captured.hot, aggregate: hotAggregate },
    quality: { cold: coldFingerprint, hot: hotFingerprint },
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
});
