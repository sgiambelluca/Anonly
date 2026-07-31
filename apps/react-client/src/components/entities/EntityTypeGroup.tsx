/**
 * `EntityTypeGroup` (`ui/Components.md` §3.2).
 *
 * Cabecera expandible con checkbox cascade (`cascadeCheckboxState`,
 * `entityTree.ts`) + lista de `EntityGroupItem`. Click en la cabecera (o su
 * chevron) expande/colapsa; el estado de expansión lo controla `EntitiesPanel`
 * (para poder implementar "Colapsar todo"/"Expandir todo").
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { actions } from "../../core-adapter/actions.js";
import { Checkbox } from "../common/Checkbox.js";

import { EntityGroupItem } from "./EntityGroupItem.js";
import { cascadeCheckboxState } from "./entityTree.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";

export interface EntityTypeGroupProps {
  readonly type: EntityType;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
}

export function EntityTypeGroup({
  type,
  groups,
  expanded,
  onToggleExpanded,
}: EntityTypeGroupProps) {
  const cascadeState = cascadeCheckboxState(groups);

  function handleCascadeChange(checked: boolean): void {
    for (const group of groups) {
      actions.updateGroup(group.id, { enabled: checked });
    }
  }

  return (
    <div role="treeitem" aria-expanded={expanded}>
      <div className="flex items-center gap-2 border-b border-border bg-bg-secondary px-2 py-1.5">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={
            expanded ? `Colapsar ${ENTITY_TYPE_LABEL[type]}` : `Expandir ${ENTITY_TYPE_LABEL[type]}`
          }
          className="text-text-secondary"
        >
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRightIcon className="h-4 w-4" aria-hidden />
          )}
        </button>
        <Checkbox
          checked={cascadeState}
          onCheckedChange={handleCascadeChange}
          aria-label={`Habilitar todos los grupos de ${ENTITY_TYPE_LABEL[type]}`}
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex-1 text-left text-sm font-medium text-text-primary"
        >
          {ENTITY_TYPE_LABEL[type]} ({groups.length})
        </button>
      </div>
      {expanded ? (
        <div role="group">
          {groups.map((group) => (
            <EntityGroupItem key={group.id} group={group} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
