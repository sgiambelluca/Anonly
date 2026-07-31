/**
 * `ruleGroupOptions.ts` — grupos aplanados (todos los tipos) para el select
 * "Por grupo" de `RuleCreatorDialog`/`RuleEditorDialog`
 * (`ui/UX_Guidelines.md` §4.1: "select de grupo (autocomplete por
 * canonicalValue)"; a diferencia de `MergeDialog`, acá no se filtra por
 * `EntityType` — una regla de scope `group` puede apuntar a cualquier grupo).
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";

import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";

export interface RuleGroupOption {
  readonly id: string;
  readonly label: string;
}

export function ruleGroupOptions(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): ReadonlyArray<RuleGroupOption> {
  const options: RuleGroupOption[] = [];
  for (const groups of groupsByType.values()) {
    for (const group of groups) {
      options.push({
        id: group.id,
        label: `${group.canonicalValue} (${ENTITY_TYPE_LABEL[group.type]})`,
      });
    }
  }
  return options;
}
