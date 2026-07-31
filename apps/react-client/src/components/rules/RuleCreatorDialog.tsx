/**
 * `RuleCreatorDialog` (`ui/Components.md` §4.3, `ui/UX_Guidelines.md` §4.1).
 *
 * Form: alcance (Global/Por tipo/Por grupo), tipo o grupo según alcance
 * (`RuleFormFields`), modo de reemplazo, prioridad (0-1000, default 100) y una
 * previsualización textual del efecto (`ruleDescription.ts`).
 *
 * Acción: `actions.createRule(rule)` → `RULE_CREATED`. `RULE_CREATED` es
 * estrictamente UI→Grouping Engine (`04_Event_System.md`: "RULE_CREATED | UI |
 * Grouping Engine | ... | none" — sin evento de vuelta que confirme la
 * regla), así que `actions.createRule` también puebla `rules.store`
 * directamente (ver el comentario en `core-adapter/actions.ts`); este
 * componente solo llama a la acción, nunca muta el store (`ui/Components.md`
 * §13 regla 2).
 */

import { EntityType, ReplacementMode, type RuleScope } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";

import { describeRuleEffectPreview } from "./ruleDescription.js";
import { RuleFormFields } from "./RuleFormFields.js";
import { ruleGroupOptions } from "./ruleGroupOptions.js";
import { buildRuleTarget, validateRuleForm, type RuleFormState } from "./ruleValidation.js";

const DEFAULT_PRIORITY = 100;

export interface RuleCreatorDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RuleCreatorDialog({ open, onClose }: RuleCreatorDialogProps) {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const groupOptions = ruleGroupOptions(groupsByType);

  const [scope, setScope] = useState<RuleScope>("global");
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [groupId, setGroupId] = useState<string | null>(groupOptions[0]?.id ?? null);
  const [mode, setMode] = useState<ReplacementMode>(ReplacementMode.Placeholder);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [error, setError] = useState<string | null>(null);

  // Re-sincroniza el formulario cada vez que se abre (mismo criterio que
  // `SettingsDialog`/`MergeDialog`/`SplitDialog`). Deps acotadas a `[open]`:
  // el repo no tiene `eslint-plugin-react-hooks` que exija la lista exhaustiva.
  useEffect(() => {
    if (!open) return;
    setScope("global");
    setEntityType(EntityType.Person);
    setGroupId(groupOptions[0]?.id ?? null);
    setMode(ReplacementMode.Placeholder);
    setPriority(DEFAULT_PRIORITY);
    setError(null);
  }, [open]);

  const form: RuleFormState = {
    scope,
    entityType: scope === "type" ? entityType : null,
    groupId: scope === "group" ? groupId : null,
    mode,
    priority,
  };
  const validation = validateRuleForm(form);
  const selectedGroupLabel = groupOptions.find((option) => option.id === groupId)?.label;

  function handleCreate(): void {
    const target = buildRuleTarget(form);
    if (target === null) {
      setError(validation.reason ?? "Datos de regla inválidos.");
      return;
    }
    const now = Date.now();
    actions.createRule({
      id: crypto.randomUUID(),
      scope,
      target,
      mode,
      priority,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nueva regla">
      <div className="flex flex-col gap-4">
        <RuleFormFields
          scope={scope}
          onScopeChange={setScope}
          entityType={entityType}
          onEntityTypeChange={setEntityType}
          groupId={groupId}
          onGroupIdChange={setGroupId}
          groupOptions={groupOptions}
          mode={mode}
          onModeChange={setMode}
          priority={priority}
          onPriorityChange={setPriority}
        />
        <p className="text-xs text-text-secondary">
          {describeRuleEffectPreview(
            { scope, mode },
            {
              entityTypeLabel: ENTITY_TYPE_LABEL[entityType],
              ...(selectedGroupLabel !== undefined ? { groupLabel: selectedGroupLabel } : {}),
            },
          )}
        </p>
        {error !== null ? (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" disabled={!validation.valid} onClick={handleCreate}>
          Crear
        </Button>
      </div>
    </Dialog>
  );
}
