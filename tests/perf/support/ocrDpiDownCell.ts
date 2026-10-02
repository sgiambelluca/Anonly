/**
 * Arma el registro de una celda de la fase 1 a partir de lo observado. Puro: el spec lo llama y
 * escribe el resultado. En los corpus reales el registro lleva solo conteos, distribuciones y
 * huellas; las listas con valores de entidades no salen de esta función.
 */

import type { Capture } from "./adr190Dpi.js";
import {
  cellInvalidReasons,
  summarizeChain,
  summarizeDispatches,
  type PageCap,
} from "./ocrDpiDownChain.js";
import { countTruthByType, type CorpusTruth } from "./ocrDpiDownCorpus.js";
import {
  compareEntities,
  entityKey,
  pairBoxCoverage,
  scoreTokens,
  type Box,
  type EntityComparison,
  type ObservedEntity,
} from "./ocrDpiDownScoring.js";
import type { CellRecord, CountsByType, EntityCounts } from "./ocrDpiDownSummary.js";

export const NATIVE_SYNTHETIC_CAP_DPI = 300;

/** Lo que una celda de referencia conserva en memoria para comparar a las demás. Nunca se escribe. */
export interface ReferenceData {
  readonly entities: ReadonlyArray<ObservedEntity>;
  readonly text: string;
}

export interface RawEntity {
  readonly value: string;
  readonly entityType: string;
  readonly bbox: unknown;
  readonly pageIndex: number;
}

export interface CellObservation {
  readonly ready: boolean;
  readonly pipelineFailure: unknown;
  readonly capture: Pick<Capture, "jobs" | "issues">;
  readonly caps: ReadonlyArray<PageCap>;
  readonly ocrPageEvents: ReadonlyArray<unknown>;
  readonly entities: ReadonlyArray<RawEntity>;
  readonly text: string;
  readonly nerFinished: boolean;
  readonly overrideEffective: boolean;
}

export interface CellInput {
  readonly corpus: {
    readonly id: CellRecord["corpus"];
    readonly kind: "synthetic" | "real";
    readonly sha256: string;
    readonly truth: CorpusTruth | null;
  };
  readonly dpi: number;
  readonly repetition: number;
  readonly observation: CellObservation;
  readonly reference: ReferenceData | null;
}

function boxOf(value: unknown): Box | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const { x, y, width, height } = candidate;
  return typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    [x, y, width, height].every(Number.isFinite)
    ? { x, y, width, height }
    : null;
}

export function observedEntities(raw: ReadonlyArray<RawEntity>): ReadonlyArray<ObservedEntity> {
  return raw.map((entity) => ({
    type: entity.entityType,
    value: entity.value,
    pageIndex: entity.pageIndex,
    box: boxOf(entity.bbox),
  }));
}

const countsOnly = (comparison: EntityComparison): EntityCounts => ({
  byType: comparison.byType,
  totals: comparison.totals,
});

export function detectedByType(entities: ReadonlyArray<ObservedEntity>): CountsByType {
  const counts: Record<string, number> = {};
  for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export interface CellResult {
  readonly record: CellRecord;
  /** Detalle con valores, solo de corpus sintéticos (la verdad es inventada); `null` en los reales. */
  readonly syntheticDetail: {
    readonly missedVsTruth: EntityComparison["missed"];
    readonly addedVsTruth: EntityComparison["added"];
    readonly expectedByType: CountsByType;
    /** Entidades detectadas y texto leído: solo sintéticos; permiten rehidratar la referencia desde el JSON de la celda. */
    readonly detected: ReadonlyArray<ObservedEntity>;
    readonly observedText: string;
  } | null;
  /** Lo que esta celda deja como referencia si es la repetición 1 del brazo 300. */
  readonly asReference: ReferenceData;
}

export function buildCellRecord(input: CellInput): CellResult {
  const { corpus, dpi, repetition, observation } = input;
  const synthetic = corpus.kind === "synthetic";
  const dispatch = summarizeDispatches(observation.capture.jobs, observation.caps, dpi);
  const chain = summarizeChain(observation.capture.jobs, observation.ocrPageEvents);
  const entities = observedEntities(observation.entities);
  const invalidReasons = cellInvalidReasons({
    ready: observation.ready,
    pipelineFailure: observation.pipelineFailure,
    captureIssues: observation.capture.issues,
    dispatch,
    chain,
    nerExpectedButNotFinished: !observation.nerFinished,
    overrideEffective: observation.overrideEffective,
    expectNativeCap: synthetic ? NATIVE_SYNTHETIC_CAP_DPI : null,
  });
  const truth = corpus.truth;
  const truthEntities: ReadonlyArray<ObservedEntity> =
    truth === null
      ? []
      : truth.entities.map((entity) => ({
          type: entity.type,
          value: entity.value,
          pageIndex: entity.pageIndex,
          box: entity.box,
        }));
  const vsTruth = truth === null ? null : compareEntities(truthEntities, entities);
  const reference = input.reference;
  const vsReference = reference === null ? null : compareEntities(reference.entities, entities);
  const pairing = reference === null ? null : pairBoxCoverage(reference.entities, entities);
  const record: CellRecord = {
    schema: 1,
    corpus: corpus.id,
    corpusKind: corpus.kind,
    dpi,
    repetition,
    valid: invalidReasons.length === 0,
    invalidReasons,
    armEffective: dispatch.armEffective,
    fixtureSha256: corpus.sha256,
    dispatch,
    chain,
    detectedByType: detectedByType(entities),
    entitiesVsTruth: vsTruth === null ? null : countsOnly(vsTruth),
    // Claves de la verdad no detectadas: solo sintéticos (valores inventados); sirven a la comparación pareada de SD.
    truthLostKeys:
      vsTruth === null || !synthetic
        ? null
        : vsTruth.missed.map((lost) =>
            entityKey({ type: lost.type, value: lost.value, pageIndex: lost.pageIndex, box: null }),
          ),
    entitiesVsReference: vsReference === null ? null : countsOnly(vsReference),
    tokensVsTruth: truth === null ? null : scoreTokens(truth.text, observation.text),
    tokensVsReference: reference === null ? null : scoreTokens(reference.text, observation.text),
    coverageVsReference:
      pairing === null
        ? null
        : {
            values: pairing.values.map((value) => Math.floor(value * 10_000) / 10_000),
            pairsWithoutBox: pairing.pairsWithoutBox,
          },
  };
  return {
    record,
    syntheticDetail:
      synthetic && vsTruth !== null && truth !== null
        ? {
            missedVsTruth: vsTruth.missed,
            addedVsTruth: vsTruth.added,
            expectedByType: countTruthByType(truth.entities),
            detected: entities,
            observedText: observation.text,
          }
        : null,
    asReference: { entities, text: observation.text },
  };
}
