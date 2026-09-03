import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  availableTargetOptions,
  mergePlan,
  mergeTargetOptions,
  validateMerge,
  validateMultiMerge,
} from "../components/entities/mergeValidation.js";

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

/*
 * Fusión de varios grupos a la vez (`UX_Guidelines.md` §3.2, "2+ grupos del
 * mismo tipo"). El Core sigue recibiendo `GROUP_MERGE_REQUESTED` de a uno: lo
 * que se prueba acá es que el plan que arma la UI deje UN grupo y no varios.
 */
describe("mergePlan", () => {
  it("merges the source into the only target when there is one", () => {
    expect(mergePlan("g1", ["g2"])).toEqual([{ sourceGroupId: "g1", targetGroupId: "g2" }]);
  });

  it("points every step at the first target, which is the group that survives", () => {
    expect(mergePlan("g1", ["g2", "g3", "g4"])).toEqual([
      { sourceGroupId: "g1", targetGroupId: "g2" },
      { sourceGroupId: "g3", targetGroupId: "g2" },
      { sourceGroupId: "g4", targetGroupId: "g2" },
    ]);
  });

  it("returns no steps when no target was selected", () => {
    expect(mergePlan("g1", [])).toEqual([]);
  });

  it("never emits the same group twice: the second step would not find it", () => {
    expect(mergePlan("g1", ["g2", "g3", "g2", "g1"])).toEqual([
      { sourceGroupId: "g1", targetGroupId: "g2" },
      { sourceGroupId: "g3", targetGroupId: "g2" },
    ]);
  });
});

describe("availableTargetOptions", () => {
  const source = makeGroup({ id: "g1" });
  const sameType = [source, makeGroup({ id: "g2" }), makeGroup({ id: "g3" })];

  it("hides a group another row already picked", () => {
    expect(availableTargetOptions(source, sameType, ["g2"]).map((g) => g.id)).toEqual(["g3"]);
  });

  it("keeps the row's own selection so its Select does not lose its value", () => {
    expect(availableTargetOptions(source, sameType, ["g2", "g3"], "g2").map((g) => g.id)).toEqual([
      "g2",
    ]);
  });

  it("returns nothing left to add once every group is taken", () => {
    expect(availableTargetOptions(source, sameType, ["g2", "g3"])).toEqual([]);
  });
});

describe("validateMultiMerge", () => {
  const source = makeGroup({ id: "g1", type: EntityType.Person });

  it("is valid for several distinct groups of the same type", () => {
    const targets = [makeGroup({ id: "g2" }), makeGroup({ id: "g3" })];
    expect(validateMultiMerge(source, targets)).toEqual({ valid: true });
  });

  it("is invalid when no target is selected", () => {
    expect(validateMultiMerge(source, []).valid).toBe(false);
  });

  it("is invalid when one of several targets is of another type", () => {
    const targets = [makeGroup({ id: "g2" }), makeGroup({ id: "g3", type: EntityType.DNI })];
    const result = validateMultiMerge(source, targets);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismo tipo/);
  });

  it("is invalid when a row is still empty", () => {
    expect(validateMultiMerge(source, [makeGroup({ id: "g2" }), undefined]).valid).toBe(false);
  });

  it("is invalid when the same group is picked twice", () => {
    const twice = [makeGroup({ id: "g2" }), makeGroup({ id: "g2" })];
    const result = validateMultiMerge(source, twice);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/dos veces/);
  });

  it("is invalid when the source group is missing", () => {
    expect(validateMultiMerge(undefined, [makeGroup({ id: "g2" })]).valid).toBe(false);
  });
});
