import { createHash } from "node:crypto";

import { EntityType, type BoundingBox, type Occurrence } from "@anonly/shared";

import type { BaselineDocument } from "../../quality/baseline/schema.js";

export interface NerOccurrenceFootprint {
  readonly pageIndex: number;
  readonly entityType: Occurrence["entityType"];
  readonly normalizedValue: string;
  readonly value: string;
  readonly confidence: number;
  readonly bbox: Occurrence["bbox"];
  readonly fragments?: Occurrence["fragments"];
}

export function nerOccurrenceFootprint(occurrence: Occurrence): NerOccurrenceFootprint {
  return {
    pageIndex: occurrence.pageIndex,
    entityType: occurrence.entityType,
    normalizedValue: occurrence.normalizedValue,
    value: occurrence.value,
    confidence: occurrence.confidence,
    bbox: occurrence.bbox,
    fragments: occurrence.fragments,
  };
}

export function canonicalNerFootprints(
  occurrences: ReadonlyArray<Occurrence>,
): ReadonlyArray<NerOccurrenceFootprint> {
  return occurrences
    .map(nerOccurrenceFootprint)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
}

export function nerFootprintDigest(occurrences: ReadonlyArray<Occurrence>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalNerFootprints(occurrences)))
    .digest("hex");
}

export interface ExactQualityDifference {
  readonly missing: ReadonlyArray<NerOccurrenceFootprint>;
  readonly added: ReadonlyArray<NerOccurrenceFootprint>;
  readonly changed: ReadonlyArray<{
    readonly baseline: NerOccurrenceFootprint;
    readonly candidate: NerOccurrenceFootprint;
  }>;
}

export interface ExperimentalQualityDifference {
  readonly missingDocuments: ReadonlyArray<string>;
  readonly failedDocuments: ReadonlyArray<string>;
  readonly denominatorMismatches: ReadonlyArray<string>;
  readonly lostCoverage: ReadonlyArray<string>;
  readonly addedFalsePositives: ReadonlyArray<string>;
}

export function compareExperimentalQuality(
  baseline: ReadonlyArray<BaselineDocument>,
  candidate: ReadonlyArray<BaselineDocument>,
): ExperimentalQualityDifference {
  const baselineById = new Map(baseline.map((document) => [document.documentId, document]));
  const candidateById = new Map(candidate.map((document) => [document.documentId, document]));
  const missingDocuments: string[] = [];
  const failedDocuments: string[] = [];
  const denominatorMismatches: string[] = [];
  const lostCoverage: string[] = [];
  const addedFalsePositives: string[] = [];

  for (const [documentId, oldDocument] of baselineById) {
    const newDocument = candidateById.get(documentId);
    if (newDocument === undefined) {
      missingDocuments.push(documentId);
      continue;
    }
    if (!newDocument.ok) failedDocuments.push(documentId);
    if (newDocument.expectedEntityCount !== oldDocument.expectedEntityCount) {
      denominatorMismatches.push(documentId);
    }
    if (newDocument.falsePositiveCount > oldDocument.falsePositiveCount) {
      addedFalsePositives.push(documentId);
    }
    const entitiesById = new Map(newDocument.entities.map((entity) => [entity.id, entity]));
    for (const oldEntity of oldDocument.entities) {
      if (!oldEntity.covered) continue;
      const newEntity = entitiesById.get(oldEntity.id);
      if (newEntity === undefined || !newEntity.covered) lostCoverage.push(oldEntity.id);
    }
  }
  for (const documentId of candidateById.keys()) {
    if (!baselineById.has(documentId)) missingDocuments.push(documentId);
  }
  return {
    missingDocuments,
    failedDocuments,
    denominatorMismatches,
    lostCoverage,
    addedFalsePositives,
  };
}

function identity(footprint: NerOccurrenceFootprint): string {
  return JSON.stringify([
    footprint.pageIndex,
    footprint.entityType,
    footprint.normalizedValue,
    footprint.value,
  ]);
}

export function compareExactNerFootprints(
  baseline: ReadonlyArray<Occurrence>,
  candidate: ReadonlyArray<Occurrence>,
): ExactQualityDifference {
  return compareFootprintArrays(
    canonicalNerFootprints(baseline),
    canonicalNerFootprints(candidate),
  );
}

