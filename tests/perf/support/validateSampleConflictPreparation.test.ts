import {
  ConflictReason,
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Conflict,
  type ConflictCandidate,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  conflictPreparationInvariants,
  conflictDialogDefaultMatches,
  heldManualConflictCount,
  unresolvedConflictCount,
} from "./validateSampleConflictPreparation.js";

const group = (updatedAt: number, replacementMode: string): EntityGroup => ({
  id: "group-id",
  type: EntityType.Person,
  canonicalValue: "value",
  members: [],
  replacementMode: replacementMode === "label" ? ReplacementMode.Placeholder : ReplacementMode.Mask,
  replacementValue: "replacement",
  indexInType: 0,
  enabled: true,
  aliases: [],
  replacementValueUserSet: false,
  needsReview: false,
  replacementPreviews: {
    placeholder: "replacement",
    mask: "**",
    synthetic: "replacement",
    placeholderLadder: ["replacement"],
  },
  createdAt: 1,
  updatedAt,
});
const conflict = (
  resolved: boolean,
  heldManual?: true,
  reason: ConflictReason = ConflictReason.Overlap,
  candidates: ReadonlyArray<ConflictCandidate> = [],
): Conflict => ({
  id: "conflict-id",
  groupId: "group-id",
  reason,
  candidates,
  resolved,
  ...(heldManual === undefined ? {} : { heldManual }),
});

describe("M-V1 conflict preparation invariants", () => {
  it("allows resolution state changes and timestamps, but detects group semantic edits", () => {
    const before = { groups: [group(1, "label")], conflicts: [conflict(false)] };
    const after = { groups: [group(2, "label")], conflicts: [conflict(true)] };
    expect(conflictPreparationInvariants(before, after)).toEqual({
      groupsPreserved: true,
      conflictsPreserved: true,
    });
    expect(
      conflictPreparationInvariants(before, {
        groups: [group(2, "synthetic")],
        conflicts: [conflict(true)],
      }).groupsPreserved,
    ).toBe(false);
  });

  it("counts held manual pending conflicts separately without resolving them", () => {
    const snapshot = { groups: [], conflicts: [conflict(false, true), conflict(true)] };
    expect(unresolvedConflictCount(snapshot)).toBe(1);
    expect(heldManualConflictCount(snapshot)).toBe(1);
  });

  it("expects a spelling radio only when the UI has multiple spelling choices", () => {
    const singleSpelling = conflict(false, undefined, ConflictReason.AmbiguousCanonical, [
      {
        source: DetectionSource.Regex,
        entityType: EntityType.Person,
        confidence: 1,
        value: "value",
      },
      {
        source: DetectionSource.NER,
        entityType: EntityType.Person,
        confidence: 0.8,
        value: "value",
      },
    ]);
    expect(conflictDialogDefaultMatches(singleSpelling, group(1, "label"), [])).toBe(true);
    expect(conflictDialogDefaultMatches(singleSpelling, group(1, "label"), ["value"])).toBe(false);

    const multipleSpellings = conflict(false, undefined, ConflictReason.AmbiguousCanonical, [
      {
        source: DetectionSource.Regex,
        entityType: EntityType.Person,
        confidence: 1,
        value: "value",
      },
      {
        source: DetectionSource.NER,
        entityType: EntityType.Person,
        confidence: 0.8,
        value: "VALUE",
      },
    ]);
    expect(conflictDialogDefaultMatches(multipleSpellings, group(1, "label"), [])).toBe(false);
    expect(conflictDialogDefaultMatches(multipleSpellings, group(1, "label"), ["value"])).toBe(
      true,
    );
  });
});
