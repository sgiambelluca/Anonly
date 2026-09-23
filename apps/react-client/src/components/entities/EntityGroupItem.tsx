/**
 * `EntityGroupItem` — una fila de la lista de entidades (`ui/Components.md`
 * §3.3, rediseñada por ADR-169 §2-§4).
 *
 * **Grilla de columnas de ancho fijo** (`entityRowLayout.ts`, UX-10):
 * casilla · N.º · nombre · avisos · apariciones · género · reemplazo · ⋯. Solo
 * el nombre encoge; nada que aparezca en la fila corre a otra columna.
 *
 * - **N.º** es `indexInType` con dos dígitos, el mismo número del token
 *   (`[PERSONA 04]`). No se muestra hasta `Ready` (ADR-087 §6.1): durante el
 *   escaneo cada entidad nueva renumera, y la columna sería el único lugar
 *   donde eso se vería.
 * - **Avisos** (ADR-169 §3): conflicto, sugerida y espacio justo, cada uno con
 *   forma y color propios.
 * - **Género** (ADR-169 §4): ranura siempre reservada; el botón aparece solo
 *   donde ADR-071 lo dice (`isPersonGenderToggleVisible`).
 * - **La fila con un menú abierto** (modo o ⋯) se resalta con fondo y
 *   contorno de acento: es la defensa contra editar la fila equivocada.
 * - **"Ver en la lista"** del toast de un agregado (ADR-169 §7) lleva la fila
 *   a la vista y la resalta un momento (`entities.store.flashGroupId`).
 *
 * El atenuado de un grupo deshabilitado va en las celdas de datos, no en la
 * fila entera: `opacity` de CSS alcanza a los descendientes, y los menús
 * flotantes quedarían ilegibles justo en una entidad apagada. La fila
 * sugerida no se atenúa (ADR-094 §4, `needsReviewRow.ts`).
 *
 * Memoizado (`ui/Components.md` §13 regla 5).
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { memo, useEffect, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConflictBadge } from "../conflicts/ConflictBadge.js";

import { applyEnabled } from "./applyEdits.js";
import { ChangeTypeDialog } from "./ChangeTypeDialog.js";
import { DegradedBadge } from "./DegradedBadge.js";
import { EditReplacementDialog } from "./EditReplacementDialog.js";
import { ENTITY_ROW_GRID, ENTITY_ROW_PADDING } from "./entityRowLayout.js";
import { isIndexInTypeVisible } from "./entityTree.js";
import { ENTITY_TYPE_SINGULAR, formatIndexInType } from "./entityTypeLabels.js";
import { GroupContextMenu } from "./GroupContextMenu.js";
import { MergeDialog } from "./MergeDialog.js";
import { NeedsReviewBadge } from "./NeedsReviewBadge.js";
import { buildTreeItemAriaLabel, isRowDimmed } from "./needsReviewRow.js";
import { PersonGenderToggle } from "./PersonGenderToggle.js";
import { isPersonGenderToggleVisible } from "./personGenderVisibility.js";
import { ReplacementModeSelect } from "./ReplacementModeSelect.js";
import { SplitDialog } from "./SplitDialog.js";

/** Cuánto dura el resaltado de "Ver en la lista". */
const FLASH_MS = 1600;

export interface EntityGroupItemProps {
  readonly group: EntityGroup;
  /** Roving tabindex del árbol — ver la cabecera de `EntitiesPanel`. */
  readonly nodeId: string;
  readonly activeNodeId: string | null;
}

