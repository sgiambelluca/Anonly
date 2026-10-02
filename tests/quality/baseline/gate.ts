/**
 * El gate (ADR-147 §5): compara un candidato ya generado
 * (`generate-candidate.ts`) contra `tests/quality/baselines/reference-v1.json`
 * y sale con código de proceso distinto de cero si el comparador (`compare.ts`)
 * encuentra al menos un fallo.
 *
 * Deliberadamente NO conectado a ningún workflow de CI — instrucción
 * explícita para toda la campaña de hardening (fuera de alcance de esta
 * tarea). Es el comando local que un humano corre a mano.
 *
 * `runGate` es la función testeable sin spawnear un proceso: `main()` la
 * llama y traduce el resultado a `process.exitCode`, mismo patrón que
 * `scripts/mirror-assets.ts`.
 *
 * Uso:
 *   tsx --tsconfig tests/tsconfig.json tests/quality/baseline/gate.ts <candidato.json> [baseline.json]
 *   (baseline.json por defecto: tests/quality/baselines/reference-v1.json)
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareBaselines, type ComparatorTolerances } from "./compare.js";
import { formatComparisonReport } from "./print-comparison-report.js";
import { parseDetectionBaseline } from "./schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE_PATH = resolve(HERE, "../baselines/reference-v1.json");

/**
 * Lee candidato y baseline, compara, imprime el veredicto y devuelve el
 * código de salida (0 = OK, 1 = hay al menos un fallo). No toca
 * `process.exitCode` directamente — eso es responsabilidad del caller
 * (`main()` acá, o un test que invoque esta función directo).
 */
export async function runGate(
  candidatePath: string,
  baselinePath: string = DEFAULT_BASELINE_PATH,
  tolerances: ComparatorTolerances = {},
): Promise<number> {
  const [candidateRaw, baselineRaw] = await Promise.all([
    readFile(candidatePath, "utf-8"),
    readFile(baselinePath, "utf-8"),
  ]);

  const candidate = parseDetectionBaseline(JSON.parse(candidateRaw), candidatePath);
  const baseline = parseDetectionBaseline(JSON.parse(baselineRaw), baselinePath);

  const result = compareBaselines(baseline, candidate, tolerances);
  process.stdout.write(`${formatComparisonReport(result)}\n`);

  return result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const candidatePath = process.argv[2];
  const baselinePath = process.argv[3] ?? DEFAULT_BASELINE_PATH;

  if (candidatePath === undefined) {
    console.error(
      "Uso: tsx gate.ts <candidato.json> [baseline.json]\n" +
        `(baseline.json por defecto: ${DEFAULT_BASELINE_PATH})`,
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = await runGate(candidatePath, baselinePath);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
