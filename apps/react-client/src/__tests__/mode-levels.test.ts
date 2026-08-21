import { EntityType, ReplacementMode, type Rule } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  ENGINE_DEFAULT_MODE,
  countOverrides,
  describeOverrides,
  findGroupRule,
  hasOwnDecision,
  needsConfirmation,
  planApplyDocumentMode,
  planApplyGroupMode,
  planApplyTypeMode,
  resolveDocumentMode,
  resolveTypeHeaderState,
} from "../components/entities/modeLevels.js";

let nextId = 0;

function rule(partial: {
  scope: Rule["scope"];
  mode?: ReplacementMode;
  groupId?: string;
  entityType?: EntityType;
  enabled?: boolean;
}): Rule {
  nextId += 1;
  return {
    id: `rule-${nextId}`,
    scope: partial.scope,
    target: {
      kind: partial.scope,
      ...(partial.groupId !== undefined ? { groupId: partial.groupId } : {}),
      ...(partial.entityType !== undefined ? { entityType: partial.entityType } : {}),
    },
    mode: partial.mode ?? ReplacementMode.Mask,
    priority: 100,
    enabled: partial.enabled ?? true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("lectura de los tres niveles", () => {
  it("sin ninguna regla, el nivel documento muestra el default del motor", () => {
    expect(resolveDocumentMode([])).toBe(ENGINE_DEFAULT_MODE);
  });

  it("una regla deshabilitada no cuenta como vigente", () => {
    const disabled = rule({ scope: "global", mode: ReplacementMode.Redact, enabled: false });
    expect(resolveDocumentMode([disabled])).toBe(ENGINE_DEFAULT_MODE);
    expect(findGroupRule([rule({ scope: "group", groupId: "g1", enabled: false })], "g1")).toBe(
      undefined,
    );
  });

  it("una fila tiene decisión propia si y solo si existe una regla de grupo para ella", () => {
    const rules = [rule({ scope: "group", groupId: "g1" })];
    expect(hasOwnDecision(rules, "g1")).toBe(true);
    expect(hasOwnDecision(rules, "g2")).toBe(false);
  });
});

describe("estado de la cabecera de tipo", () => {
  it("uniform cuando todos los grupos comparten modo", () => {
    expect(
      resolveTypeHeaderState([], EntityType.DNI, [ReplacementMode.Mask, ReplacementMode.Mask]),
    ).toEqual({ kind: "uniform", mode: ReplacementMode.Mask });
  });

  it("mixed apenas uno difiere: la cabecera no puede mostrar un modo sin mentir", () => {
    expect(
      resolveTypeHeaderState([], EntityType.DNI, [
        ReplacementMode.Mask,
        ReplacementMode.Mask,
        ReplacementMode.Redact,
      ]),
    ).toEqual({ kind: "mixed" });
  });

  it("sin grupos visibles cae a la regla de tipo, y de ahí al documento", () => {
    const typeRule = rule({
      scope: "type",
      entityType: EntityType.DNI,
      mode: ReplacementMode.Redact,
    });
    expect(resolveTypeHeaderState([typeRule], EntityType.DNI, [])).toEqual({
      kind: "uniform",
      mode: ReplacementMode.Redact,
    });

    const globalRule = rule({ scope: "global", mode: ReplacementMode.Synthetic });
    expect(resolveTypeHeaderState([globalRule], EntityType.DNI, [])).toEqual({
      kind: "uniform",
      mode: ReplacementMode.Synthetic,
    });
  });
});

describe("barrido: gana el último que tocaste (ADR-087 §3.1b)", () => {
  it("el nivel documento barre las reglas de tipo Y las de grupo", () => {
    const typeRule = rule({ scope: "type", entityType: EntityType.DNI });
    const groupRule = rule({ scope: "group", groupId: "g1" });
    const otherGroupRule = rule({ scope: "group", groupId: "g2" });

    const plan = planApplyDocumentMode([typeRule, groupRule, otherGroupRule]);

    expect(new Set(plan.deleteRuleIds)).toEqual(
      new Set([typeRule.id, groupRule.id, otherGroupRule.id]),
    );
    expect(plan.updateRuleId).toBe(undefined);
  });

  it("el nivel documento actualiza la global existente en vez de duplicarla", () => {
    const existing = rule({ scope: "global", mode: ReplacementMode.Mask });
    const plan = planApplyDocumentMode([existing]);

    expect(plan.updateRuleId).toBe(existing.id);
    expect(plan.deleteRuleIds).toEqual([]);
    // La global reemplazada NO va a `sweptRules` (no se borró, se actualizó):
    // se deshace devolviéndole su modo anterior. Mezclarlas la duplicaría.
    expect(plan.sweptRules).toEqual([]);
    expect(plan.previousMode).toBe(ReplacementMode.Mask);
  });

  it("el nivel tipo barre SOLO las reglas de grupo de ese tipo", () => {
    const mine = rule({ scope: "group", groupId: "dni-1" });
    const alsoMine = rule({ scope: "group", groupId: "dni-2" });
    const otherType = rule({ scope: "group", groupId: "persona-1" });
    const globalRule = rule({ scope: "global" });

    const plan = planApplyTypeMode(
      [mine, alsoMine, otherType, globalRule],
      EntityType.DNI,
      new Set(["dni-1", "dni-2"]),
    );

    expect(new Set(plan.deleteRuleIds)).toEqual(new Set([mine.id, alsoMine.id]));
    // No toca ni el otro tipo ni la global.
    expect(plan.deleteRuleIds).not.toContain(otherType.id);
    expect(plan.deleteRuleIds).not.toContain(globalRule.id);
  });

  it("el nivel fila no barre nada: es el más específico, no tiene niveles debajo", () => {
    const typeRule = rule({ scope: "type", entityType: EntityType.DNI });
    const plan = planApplyGroupMode([typeRule], "g1");

    expect(plan.deleteRuleIds).toEqual([]);
    expect(plan.updateRuleId).toBe(undefined);
    expect(plan.sweptRules).toEqual([]);
    expect(plan.previousMode).toBe(undefined);
  });

  it("las dos órdenes del requisito dan resultados distintos, que es el punto", () => {
    // Orden A — primero la fila, después el tipo: el tipo barre la fila.
    const rowFirst = rule({ scope: "group", groupId: "dni-1" });
    const planA = planApplyTypeMode([rowFirst], EntityType.DNI, new Set(["dni-1"]));
    expect(planA.deleteRuleIds).toEqual([rowFirst.id]);

    // Orden B — primero el tipo, después la fila: la fila sobrevive porque su
    // regla es más específica y nada la barre.
    const typeFirst = rule({ scope: "type", entityType: EntityType.DNI });
    const planB = planApplyGroupMode([typeFirst], "dni-1");
    expect(planB.deleteRuleIds).toEqual([]);
  });
});

describe("snapshot del undo", () => {
  it("sweptRules trae las reglas borradas completas, para recrearlas con su id", () => {
    const typeRule = rule({ scope: "type", entityType: EntityType.DNI });
    const groupRule = rule({ scope: "group", groupId: "g1" });

    const plan = planApplyDocumentMode([typeRule, groupRule]);

    expect(new Set(plan.sweptRules)).toEqual(new Set([typeRule, groupRule]));
  });

  it("separa lo borrado de lo actualizado: la regla del nivel nunca entra a sweptRules", () => {
    const existing = rule({ scope: "global", mode: ReplacementMode.Synthetic });
    const groupRule = rule({ scope: "group", groupId: "g1" });

    const plan = planApplyDocumentMode([existing, groupRule]);

    // Recrear `existing` la duplicaría: `addRule` no deduplica por id.
    expect(plan.sweptRules).toEqual([groupRule]);
    expect(plan.updateRuleId).toBe(existing.id);
    expect(plan.previousMode).toBe(ReplacementMode.Synthetic);
  });
});

describe("fricción escalada", () => {
  it("sin ajustes previos no se confirma nada", () => {
    expect(needsConfirmation(countOverrides([]))).toBe(false);
  });

  it("se confirma apenas hay una regla de tipo o de grupo", () => {
    expect(needsConfirmation(countOverrides([rule({ scope: "type" })]))).toBe(true);
    expect(needsConfirmation(countOverrides([rule({ scope: "group", groupId: "g" })]))).toBe(true);
  });

  it("la regla global sola no cuenta como ajuste que se pueda perder", () => {
    // Aplicar el nivel documento sobre una global existente solo cambia su
    // modo: no destruye trabajo por tipo ni por fila.
    expect(needsConfirmation(countOverrides([rule({ scope: "global" })]))).toBe(false);
  });

  it("la frase nombra lo que se va a romper, en singular y plural", () => {
    expect(describeOverrides({ types: 5, groups: 12 })).toBe("5 categorías y 12 entidades");
    expect(describeOverrides({ types: 1, groups: 1 })).toBe("1 categoría y 1 entidad");
    expect(describeOverrides({ types: 0, groups: 3 })).toBe("3 entidades");
    expect(describeOverrides({ types: 2, groups: 0 })).toBe("2 categorías");
  });
});
