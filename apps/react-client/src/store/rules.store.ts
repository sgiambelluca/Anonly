/**
 * `rules.store.ts` — reglas de reemplazo por scope (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.3.
 *
 * Placeholder de Hito 10 PR1 (scaffold): store puramente local, sin conexión
 * al bus todavía (eso es `bus-bridge.ts`, PR5 `core-adapter`).
 */

import type { Rule } from "@anonly/anonymization-core";
import { create } from "zustand";

export interface RulesSlice {
  readonly rules: ReadonlyArray<Rule>;
  addRule(rule: Rule): void;
  updateRule(ruleId: string, patch: Partial<Rule>): void;
  removeRule(ruleId: string): void;
  /**
   * ADR-172 §2: después de deshacer o rehacer, las reglas vuelven a ser las
   * del snapshot de Grouping (U-6) — el punto de restauración las incluye y
   * ningún evento las devuelve.
   */
  replaceRules(rules: ReadonlyArray<Rule>): void;
  reset(): void;
}

export const useRulesStore = create<RulesSlice>((set) => ({
  rules: [],
  addRule(rule) {
    set((state) => ({ rules: [...state.rules, rule] }));
  },
  updateRule(ruleId, patch) {
    set((state) => ({
      rules: state.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    }));
  },
  removeRule(ruleId) {
    set((state) => ({ rules: state.rules.filter((rule) => rule.id !== ruleId) }));
  },
  replaceRules(rules) {
    set({ rules: [...rules] });
  },
  reset() {
    set({ rules: [] });
  },
}));
