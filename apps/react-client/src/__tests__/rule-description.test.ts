import { EntityType, ReplacementMode, type Rule } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describeRuleEffectPreview,
  formatRuleDescription,
} from "../components/rules/ruleDescription.js";

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

describe("formatRuleDescription", () => {
  it("describes a global rule as 'Modo default: <mode>'", () => {
    const rule = makeRule({ scope: "global", mode: ReplacementMode.Placeholder });
    expect(formatRuleDescription(rule, () => undefined)).toBe("Modo default: Placeholder");
  });

  it("describes a type rule as '<TypeLabel> → <mode>'", () => {
    const rule = makeRule({
      scope: "type",
      target: { kind: "type", entityType: EntityType.DNI },
      mode: ReplacementMode.Mask,
    });
    expect(formatRuleDescription(rule, () => undefined)).toBe("DNI → Máscara");
  });

  it("describes a group rule as '<canonicalValue> → <mode>'", () => {
    const rule = makeRule({
      scope: "group",
      target: { kind: "group", groupId: "group-1" },
      mode: ReplacementMode.Redact,
    });
    const resolveGroupLabel = (groupId: string) =>
      groupId === "group-1" ? "Juan Pérez" : undefined;
    expect(formatRuleDescription(rule, resolveGroupLabel)).toBe("Juan Pérez → Redactar");
  });

  it("falls back to 'Grupo eliminado' when the group no longer resolves", () => {
    const rule = makeRule({
      scope: "group",
      target: { kind: "group", groupId: "missing" },
      mode: ReplacementMode.Redact,
    });
    expect(formatRuleDescription(rule, () => undefined)).toBe("Grupo eliminado → Redactar");
  });
});

describe("describeRuleEffectPreview", () => {
  it("describes the global effect", () => {
    const text = describeRuleEffectPreview(
      { scope: "global", mode: ReplacementMode.Synthetic },
      {},
    );
    expect(text).toMatch(/modo default/);
    expect(text).toMatch(/Sintético/);
  });

  it("describes the type effect with the given label", () => {
    const text = describeRuleEffectPreview(
      { scope: "type", mode: ReplacementMode.Mask },
      { entityTypeLabel: "DNI" },
    );
    expect(text).toBe("Los grupos de tipo DNI pasarán a modo Máscara.");
  });

  it("falls back to a generic type label when none is given", () => {
    const text = describeRuleEffectPreview({ scope: "type", mode: ReplacementMode.Mask }, {});
    expect(text).toMatch(/este tipo/);
  });

  it("describes the group effect with the given label", () => {
    const text = describeRuleEffectPreview(
      { scope: "group", mode: ReplacementMode.Redact },
      { groupLabel: "Juan Pérez (Personas)" },
    );
    expect(text).toBe("Juan Pérez (Personas) pasará a modo Redactar.");
  });

  it("falls back to a generic group label when none is given", () => {
    const text = describeRuleEffectPreview({ scope: "group", mode: ReplacementMode.Redact }, {});
    expect(text).toMatch(/el grupo elegido/);
  });
});
