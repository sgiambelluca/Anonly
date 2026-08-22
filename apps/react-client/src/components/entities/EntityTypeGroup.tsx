/**
 * `EntityTypeGroup` (`ui/Components.md` §3.2).
 *
 * Cabecera expandible con checkbox cascade (`cascadeCheckboxState`,
 * `entityTree.ts`) + `TypeModeSelect` (nivel tipo de ADR-087 §3) + lista de
 * `EntityGroupItem`. Click en la cabecera (o su
 * chevron) expande/colapsa; el estado de expansión lo controla `EntitiesPanel`
 * (para poder implementar "Colapsar todo"/"Expandir todo").
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Checkbox } from "../common/Checkbox.js";

import { applyEnabled } from "./applyEdits.js";
import { EntityGroupItem } from "./EntityGroupItem.js";
import { cascadeCheckboxState } from "./entityTree.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { groupNodeId } from "./treeNavigation.js";
import { TypeModeSelect } from "./TypeModeSelect.js";

export interface EntityTypeGroupProps {
  readonly type: EntityType;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Roving tabindex del árbol — ver la cabecera de `EntitiesPanel`. El foco
   * lo escucha el contenedor del árbol, no este componente. */
  readonly nodeId: string;
  readonly activeNodeId: string | null;
}

export function EntityTypeGroup({
  type,
  groups,
  expanded,
  onToggleExpanded,
  nodeId,
  activeNodeId,
}: EntityTypeGroupProps) {
  const cascadeState = cascadeCheckboxState(groups);

  function handleCascadeChange(checked: boolean): void {
    applyEnabled({
      groups,
      next: checked,
      label: ENTITY_TYPE_LABEL[type],
      isType: true,
    });
  }

  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-label={`${ENTITY_TYPE_LABEL[type]}, ${groups.length} grupos`}
      data-tree-node-id={nodeId}
      tabIndex={activeNodeId === nodeId ? 0 : -1}
      // Un click también mueve el nodo activo: si no, el foco por teclado
      // seguiría donde estaba y la flecha siguiente saltaría a otro lado.
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
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
        {/* Nivel tipo de los tres de `UX_Guidelines.md` §3.4 (ADR-087 §3). */}
        <TypeModeSelect type={type} groups={groups} />
      </div>
      {expanded ? (
        <div role="group">
          {groups.map((group) => (
            <EntityGroupItem
              key={group.id}
              group={group}
              nodeId={groupNodeId(group.id)}
              activeNodeId={activeNodeId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