function EntityGroupItemImpl({ group, nodeId, activeNodeId }: EntityGroupItemProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.groupId === group.id && !candidate.resolved),
  );
  const flashing = useEntitiesStore((state) => state.flashGroupId === group.id);
  const showIndex = usePipelineStore((state) => isIndexInTypeVisible(state.stage));
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [changeTypeOpen, setChangeTypeOpen] = useState(false);
  const [editReplacementOpen, setEditReplacementOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!flashing) return;
    rowRef.current?.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => {
      useEntitiesStore.getState().setFlashGroupId(null);
    }, FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashing]);

  const menuOpen = modeMenuOpen || actionsMenuOpen;
  const dim = isRowDimmed(group) ? "opacity-50" : "";

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-checked={group.enabled}
      aria-label={buildTreeItemAriaLabel(group)}
      data-tree-node-id={nodeId}
      tabIndex={activeNodeId === nodeId ? 0 : -1}
      className={`relative h-[42px] border-b border-border last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${ENTITY_ROW_GRID} ${ENTITY_ROW_PADDING} ${
        menuOpen
          ? "bg-accent/10 shadow-[inset_0_0_0_1.5px_rgb(var(--color-accent))]"
          : "bg-bg-primary hover:bg-bg-secondary"
      } ${flashing ? "anonly-flash" : ""}`}
    >
      <Checkbox
        checked={group.enabled}
        onCheckedChange={(checked) =>
          applyEnabled({
            groups: [group],
            next: checked,
            label: group.canonicalValue,
            isType: false,
          })
        }
        aria-label={`Habilitar ${group.canonicalValue}`}
      />
      <span
        className={`text-sm tabular-nums text-text-secondary ${dim}`}
        title={
          showIndex
            ? `${ENTITY_TYPE_SINGULAR[group.type]} N.º ${formatIndexInType(group.indexInType)}`
            : undefined
        }
      >
        {showIndex ? formatIndexInType(group.indexInType) : ""}
      </span>
      <span className={`flex min-w-0 items-center gap-1.5 ${dim}`}>
        <span className="truncate text-sm text-text-primary" title={group.canonicalValue}>
          {group.canonicalValue}
        </span>
        {group.replacementValueUserSet ? (
          <span
            role="img"
            aria-label="Valor de reemplazo editado manualmente"
            title="Valor de reemplazo editado manualmente"
            className="h-2 w-2 shrink-0 rounded-full bg-accent"
          />
        ) : null}
      </span>
      {/* Avisos: columna de 52 px; dos juntos entran sin correr nada (UX-10). */}
      <span className="flex min-w-0 items-center gap-1">
        {conflict !== undefined ? <ConflictBadge conflictId={conflict.id} /> : null}
        {/*
          ADR-094 §4 y ADR-062: los dos se montan siempre y deciden solos si
          hay algo que mostrar (sugerida por `needsReview`, espacio justo por
          el veredicto por página de `degraded.store`).
        */}
        <NeedsReviewBadge group={group} />
        <DegradedBadge group={group} onEditReplacement={() => setEditReplacementOpen(true)} />
      </span>
      <span
        className={`text-right text-sm tabular-nums text-text-secondary ${dim}`}
        title="Apariciones en el documento"
      >
        {group.members.length}
      </span>
      {/* Ranura de género siempre reservada (ADR-169 §4). */}
      <span className={`flex justify-center ${dim}`}>
        {isPersonGenderToggleVisible(group) ? (
          <PersonGenderToggle groupId={group.id} currentGender={group.personGender} />
        ) : null}
      </span>
      <ReplacementModeSelect group={group} onOpenChange={setModeMenuOpen} />
      <GroupContextMenu
        onOpenChange={setActionsMenuOpen}
        onMerge={() => setMergeOpen(true)}
        onSplit={() => setSplitOpen(true)}
        {...(group.replacementMode === ReplacementMode.Redact
          ? {}
          : { onEditReplacement: () => setEditReplacementOpen(true) })}
        // ADR-084 §2: escribir la consulta es TODO lo que hace falta — la
        // lupa reacciona por el camino que ya tiene (busca, cuenta y lista).
        onViewOccurrences={() => {
          // `getState()` y NO un selector que construya su valor: zustand
          // compara el snapshot con `Object.is`, y una referencia nueva por
          // llamada deja la UI en un loop de render.
          useViewerStore.getState().setSearchQuery(group.canonicalValue);
        }}
        onChangeType={() => setChangeTypeOpen(true)}
        {...(group.replacementValueUserSet
          ? {
              // ADR-078 §3: re-aplicar el MISMO `replacementMode` recalcula el
              // valor y apaga el flag (ADR-076 §4 fila 4). Sin API nueva.
              onRestoreComputedValue: () => {
                actions.updateGroup(group.id, { replacementMode: group.replacementMode });
              },
            }
          : {})}
      />
      <MergeDialog sourceGroupId={group.id} open={mergeOpen} onClose={() => setMergeOpen(false)} />
      <SplitDialog groupId={group.id} open={splitOpen} onClose={() => setSplitOpen(false)} />
      <EditReplacementDialog
        group={group}
        open={editReplacementOpen}
        onClose={() => setEditReplacementOpen(false)}
      />
      <ChangeTypeDialog
        groupId={group.id}
        currentType={group.type}
        canonicalValue={group.canonicalValue}
        open={changeTypeOpen}
        onClose={() => setChangeTypeOpen(false)}
      />
    </div>
  );
}

export const EntityGroupItem = memo(EntityGroupItemImpl);
