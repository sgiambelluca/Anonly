/**
 * Calcula la `BaselineIdentity` (ADR-147 §1/§6) de la corrida actual del
 * dataset de referencia. Único consumidor: `generate-candidate.ts`. Separado
 * de ese script porque es la parte con I/O propio (lee `assets.lock.json`,
 * el dataset de referencia y `git rev-parse HEAD`) y conviene poder
 * testearla aislada de la transformación de la medición.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readAssetsLock } from "../../../scripts/mirror-assets.js";

import type { BaselineIdentity, BaselineRuntime } from "./schema.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../");
const REFERENCE_DIR = resolve(HERE, "../../fixtures/reference/");
const ASSETS_LOCK_PATH = resolve(REPO_ROOT, "assets.lock.json");

/**
 * Config efectiva de `tests/measure/baseline.spec.ts`: ese harness NO llama
 * `initCore` con overrides — usa el bootstrap de la app tal cual arranca en
 * `apps/react-client` (`store/settings.store.ts`, `DEFAULT_SETTINGS`). Este
 * objeto documenta esos defaults; es informativo (el comparador no exige que
 * coincida, ver `compare.ts`), así que un desvío acá no rompe el gate — pero
 * si `baseline.spec.ts` alguna vez pasa overrides explícitos, esta constante
 * queda desactualizada y hay que actualizarla en el mismo cambio.
 */
export const MEASURE_DEFAULT_EFFECTIVE_CONFIG = {
  performancePreset: "auto",
  ner: { enabled: true },
  ocr: { languages: ["spa", "eng"] },
} as const;

/**
 * Hash del corpus (ADR-147 §1: "hash del corpus... o al menos el manifest").
 * Acá entra `manifest.json` + el contenido crudo de cada `*.truth.json` que
 * referencia, en el orden del manifest — es lo que define qué se espera
 * encontrar y en qué documento. Deliberadamente NO incluye los bytes de los
 * PDFs: son binarios grandes que no cambian sin que cambie también su
 * `*.truth.json` en la práctica (el dataset se genera junto), y hashearlos
 * encarecería cada corrida sin ganar nada que el manifest+truths no capturen
 * ya. Si algún día un PDF cambia sin que su truth cambie, este hash no lo
 * detecta — limitación documentada, no un descuido.
 */
export async function computeCorpusHash(): Promise<string> {
  const manifestPath = resolve(REFERENCE_DIR, "manifest.json");
  const manifestRaw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw) as { documents: ReadonlyArray<{ truth: string }> };

  const hash = createHash("sha256");
  hash.update(manifestRaw);
  for (const entry of manifest.documents) {
    const truthRaw = await readFile(resolve(REFERENCE_DIR, entry.truth), "utf-8");
    hash.update(truthRaw);
  }
  return hash.digest("hex");
}

/**
 * Hash del modelo (ADR-147 §1: "hash del modelo/lock de assets"). Combina el
 * `sha256` de TODAS las entradas `ner-model-*` de `assets.lock.json`
 * (pesos ONNX + tokenizer + vocab + configs) — no solo los pesos: un cambio
 * en el tokenizer sin cambiar los pesos también cambia qué detecta el
 * modelo. Orden estable (`id` ordenado) para que el hash sea determinista
 * sin importar el orden del lock.
 */
export async function computeModelHash(): Promise<string> {
  const lock = await readAssetsLock(ASSETS_LOCK_PATH);
  const modelEntries = [...lock.assets]
    .filter((entry) => entry.id.startsWith("ner-model"))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (modelEntries.length === 0) {
    throw new Error(`No se encontraron entradas "ner-model-*" en ${ASSETS_LOCK_PATH}.`);
  }

  const hash = createHash("sha256");
  for (const entry of modelEntries) hash.update(`${entry.id}:${entry.sha256}`);
  return hash.digest("hex");
}

/**
 * Id legible del modelo: `"ner-model@<revision>"`, tomado de la entrada de
 * los pesos ONNX cuantizados (`ner-model-onnx-quantized`) — todas las
 * entradas `ner-model-*` comparten la misma `revision` en el lock actual, así
 * que cualquiera serviría; se elige explícitamente esa por ser el archivo que
 * de verdad determina qué detecta el modelo.
 */
export async function computeModelId(): Promise<string> {
  const lock = await readAssetsLock(ASSETS_LOCK_PATH);
  const weights = lock.assets.find((entry) => entry.id === "ner-model-onnx-quantized");
  if (weights === undefined) {
    throw new Error(`No se encontró "ner-model-onnx-quantized" en ${ASSETS_LOCK_PATH}.`);
  }
  return `ner-model@${weights.revision}`;
}

export function readCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

/** Arma la `BaselineIdentity` completa para una corrida con `runtime` dado. */
export async function computeIdentity(runtime: BaselineRuntime): Promise<BaselineIdentity> {
  const [corpusHash, modelHash, modelId] = await Promise.all([
    computeCorpusHash(),
    computeModelHash(),
    computeModelId(),
  ]);

  return {
    corpusHash,
    runtime,
    modelId,
    modelHash,
    effectiveConfig: MEASURE_DEFAULT_EFFECTIVE_CONFIG,
    commit: readCommit(),
  };
}