export function compareFootprintArrays(
  baseline: ReadonlyArray<NerOccurrenceFootprint>,
  candidate: ReadonlyArray<NerOccurrenceFootprint>,
): ExactQualityDifference {
  const before = [...baseline].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
  );
  const after = [...candidate].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), "en"),
  );
  const unused = new Set(after.map((_, index) => index));
  const missing: NerOccurrenceFootprint[] = [];
  const added: NerOccurrenceFootprint[] = [];
  const changed: ExactQualityDifference["changed"][number][] = [];

  for (const oldFootprint of before) {
    const matching = [...unused].find((index) => {
      const newFootprint = after[index];
      return newFootprint !== undefined && identity(newFootprint) === identity(oldFootprint);
    });
    if (matching === undefined) {
      missing.push(oldFootprint);
      continue;
    }
    unused.delete(matching);
    const newFootprint = after[matching];
    if (
      newFootprint !== undefined &&
      JSON.stringify(oldFootprint) !== JSON.stringify(newFootprint)
    ) {
      changed.push({ baseline: oldFootprint, candidate: newFootprint });
    }
  }

  for (const index of unused) {
    const footprint = after[index];
    if (footprint !== undefined) added.push(footprint);
  }
  return { missing, added, changed };
}

export function assertExactNerEquality(
  documentId: string,
  baseline: ReadonlyArray<Occurrence>,
  candidate: ReadonlyArray<Occurrence>,
): void {
  const difference = compareExactNerFootprints(baseline, candidate);
  if (
    difference.missing.length > 0 ||
    difference.added.length > 0 ||
    difference.changed.length > 0
  ) {
    throw new Error(
      `${documentId}: ocurrencias NER distintas; ` +
        `${difference.missing.length} faltantes, ${difference.added.length} nuevas, ` +
        `${difference.changed.length} cambiadas.`,
    );
  }
}

export function parseNerOccurrenceFootprints(
  value: unknown,
): ReadonlyArray<NerOccurrenceFootprint> {
  if (!Array.isArray(value)) throw new Error("NER occurrence footprint list is not an array.");
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`NER occurrence footprint ${index} is not an object.`);
    }
    const record = item as Record<string, unknown>;
    const entityTypes: ReadonlyArray<string> = Object.values(EntityType);
    const bbox = parseBoundingBox(record.bbox, `footprint ${index} bbox`);
    let fragments: ReadonlyArray<BoundingBox> | undefined;
    if (record.fragments !== undefined) {
      if (!Array.isArray(record.fragments)) {
        throw new Error(`NER occurrence footprint ${index} has invalid fragments.`);
      }
      fragments = record.fragments.map((fragment, fragmentIndex) =>
        parseBoundingBox(fragment, `footprint ${index} fragment ${fragmentIndex}`),
      );
    }
    if (
      typeof record.pageIndex !== "number" ||
      typeof record.entityType !== "string" ||
      !entityTypes.includes(record.entityType) ||
      typeof record.normalizedValue !== "string" ||
      typeof record.value !== "string" ||
      typeof record.confidence !== "number"
    ) {
      throw new Error(`NER occurrence footprint ${index} has an invalid shape.`);
    }
    return {
      pageIndex: record.pageIndex,
      entityType: record.entityType as Occurrence["entityType"],
      normalizedValue: record.normalizedValue,
      value: record.value,
      confidence: record.confidence,
      bbox,
      ...(fragments === undefined ? {} : { fragments }),
    };
  });
}

function parseBoundingBox(value: unknown, label: string): BoundingBox {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} has an invalid shape.`);
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.width !== "number" ||
    typeof record.height !== "number" ||
    (record.rotation !== undefined &&
      record.rotation !== 0 &&
      record.rotation !== 90 &&
      record.rotation !== 180 &&
      record.rotation !== 270)
  ) {
    throw new Error(`${label} has an invalid shape.`);
  }
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
    ...(record.rotation === 0 ||
    record.rotation === 90 ||
    record.rotation === 180 ||
    record.rotation === 270
      ? { rotation: record.rotation }
      : {}),
  };
}
