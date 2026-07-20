/**
 * `ruleGrouping.ts` — partición pura de `rules.store.rules` en las tres
 * secciones fijas de `RulesPanel` (`ui/Components.md` §4.1: "tres secciones
 * (Global / Por tipo / Por grupo)"; orden documentado en
 * `ui/UX_Guidelines.md` §4).
 */

import type { Rule } from "@anonly/anonymization-core";

export interface RulesByScope {
  readonly global: ReadonlyArray<Rule>;
  readonly type: ReadonlyArray<Rule>;
  readonly group: ReadonlyArray<Rule>;
}

export function groupRulesByScope(rules: ReadonlyArray<Rule>): RulesByScope {
  return {
    global: rules.filter((rule) => rule.scope === "global"),
    type: rules.filter((rule) => rule.scope === "type"),
    group: rules.filter((rule) => rule.scope === "group"),
  };
}
