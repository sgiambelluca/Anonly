import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EntityGroup,
  type OccurrenceRef,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { validateSplit } from "../components/entities/splitValidation.js";

function makeMember(overrides: Partial<OccurrenceRef> = {}): OccurrenceRef {
  return {
    occurrenceId: "occ-1",
    pageIndex: 0,
    bbox: { x: 0, y: 0, width: 10, height: 5 },
    source: DetectionSource.Regex,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [makeMember({ occurrenceId: "occ-1" }), makeMember({ occurrenceId: "occ-2" })],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSON 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    replacementValueUserSet: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("validateSplit", () => {
  it("is invalid when the group is missing", () => {
    expect(validateSplit(undefined, ["occ-1"]).valid).toBe(false);
  });

  it("is invalid with an empty selection", () => {
    const result = validateSplit(makeGroup(), []);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/al menos una/);
  });

  it("is invalid when a selected occurrenceId does not belong to the group", () => {
    const result = validateSplit(makeGroup(), ["occ-1", "does-not-exist"]);
    expect(result.valid).toBe(false);
  });

  it("is invalid when the selection covers every member (nothing left for the original group)", () => {
    const result = validateSplit(makeGroup(), ["occ-1", "occ-2"]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/al menos una ocurrencia en el grupo original/);
  });

  it("is invalid when duplicate ids in the selection would still cover every member", () => {
    const result = validateSplit(makeGroup(), ["occ-1", "occ-2", "occ-2"]);
    expect(result.valid).toBe(false);
  });

  it("is valid for a proper, non-empty subset", () => {
    const group = makeGroup({
      members: [
        makeMember({ occurrenceId: "occ-1" }),
        makeMember({ occurrenceId: "occ-2" }),
        makeMember({ occurrenceId: "occ-3" }),
      ],
    });
    expect(validateSplit(group, ["occ-2"])).toEqual({ valid: true });
  });
});
