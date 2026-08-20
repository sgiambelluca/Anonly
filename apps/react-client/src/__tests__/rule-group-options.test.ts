import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { ruleGroupOptions } from "../components/rules/ruleGroupOptions.js";

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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("ruleGroupOptions", () => {
  it("returns an empty array when there are no groups", () => {
    expect(ruleGroupOptions(new Map())).toEqual([]);
  });

  it("flattens groups across all types with a type-qualified label", () => {
    const person = makeGroup({ id: "g1", type: EntityType.Person, canonicalValue: "Juan Pérez" });
    const dni = makeGroup({ id: "g2", type: EntityType.DNI, canonicalValue: "34.567.891" });
    const groupsByType = new Map([
      [EntityType.Person, [person]],
      [EntityType.DNI, [dni]],
    ]);

    const options = ruleGroupOptions(groupsByType);

    expect(options).toEqual([
      { id: "g1", label: "Juan Pérez (Personas)" },
      { id: "g2", label: "34.567.891 (DNI)" },
    ]);
  });

  it("skips empty type buckets", () => {
    const groupsByType = new Map([
      [EntityType.Person, []],
      [EntityType.DNI, [makeGroup({ id: "g2", type: EntityType.DNI })]],
    ]);

    expect(ruleGroupOptions(groupsByType)).toEqual([{ id: "g2", label: "Juan Pérez (DNI)" }]);
  });
});
