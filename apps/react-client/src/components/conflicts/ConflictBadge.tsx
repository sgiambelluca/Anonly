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

import { useEntitiesStore } from "../../store/entities.store.js";
import { Tooltip } from "../common/Tooltip.js";
import { WARNING_TOOLTIP } from "../entities/needsReviewBadgeCopy.js";
import {
  CONFLICT_BADGE_CLASS,
  ConflictSymbol,
  WarningTooltipText,
} from "../entities/warningSymbols.js";

import { ConflictDialog } from "./ConflictDialog.js";
import { heldManualConflictIdsForGroup } from "./conflictResolution.js";
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
