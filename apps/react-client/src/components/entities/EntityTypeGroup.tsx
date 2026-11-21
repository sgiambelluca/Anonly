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

import type {
  EntityGroup,
  EntityTypeId,
  UserEntityTypeDefinition,
} from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "../common/Checkbox.js";

import { applyEnabled } from "./applyEdits.js";
import {
  EMPTY_TYPE_ACTION,
  EMPTY_TYPE_TEXT,
  SAVED_CAPTION,
  SAVED_CAPTION_TOOLTIP,
} from "./documentTypeCopy.js";
import { DocumentTypeMenu } from "./DocumentTypeMenu.js";
import { EntityGroupItem } from "./EntityGroupItem.js";
import { cascadeCheckboxState, type TypeLevels } from "./entityTree.js";
import { typeBandTint } from "./entityTypeColors.js";
import { typePlural } from "./entityTypeLabels.js";
import { FormatSubgroup } from "./FormatSubgroup.js";
import { groupNodeId } from "./treeNavigation.js";
import { TypeDot } from "./TypeDot.js";
import { TypeModeSelect } from "./TypeModeSelect.js";
import { useUserTypes } from "./useUserTypes.js";

/**
 * Lo que sabe la banda de un tipo propio (`Components.md` §13b.6): su leyenda
 * («solo en este documento» / «guardado») y, **solo si es del documento y no se
 * guardó**, las acciones de su menú ⋯.
 */
export interface OwnTypeBand {
  readonly definition: UserEntityTypeDefinition;
  readonly documentOnly: boolean;
  readonly caption: string | null;
  readonly onEdit: () => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
}

export interface EntityTypeGroupProps {
  readonly type: EntityTypeId;
  /** Los grupos a la vista, ya filtrados. */
  readonly groups: ReadonlyArray<EntityGroup>;
  /** Los mismos grupos repartidos en niveles (subnivel por formato del usuario, ADR-226 §2). */
  readonly levels: TypeLevels;
  /** El nombre de un formato del usuario, para el encabezado de su subnivel. */
  readonly formatName: (formatId: string) => string;
  /** Presente en un tipo propio. */
  readonly ownType?: OwnTypeBand;
  /** «Agregar entidad» de la fila de un tipo del documento todavía sin entidades. */
  readonly onAddEntity?: () => void;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  /** Roving tabindex del árbol — ver la cabecera de `EntitiesPanel`. */
  readonly nodeId: string;
  readonly activeNodeId: string | null;
}

export function EntityTypeGroup({
  type,
  groups,
  levels,
  formatName,
  ownType,
  onAddEntity,
  expanded,
  onToggleExpanded,
  nodeId,
  activeNodeId,
}: EntityTypeGroupProps) {
  const cascadeState = cascadeCheckboxState(groups);
  const label = typePlural(type, useUserTypes());
  const empty = groups.length === 0;
  // Con el menú del tipo abierto, la franja sube de capa: es `sticky`, y el
  // menú quedaría debajo de las franjas siguientes.
  const [menuOpen, setMenuOpen] = useState(false);

  function handleCascadeChange(checked: boolean): void {
    applyEnabled({
      groups,
      next: checked,
      label,
      isType: true,
    });
  }

  function renderRow(group: EntityGroup) {
    return (
      <EntityGroupItem
        key={group.id}
        group={group}
        nodeId={groupNodeId(group.id)}
        activeNodeId={activeNodeId}
      />
    );
  }

  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-label={`${label}, ${groups.length} grupos`}
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
          aria-label={expanded ? `Colapsar ${label}` : `Expandir ${label}`}
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
          disabled={empty}
          aria-label={`Habilitar todos los grupos de ${label}`}
        />
        {/* Punto hueco para un tipo propio; punteado si es solo de este documento (Components.md §9). */}
        <TypeDot type={type} documentOnly={ownType?.documentOnly === true} />
        <button
          type="button"
          onClick={onToggleExpanded}
          // Mismo nombre accesible que antes del rediseño ("Personas (3)"):
          // lo localiza `scenario-5` de E2E.
          aria-label={`${label} (${groups.length})`}
          className={`flex min-w-0 flex-1 text-left ${
            ownType?.caption != null ? "flex-col justify-center" : "items-center gap-2"
          }`}
        >
          {/* El nombre va primero y entero; la leyenda y el contador pasan a la segunda línea de la franja. */}
          <span className="truncate text-sm font-bold uppercase tracking-wide text-text-primary">
            {label}
          </span>
          {ownType?.caption != null ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 rounded-full border border-border bg-bg-primary px-1.5 text-xs font-semibold leading-4 text-text-primary">
                {groups.length}
              </span>
              <span
                title={ownType.caption === SAVED_CAPTION ? SAVED_CAPTION_TOOLTIP : ownType.caption}
                className="min-w-0 truncate text-xs font-normal normal-case leading-4 tracking-normal text-text-secondary"
              >
                {ownType.caption}
              </span>
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-border bg-bg-primary px-2 text-sm font-semibold text-text-primary">
              {groups.length}
            </span>
          )}
        </button>
        {/* Nivel tipo de los tres de `UX_Guidelines.md` §3.4 (ADR-087 §3). */}
        <TypeModeSelect type={type} groups={groups} onOpenChange={setMenuOpen} />
        {/* El ⋯ ocupa el hueco que la franja deja a la derecha (mr-8 de TypeModeSelect). */}
        {ownType?.documentOnly === true ? (
          <div className="absolute right-2 top-1/2 w-7 -translate-y-1/2">
            <DocumentTypeMenu
              typeName={ownType.definition.name}
              onEdit={ownType.onEdit}
              onSave={ownType.onSave}
              onDelete={ownType.onDelete}
              onOpenChange={setMenuOpen}
            />
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div role="group">
          {empty ? (
            // Un tipo del documento sin entidades (UX_Guidelines.md §11b.15): alto fijo.
            <div className="flex h-[58px] items-center gap-3 border-b border-border bg-bg-primary pl-9 pr-3">
              <span className="line-clamp-2 min-w-0 flex-1 text-sm text-text-secondary">
                {EMPTY_TYPE_TEXT}
              </span>
              {onAddEntity !== undefined ? (
                <button
                  type="button"
                  onClick={onAddEntity}
                  className="h-8 shrink-0 rounded-md border border-accent px-2.5 text-sm font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {EMPTY_TYPE_ACTION}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {levels.direct.map(renderRow)}
              {levels.subgroups.map((subgroup) => (
                <FormatSubgroup
                  key={subgroup.formatId}
                  name={formatName(subgroup.formatId)}
                  count={subgroup.groups.length}
                >
                  {subgroup.groups.map(renderRow)}
                </FormatSubgroup>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
