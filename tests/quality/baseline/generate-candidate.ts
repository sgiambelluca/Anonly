/**
 * Genera un candidato en el schema de `DetectionBaseline` (ADR-147 §5) a
 * partir de una medición YA HECHA por `tests/measure/baseline.spec.ts`
 * (`.measure/<label>.json`) y el dataset de referencia actual. Es una
 * TRANSFORMACIÓN pura de datos ya en disco — no corre Playwright, no importa
 * el pipeline, no re-mide nada. Correr la medición real es responsabilidad de
 * `pnpm test:measure` (ADR-147, fuera de esta tarea: requiere `pnpm
 * assets:mirror` y ~20 documentos de NER real en un browser).
 *
 * Este script NUNCA escribe sobre `tests/quality/baselines/reference-v1.json`
 * — solo produce `<label>-candidate.json` al lado de la medición cruda.
 * Promover un candidato a baseline es un paso manual (ADR-147 §5): copiar el
 * archivo a mano, revisando el diff.
 *
 * Uso:
 *   MEASURE_LABEL=baseline tsx --tsconfig tests/tsconfig.json tests/quality/baseline/generate-candidate.ts
 *   (MEASURE_LABEL por defecto es "baseline", igual que baseline.spec.ts)
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MeasuredDocument } from "../../measure/collect.js";
import { classifyGroups } from "../classify-groups.js";
import { loadReferenceDataset } from "../load-reference-dataset.js";
import { isCovered, isFalsePositive, isTypedCovered } from "../matching.js";
import type { DocumentTruth } from "../types.js";

import { deriveDocumentEntityIds } from "./entity-id.js";
import { computeIdentity } from "./identity.js";
import {
  BASELINE_SCHEMA_VERSION,
  type BaselineDocument,
  type DetectionBaseline,
} from "./schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MEASURE_DIR = resolve(HERE, "../../../.measure");

interface RawMeasureDump {
  readonly capturedAt: string;
  readonly results: ReadonlyArray<MeasuredDocument>;
}

/**
 * Pura: dado UN `MeasuredDocument` (lo que capturó el browser) y su
 * `DocumentTruth` correspondiente, arma la entrada de `DetectionBaseline`
 * para ese documento — reusando `classifyGroups` (mismo criterio que
 * `baseline.spec.ts`: solo grupos `enabled:true` cuentan) y la regla de
 * matcheo de `matching.ts` tal cual (`isCovered`/`isTypedCovered` por
 * entidad, `isFalsePositive` para el conteo agregado del documento).
 */
export function buildCandidateDocument(
  measured: MeasuredDocument,
  truth: DocumentTruth,
): BaselineDocument {
  const occurrencesById = new Map(
    measured.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  const { detections } = classifyGroups(measured.groups, occurrencesById);

  const falsePositiveCount = detections.filter((detection) =>
    isFalsePositive(detection, truth.entities),
  ).length;

  const entities = deriveDocumentEntityIds(truth).map(({ id, entity }) => ({
    id,
    entityType: entity.entityType,
    pageIndex: entity.pageIndex,
    covered: isCovered(entity, detections),
    typedCovered: isTypedCovered(entity, detections),
  }));

  return {
    documentId: truth.documentId,
    ok: measured.ok,
    expectedEntityCount: truth.entities.length,
    falsePositiveCount,
    entities,
  };
}

async function main(): Promise<void> {
  const label = process.env.MEASURE_LABEL ?? "baseline";
  const inputPath = resolve(MEASURE_DIR, `${label}.json`);
  const outputPath = resolve(MEASURE_DIR, `${label}-candidate.json`);

  const dump = JSON.parse(await readFile(inputPath, "utf-8")) as RawMeasureDump;
  const dataset = await loadReferenceDataset();
  const truthByDocumentId = new Map(dataset.map((doc) => [doc.entry.documentId, doc.truth]));

  const documents = dump.results.map((measured) => {
    const truth = truthByDocumentId.get(measured.documentId);
    if (truth === undefined) {
      throw new Error(
        `"${measured.documentId}" está en ${inputPath} pero no en el dataset de referencia actual ` +
          "(tests/fixtures/reference/manifest.json). El corpus cambió desde que se corrió la medición: " +
          "volvé a correr pnpm test:measure antes de generar el candidato.",
      );
    }
    return buildCandidateDocument(measured, truth);
  });

  const identity = await computeIdentity("chromium-wasm");

  const candidate: DetectionBaseline = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    identity,
    documents,
  };

  await writeFile(outputPath, JSON.stringify(candidate, null, 2));
  process.stdout.write(`Candidato escrito en ${outputPath}\n`);
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
