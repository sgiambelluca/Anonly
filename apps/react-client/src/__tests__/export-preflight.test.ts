import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  countGroups,
  needsNoEnabledGroupsConfirmation,
} from "../components/export/exportPreflight.js";

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

describe("countGroups", () => {
  it("returns zeros for an empty map", () => {
    expect(countGroups(new Map())).toEqual({ total: 0, enabled: 0, disabled: 0 });
  });

  it("counts enabled/disabled/total across all types", () => {
    const groupsByType = new Map([
      [
        EntityType.Person,
        [makeGroup({ id: "g1", enabled: true }), makeGroup({ id: "g2", enabled: false })],
      ],
      [EntityType.DNI, [makeGroup({ id: "g3", type: EntityType.DNI, enabled: true })]],
    ]);

    expect(countGroups(groupsByType)).toEqual({ total: 3, enabled: 2, disabled: 1 });
  });
});

describe("needsNoEnabledGroupsConfirmation", () => {
  it("is true when there are 0 enabled groups (including 0 total groups)", () => {
    expect(needsNoEnabledGroupsConfirmation({ total: 0, enabled: 0, disabled: 0 })).toBe(true);
    expect(needsNoEnabledGroupsConfirmation({ total: 3, enabled: 0, disabled: 3 })).toBe(true);
  });

  it("is false when at least one group is enabled", () => {
    expect(needsNoEnabledGroupsConfirmation({ total: 3, enabled: 1, disabled: 2 })).toBe(false);
  });
});
