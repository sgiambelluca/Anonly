/**
 * `EntityGroupItem` (`ui/Components.md` §3.3).
 *
 * Render: checkbox + `canonicalValue` + badge de ocurrencias +
 * `ReplacementModeSelect` + acceso a fusionar/dividir (`GroupContextMenu`,
 * alcance reducido — ver esa nota ahí). Estados: habilitado/deshabilitado
 * (opacidad), con conflicto (`ConflictBadge` si hay un `Conflict` no resuelto
 * para este grupo), y sobre grupos `Person` el selector de género + su marca
 * de "sin determinar" (ADR-060 §5/§6, Hito 10.6 PR 12).
 *
 * Fuera de alcance de este PR (ver reporte): popover de aliases + edición
 * inline de `canonicalValue` (`ui/Components.md` §3.3 "Click canonicalValue →
 * popover...") y el indicador de "editado manualmente" (punto azul,
 * `ui/UX_Guidelines.md` §3.3) — este último no es derivable en la UI sin
 * re-implementar la resolución de reglas del Grouping Engine (`EntityGroup`
 * no expone ese dato, `03_Data_Model.md` §9).
 *
 * Memoizado (`ui/Components.md` §13 regla 5: "React.memo en items de lista
 * larga").
 */

import type { EntityGroup } from "@anonly/anonymization-core";
import { memo, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConflictBadge } from "../conflicts/ConflictBadge.js";

import { GroupContextMenu } from "./GroupContextMenu.js";
import { MergeDialog } from "./MergeDialog.js";
import { PersonGenderSelect } from "./PersonGenderSelect.js";
import { PersonGenderUndeterminedBadge } from "./PersonGenderUndeterminedBadge.js";
import {
  isPersonGenderSelectVisible,
  isPersonGenderUndeterminedMarkVisible,
} from "./personGenderVisibility.js";
import { ReplacementModeSelect } from "./ReplacementModeSelect.js";
import { SplitDialog } from "./SplitDialog.js";

export interface EntityGroupItemProps {
  readonly group: EntityGroup;
}

function EntityGroupItemImpl({ group }: EntityGroupItemProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.groupId === group.id && !candidate.resolved),
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  // Levantado acá (y no dentro de `PersonGenderSelect`) porque
  // `PersonGenderUndeterminedBadge` es un hermano, no un padre/hijo: es la
  // única forma de que el click de uno abra el desplegable del otro.
  const [genderSelectOpen, setGenderSelectOpen] = useState(false);

  return (
    <div
      role="treeitem"
      aria-checked={group.enabled}
      aria-label={`${group.canonicalValue}, ${group.members.length} ocurrencias, ${
        group.enabled ? "habilitado" : "deshabilitado"
      }`}
      className={`flex items-center gap-2 py-1 pl-8 pr-2 ${group.enabled ? "" : "opacity-50"}`}
    >
      <Checkbox
        checked={group.enabled}
        onCheckedChange={(checked) => actions.updateGroup(group.id, { enabled: checked })}
        aria-label={`Habilitar ${group.canonicalValue}`}
      />
      <span className="flex-1 truncate text-sm text-text-primary" title={group.canonicalValue}>
        {group.canonicalValue}
      </span>
      <span className="text-xs text-text-secondary">({group.members.length})</span>
      {conflict !== undefined ? <ConflictBadge conflictId={conflict.id} /> : null}
      {isPersonGenderUndeterminedMarkVisible(group) ? (
        <PersonGenderUndeterminedBadge onOpenSelect={() => setGenderSelectOpen(true)} />
      ) : null}
      {isPersonGenderSelectVisible(group.type) ? (
        <PersonGenderSelect
          groupId={group.id}
          currentGender={group.personGender}
          open={genderSelectOpen}
          onOpenChange={setGenderSelectOpen}
        />
      ) : null}
      <ReplacementModeSelect groupId={group.id} currentMode={group.replacementMode} />
      <GroupContextMenu onMerge={() => setMergeOpen(true)} onSplit={() => setSplitOpen(true)} />
      <MergeDialog sourceGroupId={group.id} open={mergeOpen} onClose={() => setMergeOpen(false)} />
      <SplitDialog groupId={group.id} open={splitOpen} onClose={() => setSplitOpen(false)} />
    </div>
  );
}

export const EntityGroupItem = memo(EntityGroupItemImpl);
