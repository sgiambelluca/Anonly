import { EntityType, DetectionSource, type Occurrence } from "@anonly/shared";
import { describe, expect, it } from "vitest";

import {
  assertExactNerEquality,
  canonicalNerFootprints,
  compareExperimentalQuality,
  compareExactNerFootprints,
  nerFootprintDigest,
} from "./nerPackaging.js";

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: "occurrence-1",
    pageIndex: 0,
    entityType: EntityType.Person,
    source: DetectionSource.NER,
    value: "María Gómez",
    normalizedValue: "maria gomez",
    confidence: 0.97,
    bbox: { x: 10, y: 20, width: 80, height: 12 },
    wordSpan: { startIndex: 2, endIndexExclusive: 3 },
    ...overrides,
  };
}

describe("nerPackaging", () => {
  it("canonicalizes event order and fingerprints exact NER values and geometry", () => {
    const one = occurrence();
    const two = occurrence({ id: "occurrence-2", pageIndex: 1, value: "Carlos López" });
    expect(canonicalNerFootprints([two, one])).toEqual(canonicalNerFootprints([one, two]));
    expect(nerFootprintDigest([one, two])).toBe(nerFootprintDigest([two, one]));
  });

  it("reports an occurrence lost by the candidate", () => {
    const result = compareExactNerFootprints([occurrence()], []);
    expect(result.missing).toHaveLength(1);
    expect(result.added).toHaveLength(0);
  });

  it("reports a new occurrence without compensating for a lost one", () => {
    const result = compareExactNerFootprints(
      [occurrence()],
      [occurrence({ id: "new", value: "Otra Persona", normalizedValue: "otra persona" })],
    );
    expect(result.missing).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it("reports score and box changes for the same entity", () => {
    const result = compareExactNerFootprints([occurrence()], [occurrence({ confidence: 0.96 })]);
    expect(result.changed).toHaveLength(1);
  });

  it("accepts identical per-occurrence output", () => {
    expect(() =>
      assertExactNerEquality("synthetic-doc", [occurrence()], [occurrence()]),
    ).not.toThrow();
  });

  it("applies ADR-147 zero-loss and zero-new-false-positive controls without asset identity", () => {
    const baseline = {
      documentId: "synthetic-doc",
      ok: true,
      expectedEntityCount: 1,
      falsePositiveCount: 0,
      entities: [
        {
          id: "synthetic-doc:0:Person:maria gomez#0",
          entityType: "Person",
          pageIndex: 0,
          covered: true,
          typedCovered: true,
        },
      ],
    };
    expect(compareExperimentalQuality([baseline], [baseline])).toEqual({
      missingDocuments: [],
      failedDocuments: [],
      denominatorMismatches: [],
      lostCoverage: [],
      addedFalsePositives: [],
    });
    const worse = {
      ...baseline,
      falsePositiveCount: 1,
      entities: [{ ...baseline.entities[0]!, covered: false }],
    };
    expect(compareExperimentalQuality([baseline], [worse])).toMatchObject({
      lostCoverage: ["synthetic-doc:0:Person:maria gomez#0"],
      addedFalsePositives: ["synthetic-doc"],
    });
  });
});
