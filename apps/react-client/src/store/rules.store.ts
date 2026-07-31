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
  reset() {
    set({ rules: [] });
  },
}));
