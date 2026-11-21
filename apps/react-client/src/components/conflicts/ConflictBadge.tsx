/**
 * `ConflictBadge` (`ui/Components.md` §6.1, `ui/UX_Guidelines.md` §3.3:
 * "Grupo con conflicto: icono ⚠ al lado del nombre. Click abre el
 * conflicto."; ADR-175 §4).
 *
 * Render: icono ⚠ con tooltip "Conflicto". Click: si la fila tiene
 * conflictos `heldManual` sin resolver (ADR-174 §1: una ocurrencia manual
 * perdió una superposición y quedó retenida), abre `ManualOverlapDialog`
 * (`Components.md` §6.3) con **todos** los de esa fila — vía
 * `manualOverlapController.ts`, el mismo diálogo global que abren las tres
 * vías de agregado y el aviso persistente, así "abierto" es una sola cosa
 * (ADR-175 §5). Si no, abre `ConflictDialog` (local, sin cambios) para el
 * primer conflicto no-`heldManual` de la fila.
 *
 * `EntityGroupItem` decide cuándo montarlo (busca un `Conflict` no resuelto
 * cuyo `groupId` coincida con el grupo) y le pasa el `groupId`.
 */

import { useState } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Tooltip } from "../common/Tooltip.js";
import { WARNING_TOOLTIP } from "../entities/needsReviewBadgeCopy.js";
import {
  CONFLICT_BADGE_CLASS,
  ConflictSymbol,
  RESOLVED_CONFLICT_BADGE_CLASS,
  WarningTooltipText,
} from "../entities/warningSymbols.js";

import { ConflictDialog } from "./ConflictDialog.js";
import { heldManualConflictIdsForGroup } from "./conflictResolution.js";
import { resolvedByDefaultTooltip } from "./formatConflict.js";
import { openManualOverlapDialog } from "./manualOverlapController.js";

export interface ConflictBadgeProps {
  readonly groupId: string;
}

export function ConflictBadge({ groupId }: ConflictBadgeProps) {
  const [open, setOpen] = useState(false);
  const conflicts = useEntitiesStore((state) => state.conflicts);
  const heldConflictIds = heldManualConflictIdsForGroup(conflicts, groupId);
  const plainConflictId = useEntitiesStore(
    (state) =>
      state.conflicts.find(
        (candidate) =>
          candidate.groupId === groupId && !candidate.resolved && candidate.heldManual !== true,
      )?.id,
  );

  function handleClick(): void {
    if (heldConflictIds.length > 0) {
      openManualOverlapDialog(heldConflictIds);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      {/*
        ADR-169 §3: una Y que se abre en dos, en rojo, sobre el token de error
        con opacidad — ya no `hover:bg-red-50`, que en oscuro era un fondo claro.
      */}
      <Tooltip content={<WarningTooltipText {...WARNING_TOOLTIP.conflict} />}>
        <button
          type="button"
          aria-label="Conflicto sin resolver"
          onClick={handleClick}
          className={CONFLICT_BADGE_CLASS}
        >
          <ConflictSymbol />
        </button>
      </Tooltip>
      {plainConflictId !== undefined ? (
        <ConflictDialog conflictId={plainConflictId} open={open} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * ADR-229 §5: con el filtro «con conflicto» activo, la fila de una entidad cuyo
 * conflicto **nació resuelto** (ADR-222 §3) muestra el mismo símbolo en gris, que
 * abre el panel de conflicto. Sin el filtro, esa fila no lleva ícono, como hoy.
 */
export function ResolvedConflictBadge({ conflictId }: { readonly conflictId: string }) {
  const [open, setOpen] = useState(false);
  const detection = useDetectionStore((state) => state.saved);
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.id === conflictId),
  );
  // Un conflicto que nació resuelto a favor de un formato del usuario dice cuál
  // ganó (`Conflicto.dc.html`); el resto, el texto de siempre.
  const byDefault = conflict !== undefined ? resolvedByDefaultTooltip(conflict, detection) : null;
  return (
    <>
      <Tooltip
        content={<WarningTooltipText {...(byDefault ?? WARNING_TOOLTIP.resolvedConflict)} />}
      >
        <button
          type="button"
          aria-label="Conflicto resuelto"
          onClick={() => setOpen(true)}
          className={RESOLVED_CONFLICT_BADGE_CLASS}
        >
          <ConflictSymbol />
        </button>
      </Tooltip>
      <ConflictDialog conflictId={conflictId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
