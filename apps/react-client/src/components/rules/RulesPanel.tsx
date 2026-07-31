/**
 * `RulesPanel` (`ui/Components.md` §4.1).
 *
 * Tres secciones fijas (Global / Por tipo / Por grupo, `ui/UX_Guidelines.md`
 * §4) + botón "+ Nueva regla". Estado vacío: "Aún no hay reglas…"
 * (`ui/UX_Guidelines.md` §11).
 *
 * A diferencia de `EntitiesPanel` (que `App.tsx` monta condicionalmente
 * detrás de un placeholder externo), este panel se monta siempre: el botón
 * "+ Nueva regla" y el estado vacío son parte de su propio spec (§4.1 los
 * documenta como parte del componente, no como un toggle a nivel `App.tsx`) y
 * tienen que estar visibles incluso con 0 reglas para que el usuario pueda
 * crear la primera.
 */

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useRulesStore } from "../../store/rules.store.js";

import { RuleCreatorDialog } from "./RuleCreatorDialog.js";
import { groupRulesByScope, type RulesByScope } from "./ruleGrouping.js";
import { RuleItem } from "./RuleItem.js";

const SCOPE_SECTION_TITLE: Readonly<Record<keyof RulesByScope, string>> = {
  global: "Global",
  type: "Por tipo",
  group: "Por grupo",
};

const SCOPE_SECTION_ORDER: ReadonlyArray<keyof RulesByScope> = ["global", "type", "group"];

export function RulesPanel() {
  const rules = useRulesStore((state) => state.rules);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const grouped = groupRulesByScope(rules);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Reglas
        </h2>
        <button
          type="button"
          onClick={() => setCreatorOpen(true)}
          className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Nueva regla
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <p className="p-4 text-center text-xs text-text-secondary">
            Aún no hay reglas. Creá una con &quot;+ Nueva regla&quot;.
          </p>
        ) : (
          SCOPE_SECTION_ORDER.map((key) =>
            grouped[key].length === 0 ? null : (
              <section key={key}>
                <h3 className="border-b border-border bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary">
                  {SCOPE_SECTION_TITLE[key]}
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {grouped[key].map((rule) => (
                    <RuleItem key={rule.id} rule={rule} />
                  ))}
                </ul>
              </section>
            ),
          )
        )}
      </div>
      <RuleCreatorDialog open={creatorOpen} onClose={() => setCreatorOpen(false)} />
    </div>
  );
}
