/**
 * `EntityGroupItem` (`ui/Components.md` §3.3, marca de sugerido por §3.4d).
 *
 * Render: checkbox + `canonicalValue` + badge de ocurrencias +
 * `ReplacementModeSelect` + acceso a fusionar/dividir (`GroupContextMenu`,
 * alcance reducido — ver esa nota ahí). Estados: habilitado/deshabilitado
 * (opacidad — pero no sobre un grupo "sugerido" pendiente de revisión,
 * `needsReviewRow.ts`, ADR-094 §4), con conflicto (`ConflictBadge` si hay un
 * `Conflict` no resuelto para este grupo), sugerido (`NeedsReviewBadge`,
 * ADR-094 §4), y sobre grupos `Person` en modo `placeholder`/`synthetic` el
 * `PersonGenderToggle`, cuyo estado neutro **es** la marca de "género sin
 * determinar" (ADR-060 §5/§6 rediseñados por ADR-071 §1-§4).
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

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { memo, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConflictBadge } from "../conflicts/ConflictBadge.js";

import { applyEnabled } from "./applyEdits.js";
import { ChangeTypeDialog } from "./ChangeTypeDialog.js";
import { DegradedBadge } from "./DegradedBadge.js";
import { EditReplacementDialog } from "./EditReplacementDialog.js";
import { GroupContextMenu } from "./GroupContextMenu.js";
import { MergeDialog } from "./MergeDialog.js";
import { NeedsReviewBadge } from "./NeedsReviewBadge.js";
import { buildTreeItemAriaLabel, isRowDimmed } from "./needsReviewRow.js";
import { PersonGenderToggle } from "./PersonGenderToggle.js";
import { isPersonGenderToggleVisible } from "./personGenderVisibility.js";
import { ReplacementModeSelect } from "./ReplacementModeSelect.js";
import { SplitDialog } from "./SplitDialog.js";

export interface EntityGroupItemProps {
  readonly group: EntityGroup;
  /** Roving tabindex del árbol — ver la cabecera de `EntitiesPanel`. El foco
   * lo escucha el contenedor del árbol, no este componente. */
  readonly nodeId: string;
  readonly activeNodeId: string | null;
}

function EntityGroupItemImpl({ group, nodeId, activeNodeId }: EntityGroupItemProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.groupId === group.id && !candidate.resolved),
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [changeTypeOpen, setChangeTypeOpen] = useState(false);
  const [editReplacementOpen, setEditReplacementOpen] = useState(false);

  return (
    <div
      role="treeitem"
      aria-checked={group.enabled}
      aria-label={buildTreeItemAriaLabel(group)}
      data-tree-node-id={nodeId}
      tabIndex={activeNodeId === nodeId ? 0 : -1}
      /*
       * El atenuado va en los hijos MENOS el último, que es
       * `GroupContextMenu`. Puesto en la fila entera —como estaba— el panel
       * del menú lo heredaba y quedaba ilegible justo cuando más se necesita:
       * en una entidad apagada, que es donde el usuario va a buscar
       * "fusionar" o "dividir". `opacity` de CSS alcanza a todos los
       * descendientes y un hijo no puede recuperarse, así que no hay forma de
       * excluirlo desde adentro.
       *
       * Ese menú no puede usar un portal para escaparse: es un disclosure
       * hecho a mano porque `@radix-ui/react-dropdown-menu` no está en el
       * proyecto y agregarlo pediría ADR (P-9). Ver su docblock.
       */
      className={`flex items-center gap-2 py-1 pl-8 pr-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isRowDimmed(group) ? "[&>*:not(:last-child)]:opacity-50" : ""}`}
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
      {/*
        `flex-[2]` contra el `flex-1` del selector de modo (ADR-087, Contexto
        §1 hallazgo 2): con el nombre en `flex-1 truncate` y el selector en
        `shrink-0`, **el nombre absorbía todo el encogido** — a 900 px de
        ventana las filas decían "Juan …" y "Carlo…" mientras el dropdown
        conservaba su ancho entero. Es la jerarquía exactamente al revés: el
        nombre es el dato con el que el usuario decide, el modo es el control
        que en la mayoría de las filas ni toca. Ahora los dos encogen, y el
        nombre se queda con el doble.
      */}
      <span
        className="min-w-0 flex-[2] truncate text-sm text-text-primary"
        title={group.canonicalValue}
      >
        {group.canonicalValue}
      </span>
      <span className="shrink-0 text-sm text-text-secondary">({group.members.length})</span>
      {group.replacementValueUserSet ? (
        <span
          role="img"
          aria-label="Valor de reemplazo editado manualmente"
          title="Valor de reemplazo editado manualmente"
          className="h-2 w-2 shrink-0 rounded-full bg-accent"
        />
      ) : null}
      {conflict !== undefined ? <ConflictBadge conflictId={conflict.id} /> : null}
      {/*
        ADR-062: el aviso de "el reemplazo no entró y se encogió". Se monta
        siempre y el propio badge decide si hay algo que mostrar (no renderiza
        nada sin veredicto), porque el dato vive por página en `degraded.store`
        y no en el `EntityGroup`.
      */}
      <DegradedBadge group={group} onEditReplacement={() => setEditReplacementOpen(true)} />
      {/*
        ADR-094 §4: la marca del grupo "sugerido" — creado por el detector
        sin estar seguro, apagado y visible en vez de descartado en
        silencio. Se monta siempre y el propio badge decide si hay algo que
        mostrar (no renderiza nada sin `needsReview`).
      */}
      <NeedsReviewBadge group={group} />
      {isPersonGenderToggleVisible(group) ? (
        <PersonGenderToggle groupId={group.id} currentGender={group.personGender} />
      ) : null}
      <ReplacementModeSelect group={group} />
      <GroupContextMenu
        onMerge={() => setMergeOpen(true)}
        onSplit={() => setSplitOpen(true)}
        {...(group.replacementMode === ReplacementMode.Redact
          ? {}
          : { onEditReplacement: () => setEditReplacementOpen(true) })}
        // ADR-084 §2: escribir la consulta es TODO lo que hace falta — el
        // `DocumentSearchBox` reacciona por el camino que ya tiene (busca,
        // cuenta, y deja anterior/siguiente listos para recorrer el
        // documento). No se construye una segunda UI de navegación.
        onViewOccurrences={() => {
          // `getState()` y NO un selector: un selector que construye su valor
          // devuelve una referencia nueva por llamada, y zustand compara el
          // snapshot con `Object.is` -> `useSyncExternalStore` ve un cambio en
          // cada render -> loop infinito -> UI en blanco. Mismo idioma que
          // `ZoomControls`/`PdfViewer`/`DocumentSearchBox`.
          useViewerStore.getState().setSearchQuery(group.canonicalValue);
        }}
        onChangeType={() => setChangeTypeOpen(true)}
        {...(group.replacementValueUserSet
          ? {
              // ADR-078 §3: "restaurar" no necesita API nueva — re-aplicar el
              // MISMO `replacementMode` recalcula el valor y apaga el flag
              // (rama de modo de `applyGroupUpdate`, ADR-076 §4 fila 4). El
              // flag es de solo lectura: no entra en `GroupUpdatePatch`.
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
