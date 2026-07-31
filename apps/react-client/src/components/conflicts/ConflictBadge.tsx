/**
 * `ConflictBadge` (`ui/Components.md` §6.1, `ui/UX_Guidelines.md` §3.3:
 * "Grupo con conflicto: icono ⚠ al lado del nombre. Click abre el
 * conflicto.").
 *
 * Render: icono ⚠ con tooltip "Conflicto". Click: abre `ConflictDialog`.
 * `EntityGroupItem` decide cuándo montarlo (busca un `Conflict` no resuelto
 * cuyo `groupId` coincida con el grupo) y le pasa el `conflictId`.
 */

import { AlertTriangleIcon } from "lucide-react";
import { useState } from "react";

import { Tooltip } from "../common/Tooltip.js";

import { ConflictDialog } from "./ConflictDialog.js";

export interface ConflictBadgeProps {
  readonly conflictId: string;
}

export function ConflictBadge({ conflictId }: ConflictBadgeProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip content="Conflicto">
        <button
          type="button"
          aria-label="Conflicto sin resolver"
          onClick={() => setOpen(true)}
          className="rounded-md p-0.5 text-error hover:bg-red-50"
        >
          <AlertTriangleIcon className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>
      <ConflictDialog conflictId={conflictId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
