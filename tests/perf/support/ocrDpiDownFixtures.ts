/**
 * Preparación de los corpus de la campaña de DPI descendente. Los sintéticos se rasterizan a 300 dpi
 * en un Chromium separado que se cierra antes de medir (`scannedFixtureCache.ts`) y se cachean; la
 * clave distingue corpus, tamaño de letra, degradación y escala. Los reales entran solo por
 * `ANONLY_REAL_DOC_*` y se leen en memoria: ni la ruta ni el nombre llegan a ninguna salida.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";

import {
  NATIVE_DPI,
  buildPageSource,
  isRealCorpus,
  type CorpusId,
  type CorpusTruth,
  type RealCorpusId,
  type SyntheticCorpusId,
  type SyntheticSource,
} from "./ocrDpiDownCorpus.js";
import { buildSrSource } from "./ocrDpiDownSr.js";
import { getOrGenerateScannedFixture, type ScannedFixtureOptions } from "./scannedFixtureCache.js";

export interface PreparedCorpus {
  readonly id: CorpusId;
  readonly kind: "synthetic" | "real";
  readonly file: E2eFilePayload;
  readonly sha256: string;
  readonly truth: CorpusTruth | null;
}

export const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export async function buildSyntheticSource(id: SyntheticCorpusId): Promise<SyntheticSource> {
  return id === "SR" ? buildSrSource() : buildPageSource(id);
}

/** Opciones de rasterizado de un corpus: 300 dpi, y giros o degradación si el corpus los lleva. */
export function rasterizeOptions(truth: CorpusTruth): ScannedFixtureOptions {
  return {
    scale: NATIVE_DPI / 72,
    ...(truth.rotations === null ? {} : { rotations: truth.rotations }),
    ...(truth.degradation === null ? {} : { degradation: truth.degradation }),
  };
}

export function fixtureCacheKey(truth: CorpusTruth): string {
  const degradation =
    truth.degradation === null ? "" : `-${truth.degradation.recipe}-s${truth.degradation.seed}`;
  const rotations = truth.rotations === null ? "" : `-rot${truth.rotations.join("_")}`;
  return `ocr-dpi-down-${truth.corpus.toLowerCase()}-fs${truth.fontSize}${degradation}${rotations}-${NATIVE_DPI}dpi`;
}

export async function prepareSynthetic(id: SyntheticCorpusId): Promise<PreparedCorpus> {
  const source = await buildSyntheticSource(id);
  const raster = await getOrGenerateScannedFixture(
    fixtureCacheKey(source.truth),
    source.bytes,
    rasterizeOptions(source.truth),
  );
  const buffer = Buffer.from(raster.buffer);
  return {
    id,
    kind: "synthetic",
    file: { name: `${id.toLowerCase()}.pdf`, mimeType: "application/pdf", buffer },
    sha256: sha256Of(buffer),
    truth: source.truth,
  };
}

export function realCorpusEnvVar(id: RealCorpusId): string {
  return `ANONLY_REAL_DOC_${id}`;
}

/** Ruta del real desde el entorno, o `null` si no está definido (el corpus se saltea y queda dicho). */
export function realCorpusPath(id: RealCorpusId, env: NodeJS.ProcessEnv): string | null {
  const value = env[realCorpusEnvVar(id)];
  return value === undefined || value === "" ? null : value;
}

export async function prepareReal(id: RealCorpusId, path: string): Promise<PreparedCorpus> {
  const buffer = await readFile(path);
  return {
    id,
    kind: "real",
    file: { name: `${id.toLowerCase()}.pdf`, mimeType: "application/pdf", buffer },
    sha256: sha256Of(buffer),
    truth: null,
  };
}

export async function prepareCorpus(
  id: CorpusId,
  env: NodeJS.ProcessEnv,
): Promise<PreparedCorpus | { readonly skipped: string }> {
  if (!isRealCorpus(id)) return prepareSynthetic(id);
  const path = realCorpusPath(id, env);
  if (path === null) return { skipped: `${realCorpusEnvVar(id)} no definido` };
  try {
    return await prepareReal(id, path);
  } catch {
    // El mensaje del sistema de archivos incluye la ruta: no se propaga.
    return { skipped: `${realCorpusEnvVar(id)} definido pero ilegible` };
  }
}
