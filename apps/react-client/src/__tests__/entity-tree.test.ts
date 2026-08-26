import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  cascadeCheckboxState,
  filterGroups,
  findGroupById,
  hasAnyGroup,
  visibleTypeEntries,
} from "../components/entities/entityTree.js";

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

describe("filterGroups", () => {
  const groups = [
    makeGroup({ id: "g1", canonicalValue: "Juan Pérez", aliases: ["Juan Pérez", "J. Pérez"] }),
    makeGroup({ id: "g2", canonicalValue: "María Gómez", aliases: ["María Gómez"] }),
  ];

  it("returns all groups for an empty/blank query", () => {
    expect(filterGroups(groups, "")).toEqual(groups);
    expect(filterGroups(groups, "   ")).toEqual(groups);
  });

  it("matches by canonicalValue, case-insensitive", () => {
    expect(filterGroups(groups, "maría")).toEqual([groups[1]]);
    expect(filterGroups(groups, "GÓMEZ")).toEqual([groups[1]]);
  });

  it("matches by alias even when it differs from canonicalValue", () => {
    expect(filterGroups(groups, "j. pérez")).toEqual([groups[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterGroups(groups, "no existe")).toEqual([]);
  });
});

describe("cascadeCheckboxState", () => {
  it("is false for an empty group list", () => {
    expect(cascadeCheckboxState([])).toBe(false);
  });

  it("is false when every group is disabled", () => {
    const groups = [makeGroup({ enabled: false }), makeGroup({ id: "g2", enabled: false })];
    expect(cascadeCheckboxState(groups)).toBe(false);
  });

  it("is true when every group is enabled", () => {
    const groups = [makeGroup({ enabled: true }), makeGroup({ id: "g2", enabled: true })];
    expect(cascadeCheckboxState(groups)).toBe(true);
  });

  it("is 'indeterminate' when mixed", () => {
    const groups = [makeGroup({ enabled: true }), makeGroup({ id: "g2", enabled: false })];
    expect(cascadeCheckboxState(groups)).toBe("indeterminate");
  });
});

describe("visibleTypeEntries", () => {
  it("drops types with no groups and preserves Map insertion order", () => {
    const groupsByType = new Map([
      [EntityType.Person, [makeGroup({ id: "g1" })]],
      [EntityType.Organization, []],
      [EntityType.DNI, [makeGroup({ id: "g2", type: EntityType.DNI })]],
    ]);

    expect(visibleTypeEntries(groupsByType)).toEqual([
      [EntityType.Person, [makeGroup({ id: "g1" })]],
      [EntityType.DNI, [makeGroup({ id: "g2", type: EntityType.DNI })]],
    ]);
  });

  it("returns an empty array when there are no groups at all", () => {
    const groupsByType = new Map([[EntityType.Person, []]]);
    expect(visibleTypeEntries(groupsByType)).toEqual([]);
  });
});

describe("findGroupById", () => {
  const groupsByType = new Map([
    [EntityType.Person, [makeGroup({ id: "g1" })]],
    [EntityType.DNI, [makeGroup({ id: "g2", type: EntityType.DNI })]],
  ]);

  it("finds a group across any type bucket", () => {
    expect(findGroupById(groupsByType, "g2")?.type).toBe(EntityType.DNI);
  });

  it("returns undefined when the id does not exist", () => {
    expect(findGroupById(groupsByType, "missing")).toBeUndefined();
  });
});

describe("hasAnyGroup", () => {
  it("is false when every bucket is empty", () => {
    const groupsByType = new Map([
      [EntityType.Person, []],
      [EntityType.DNI, []],
    ]);
    expect(hasAnyGroup(groupsByType)).toBe(false);
  });

  it("is true when at least one bucket has a group", () => {
    const groupsByType = new Map([
      [EntityType.Person, []],
      [EntityType.DNI, [makeGroup({ id: "g1", type: EntityType.DNI })]],
    ]);
    expect(hasAnyGroup(groupsByType)).toBe(true);
  });
});
