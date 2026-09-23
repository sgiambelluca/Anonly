/**
 * `EntityTypeGroup` (`ui/Components.md` §3.2, franja por ADR-169 §2).
 *
 * **Franja de tipo**: fondo gris con apenas el color del tipo encima (6 % en
 * claro, 7 % en oscuro), bordes superior e inferior gruesos
 * (`--color-border-strong`), nombre en mayúsculas y contador en pastilla.
 * **Queda fija arriba** (`sticky`) mientras se recorren sus filas. En las
 * pruebas de usuario la lista no distinguía un tipo de sus filas; la franja es
 * la respuesta.
 *
 * Checkbox cascade (`cascadeCheckboxState`, `entityTree.ts`) + `TypeModeSelect`
 * (nivel tipo de ADR-087 §3). Click en la franja expande/colapsa; el estado de
 * expansión lo controla `EntitiesPanel` ("Colapsar todo"/"Expandir todo").
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "../common/Checkbox.js";

import { applyEnabled } from "./applyEdits.js";
import { EntityGroupItem } from "./EntityGroupItem.js";
import { cascadeCheckboxState } from "./entityTree.js";
import { ENTITY_TYPE_COLOR, typeBandTint } from "./entityTypeColors.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { groupNodeId } from "./treeNavigation.js";
import { TypeModeSelect } from "./TypeModeSelect.js";

export interface EntityTypeGroupProps {
  readonly type: EntityType;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Roving tabindex del árbol — ver la cabecera de `EntitiesPanel`. */
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
  const color = ENTITY_TYPE_COLOR[type];
  // Con el menú del tipo abierto, la franja sube de capa: es `sticky`, y el
  // menú quedaría debajo de las franjas siguientes.
  const [menuOpen, setMenuOpen] = useState(false);

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
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <div
        // Franja: `bg-tertiary` con el color del tipo al 6 % (7 % en oscuro,
        // `typeBandTint`). `sticky` para que el tipo siga a la vista mientras
        // se recorren sus filas.
        className={`sticky top-0 ${menuOpen ? "z-30" : "z-10"} flex h-[42px] items-center gap-2 border-y-[1.5px] border-border-strong bg-bg-tertiary pl-2 pr-2`}
        style={{ backgroundImage: typeBandTint(type) }}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={
            expanded ? `Colapsar ${ENTITY_TYPE_LABEL[type]}` : `Expandir ${ENTITY_TYPE_LABEL[type]}`
          }
          className="rounded text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <button
          type="button"
          onClick={onToggleExpanded}
          // Mismo nombre accesible que antes del rediseño ("Personas (3)"):
          // lo localiza `scenario-5` de E2E.
          aria-label={`${ENTITY_TYPE_LABEL[type]} (${groups.length})`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="truncate text-sm font-bold uppercase tracking-wide text-text-primary">
            {ENTITY_TYPE_LABEL[type]}
          </span>
          <span className="shrink-0 rounded-full border border-border bg-bg-primary px-2 text-sm font-semibold text-text-primary">
            {groups.length}
          </span>
        </button>
        {/* Nivel tipo de los tres de `UX_Guidelines.md` §3.4 (ADR-087 §3). */}
        <TypeModeSelect type={type} groups={groups} onOpenChange={setMenuOpen} />
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
