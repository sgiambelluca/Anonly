import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { mergeTargetOptions, validateMerge } from "../components/entities/mergeValidation.js";

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSON 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("mergeTargetOptions", () => {
  it("excludes the source group itself from the candidate list", () => {
    const source = makeGroup({ id: "g1" });
    const sameType = [source, makeGroup({ id: "g2" }), makeGroup({ id: "g3" })];
    expect(mergeTargetOptions(source, sameType).map((g) => g.id)).toEqual(["g2", "g3"]);
  });

  it("returns an empty array when the source is the only group of its type", () => {
    const source = makeGroup({ id: "g1" });
    expect(mergeTargetOptions(source, [source])).toEqual([]);
  });
});

describe("validateMerge", () => {
  const source = makeGroup({ id: "g1", type: EntityType.Person });

  it("is invalid when the source group is missing", () => {
    const result = validateMerge(undefined, makeGroup({ id: "g2" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("is invalid when no target is selected", () => {
    const result = validateMerge(source, undefined);
    expect(result.valid).toBe(false);
  });

  it("is invalid when target and source are the same group", () => {
    const result = validateMerge(source, source);
    expect(result.valid).toBe(false);
  });

  it("is invalid when target is a different EntityType", () => {
    const target = makeGroup({ id: "g2", type: EntityType.DNI });
    const result = validateMerge(source, target);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismo tipo/);
  });

  it("is valid for two distinct groups of the same type", () => {
    const target = makeGroup({ id: "g2", type: EntityType.Person });
    expect(validateMerge(source, target)).toEqual({ valid: true });
  });
});
