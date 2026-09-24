/**
 * `ConflictBadge` (`ui/Components.md` §6.1, `ui/UX_Guidelines.md` §3.3:
 * "Grupo con conflicto: icono ⚠ al lado del nombre. Click abre el
 * conflicto.").
 *
 * Render: icono ⚠ con tooltip "Conflicto". Click: abre `ConflictDialog` —
 * o, si el conflicto tiene `heldManual` (ADR-174 §1: una ocurrencia manual
 * perdió una superposición y quedó retenida), `ManualOverlapDialog`
 * (`Components.md` §6.3) en su lugar. `EntityGroupItem` decide cuándo
 * montarlo (busca un `Conflict` no resuelto cuyo `groupId` coincida con el
 * grupo) y le pasa el `conflictId`.
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
import { ManualOverlapDialog } from "./ManualOverlapDialog.js";

export interface ConflictBadgeProps {
  readonly conflictId: string;
}

export function ConflictBadge({ conflictId }: ConflictBadgeProps) {
  const [open, setOpen] = useState(false);
  const heldManual = useEntitiesStore(
    (state) => state.conflicts.find((candidate) => candidate.id === conflictId)?.heldManual,
  );

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
          onClick={() => setOpen(true)}
          className={CONFLICT_BADGE_CLASS}
        >
          <ConflictSymbol />
        </button>
      </Tooltip>
      {heldManual === true ? (
        <ManualOverlapDialog conflictId={conflictId} open={open} onClose={() => setOpen(false)} />
      ) : (
        <ConflictDialog conflictId={conflictId} open={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
