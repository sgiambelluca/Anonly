import {
  ConflictReason,
  DetectionSource,
  EntityType,
  type Conflict,
  type ConflictCandidate,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { suggestedCandidate } from "../components/conflicts/conflictResolution.js";

function makeCandidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    source: DetectionSource.Regex,
    entityType: EntityType.DNI,
    confidence: 1,
    value: "34.567.891",
    ...overrides,
  };
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "group-1",
    reason: ConflictReason.Overlap,
    candidates: [
      makeCandidate({ source: DetectionSource.Regex, confidence: 1.0 }),
      makeCandidate({
        source: DetectionSource.NER,
        entityType: EntityType.Person,
        confidence: 0.65,
      }),
    ],
    resolved: false,
    ...overrides,
  };
}

describe("suggestedCandidate", () => {
  it("overlap: picks the highest-confidence candidate", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        makeCandidate({ source: DetectionSource.Regex, confidence: 0.5 }),
        makeCandidate({ source: DetectionSource.NER, confidence: 0.9 }),
      ],
    });
    expect(suggestedCandidate(conflict).source).toBe(DetectionSource.NER);
  });

  it("overlap: on a confidence tie, prefers the regex candidate (deterministic)", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Overlap,
      candidates: [
        makeCandidate({ source: DetectionSource.NER, confidence: 0.8 }),
        makeCandidate({ source: DetectionSource.Regex, confidence: 0.8 }),
      ],
    });
    expect(suggestedCandidate(conflict).source).toBe(DetectionSource.Regex);
  });

  it("disagree: always picks the regex candidate regardless of order", () => {
    const conflict = makeConflict({
      reason: ConflictReason.Disagree,
      candidates: [
        makeCandidate({
          source: DetectionSource.NER,
          entityType: EntityType.Person,
          confidence: 0.65,
        }),
        makeCandidate({
          source: DetectionSource.Regex,
          entityType: EntityType.DNI,
          confidence: 1.0,
        }),
      ],
    });
    expect(suggestedCandidate(conflict).source).toBe(DetectionSource.Regex);
  });

  it("low_confidence: falls back to the first candidate (arbitrary, per spec)", () => {
    const conflict = makeConflict({
      reason: ConflictReason.LowConfidence,
      candidates: [
        makeCandidate({ source: DetectionSource.NER, confidence: 0.4 }),
        makeCandidate({ source: DetectionSource.Regex, confidence: 1.0 }),
      ],
    });
    expect(suggestedCandidate(conflict)).toEqual(conflict.candidates[0]);
  });

  it("ambiguous_canonical: falls back to the first candidate (arbitrary, per spec)", () => {
    const conflict = makeConflict({
      reason: ConflictReason.AmbiguousCanonical,
      candidates: [makeCandidate({ value: "a" }), makeCandidate({ value: "b" })],
    });
    expect(suggestedCandidate(conflict)).toEqual(conflict.candidates[0]);
  });

  it("throws if candidates is empty (violates the Conflict invariant)", () => {
    const conflict = makeConflict({ candidates: [] });
    expect(() => suggestedCandidate(conflict)).toThrow();
  });
});
