import { ReplacementMode, type Rule } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { groupRulesByScope } from "../components/rules/ruleGrouping.js";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    scope: "global",
    target: { kind: "global" },
    mode: ReplacementMode.Placeholder,
    priority: 100,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("groupRulesByScope", () => {
  it("returns empty arrays for every scope when there are no rules", () => {
    expect(groupRulesByScope([])).toEqual({ global: [], type: [], group: [] });
  });

  it("partitions rules into their matching scope bucket", () => {
    const global = makeRule({ id: "g1", scope: "global" });
    const type = makeRule({ id: "t1", scope: "type", target: { kind: "type" } });
    const group = makeRule({ id: "gr1", scope: "group", target: { kind: "group" } });

    const result = groupRulesByScope([global, type, group]);

    expect(result.global).toEqual([global]);
    expect(result.type).toEqual([type]);
    expect(result.group).toEqual([group]);
  });

  it("preserves the original order within each bucket", () => {
    const first = makeRule({ id: "g1", scope: "global", priority: 1 });
    const second = makeRule({ id: "g2", scope: "global", priority: 2 });

    const result = groupRulesByScope([second, first]);

    expect(result.global.map((rule) => rule.id)).toEqual(["g2", "g1"]);
  });
});
