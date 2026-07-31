/**
 * `RuleItem` (`ui/Components.md` §4.2).
 *
 * Descripción legible vía `ruleDescription.ts#formatRuleDescription` ("DNI →
 * mask", "Juan Pérez → redact", "Modo default: placeholder" para
 * `scope === "global"`). Botones `[✎]` (`RuleEditorDialog`) y `[🗑]`
 * (`ConfirmDialog` → `actions.deleteRule`, que también quita la regla de
 * `rules.store` — ver `core-adapter/actions.ts`).
 *
 * Memoizado (`ui/Components.md` §13 regla 5), mismo criterio que
 * `entities/EntityGroupItem.tsx`.
 */

import type { Rule } from "@anonly/anonymization-core";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { memo, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { findGroupById } from "../entities/entityTree.js";

import { formatRuleDescription } from "./ruleDescription.js";
import { RuleEditorDialog } from "./RuleEditorDialog.js";

export interface RuleItemProps {
  readonly rule: Rule;
}

function RuleItemImpl({ rule }: RuleItemProps) {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const description = formatRuleDescription(
    rule,
    (groupId) => findGroupById(groupsByType, groupId)?.canonicalValue,
  );

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary">
      <span className="flex-1 truncate" title={description}>
        {description}
      </span>
      <button
        type="button"
        aria-label={`Editar regla: ${description}`}
        onClick={() => setEditOpen(true)}
        className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
      >
        <PencilIcon className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Eliminar regla: ${description}`}
        onClick={() => setConfirmOpen(true)}
        className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
      >
        <Trash2Icon className="h-4 w-4" aria-hidden />
      </button>
      <RuleEditorDialog ruleId={rule.id} open={editOpen} onClose={() => setEditOpen(false)} />
      <ConfirmDialog
        open={confirmOpen}
        title="Eliminar regla"
        message={`¿Eliminar la regla "${description}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          actions.deleteRule(rule.id);
        }}
      />
    </li>
  );
}

export const RuleItem = memo(RuleItemImpl);
