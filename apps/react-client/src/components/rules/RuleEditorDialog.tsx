/**
 * `RuleEditorDialog` (`ui/Components.md` §4.4).
 *
 * Props: `ruleId` (+ `open`/`onClose` levantados al llamador, mismo patrón
 * que el resto de los diálogos del repo). Comparte campos con
 * `RuleCreatorDialog` vía `RuleFormFields`.
 *
 * No expone edición de `enabled`: ni `ui/Components.md` §4.4 ni el mockup de
 * `ui/UX_Guidelines.md` §4 documentan un toggle de habilitado para reglas (a
 * diferencia de `EntityGroup.enabled`, que sí tiene checkbox propio en
 * `EntityGroupItem`) — mismo criterio de alcance reducido que
 * `entities/GroupContextMenu.tsx`.
 *
 * Acción: `actions.updateRule(ruleId, patch)` → `RULE_UPDATED` (también
 * puebla `rules.store` — ver nota en `core-adapter/actions.ts`).
 */

import { EntityType, ReplacementMode, type RuleScope } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { useRulesStore } from "../../store/rules.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";

import { describeRuleEffectPreview } from "./ruleDescription.js";
import { RuleFormFields } from "./RuleFormFields.js";
import { ruleGroupOptions } from "./ruleGroupOptions.js";
import { buildRuleTarget, validateRuleForm, type RuleFormState } from "./ruleValidation.js";

export interface RuleEditorDialogProps {
  readonly ruleId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RuleEditorDialog({ ruleId, open, onClose }: RuleEditorDialogProps) {
  const rule = useRulesStore((state) => state.rules.find((candidate) => candidate.id === ruleId));
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const groupOptions = ruleGroupOptions(groupsByType);

  const [scope, setScope] = useState<RuleScope>(rule?.scope ?? "global");
  const [entityType, setEntityType] = useState<EntityType>(
    rule?.target.entityType ?? EntityType.Person,
  );
  const [groupId, setGroupId] = useState<string | null>(
    rule?.target.groupId ?? groupOptions[0]?.id ?? null,
  );
  const [mode, setMode] = useState<ReplacementMode>(rule?.mode ?? ReplacementMode.Placeholder);
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [error, setError] = useState<string | null>(null);

  // Re-sincroniza el formulario con la regla vigente cada vez que se abre
  // (mismo criterio que `MergeDialog`/`SplitDialog`/`ConflictDialog`). Deps
  // acotadas a `[open, ruleId]`: el repo no tiene `eslint-plugin-react-hooks`
  // que exija la lista exhaustiva.
  useEffect(() => {
    if (!open || rule === undefined) return;
    setScope(rule.scope);
    setEntityType(rule.target.entityType ?? EntityType.Person);
    setGroupId(rule.target.groupId ?? groupOptions[0]?.id ?? null);
    setMode(rule.mode);
    setPriority(rule.priority);
    setError(null);
  }, [open, ruleId]);

  if (rule === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Editar regla">
        <p className="text-sm text-text-secondary">Esta regla ya no está disponible.</p>
      </Dialog>
    );
  }

  const form: RuleFormState = {
    scope,
    entityType: scope === "type" ? entityType : null,
    groupId: scope === "group" ? groupId : null,
    mode,
    priority,
  };
  const validation = validateRuleForm(form);
  const selectedGroupLabel = groupOptions.find((option) => option.id === groupId)?.label;

  // Arrow function, no `function` declaration: preserva el narrowing de
  // `rule` (por el `if` de arriba) — ver la nota equivalente en
  // `entities/MergeDialog.tsx`.
  const handleSave = (): void => {
    const target = buildRuleTarget(form);
    if (target === null) {
      setError(validation.reason ?? "Datos de regla inválidos.");
      return;
    }
    actions.updateRule(rule.id, { scope, target, mode, priority, updatedAt: Date.now() });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Editar regla">
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
        <Button variant="primary" disabled={!validation.valid} onClick={handleSave}>
          Guardar
        </Button>
      </div>
    </Dialog>
  );
}
