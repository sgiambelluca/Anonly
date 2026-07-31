import { EntityType, ReplacementMode } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  buildRuleTarget,
  validateRuleForm,
  type RuleFormState,
} from "../components/rules/ruleValidation.js";

function makeForm(overrides: Partial<RuleFormState> = {}): RuleFormState {
  return {
    scope: "global",
    entityType: null,
    groupId: null,
    mode: ReplacementMode.Placeholder,
    priority: 100,
    ...overrides,
  };
}

describe("validateRuleForm", () => {
  it("is valid for a global rule with default priority", () => {
    expect(validateRuleForm(makeForm())).toEqual({ valid: true });
  });

  it("is invalid when priority is below 0", () => {
    const result = validateRuleForm(makeForm({ priority: -1 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/0 y 1000/);
  });

  it("is invalid when priority is above 1000", () => {
    const result = validateRuleForm(makeForm({ priority: 1001 }));
    expect(result.valid).toBe(false);
  });

  it("is invalid when priority is not finite", () => {
    expect(validateRuleForm(makeForm({ priority: Number.NaN })).valid).toBe(false);
  });

  it("is invalid for scope 'type' without an entityType", () => {
    const result = validateRuleForm(makeForm({ scope: "type", entityType: null }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tipo/);
  });

  it("is valid for scope 'type' with an entityType", () => {
    expect(validateRuleForm(makeForm({ scope: "type", entityType: EntityType.DNI }))).toEqual({
      valid: true,
    });
  });

  it("is invalid for scope 'group' without a groupId", () => {
    const result = validateRuleForm(makeForm({ scope: "group", groupId: null }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/grupo/);
  });

  it("is valid for scope 'group' with a groupId", () => {
    expect(validateRuleForm(makeForm({ scope: "group", groupId: "group-1" }))).toEqual({
      valid: true,
    });
  });
});

describe("buildRuleTarget", () => {
  it("builds a global target with no groupId/entityType", () => {
    expect(buildRuleTarget(makeForm({ scope: "global" }))).toEqual({ kind: "global" });
  });

  it("builds a type target with entityType", () => {
    const form = makeForm({ scope: "type", entityType: EntityType.CUIT });
    expect(buildRuleTarget(form)).toEqual({ kind: "type", entityType: EntityType.CUIT });
  });

  it("builds a group target with groupId", () => {
    const form = makeForm({ scope: "group", groupId: "group-1" });
    expect(buildRuleTarget(form)).toEqual({ kind: "group", groupId: "group-1" });
  });

  it("returns null when the form is invalid (bad priority)", () => {
    expect(buildRuleTarget(makeForm({ priority: 2000 }))).toBeNull();
  });

  it("returns null for scope 'type' without entityType", () => {
    expect(buildRuleTarget(makeForm({ scope: "type", entityType: null }))).toBeNull();
  });

  it("returns null for scope 'group' without groupId", () => {
    expect(buildRuleTarget(makeForm({ scope: "group", groupId: null }))).toBeNull();
  });
});
