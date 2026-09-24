/**
 * `ExportButton` (`ui/Components.md` §2.5). Vive en `toolbar/` (no en
 * `export/`) siguiendo el árbol de componentes exacto de §1.
 *
 * Visible cuando `stage ∈ {Ready, Done}` — mismo criterio de auto-gating que
 * `CancelButton.tsx`: el propio componente decide su visibilidad, `Toolbar`
 * solo lo monta sin condicionales (`ui/Components.md` §2.1: "Acciones:
 * ninguna directa; delega en hijos"). Atajo `Cmd/Ctrl+E`
 * (`ui/UX_Guidelines.md` §9), activo solo cuando el botón es visible **y no
 * está bloqueado**.
 *
 * El gate de `stage` aplica SOLO al botón: mientras `ExportDialog` esté
 * abierto, el componente sigue montado aunque `stage` salga de
 * `{Ready, Done}` (`Exporting`, durante el propio export) — ver
 * `exportButtonVisibility.ts` y `Components.md` §2.5/§13.9 (bug #7 del
 * Escenario 1 E2E, 2026-07-22).
 *
 * **Bloqueo por conflicto sin resolver** (ADR-176 §1, `ui/UX_Guidelines.md`
 * §8.1/§8.4): `exportBlockReason(conflicts)` decide si hay motivo. Con
 * motivo, el botón queda deshabilitado, el atajo no abre el diálogo, y una
 * ranura fija y flotante debajo del botón (UX-10: alto reservado siempre,
 * no desplaza el toolbar) muestra el motivo con "Resolver". El bloqueo
 * condiciona el BOTÓN, no la vida de un `ExportDialog` que ya estuviera
 * abierto (`Components.md` §2.5, §9) — no hay ningún efecto acá que lo
 * cierre.
 */

import { useEffect, useState } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ConflictDialog } from "../conflicts/ConflictDialog.js";
import { openFirstPendingManualOverlap } from "../conflicts/manualOverlapController.js";
import { pendingManualOverlapConflicts } from "../conflicts/manualOverlapWarning.js";
import { ExportDialog } from "../export/ExportDialog.js";

import { exportBlockReason, firstPendingConflictId } from "./exportBlockReason.js";
import { isExportTriggerVisible, shouldMountExportButton } from "./exportButtonVisibility.js";

export function ExportButton() {
  const stage = usePipelineStore((state) => state.stage);
  const visible = isExportTriggerVisible(stage);
  const [open, setOpen] = useState(false);
  const [conflictDialogId, setConflictDialogId] = useState<string | null>(null);

  const conflicts = useEntitiesStore((state) => state.conflicts);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const sortOrder = useEntitiesStore((state) => state.sortOrder);
  const blockReason = exportBlockReason(conflicts);

  useEffect(() => {
    if (!visible) return;
    function onKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        if (blockReason !== null) return;
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [visible, blockReason]);

  if (!shouldMountExportButton(stage, open)) return null;

  function handleResolve(): void {
    // ADR-175 §5 / §6.3: mismo "Resolver" que el aviso persistente — se
    // reusa, no se reimplementa. Si lo pendiente no es `heldManual` (hoy no
    // existe ese caso), el `ConflictDialog` de siempre.
    if (pendingManualOverlapConflicts(conflicts).length > 0) {
      openFirstPendingManualOverlap();
      return;
    }
    const conflictId = firstPendingConflictId({ conflicts, groupsByType, sortOrder });
    if (conflictId !== null) setConflictDialogId(conflictId);
  }

  return (
    <>
      {visible ? (
        <div className="relative">
          <Button variant="primary" onClick={() => setOpen(true)} disabled={blockReason !== null}>
            Exportar
          </Button>
          {/*
            Ranura fija y flotante (UX-10, ADR-176 §1): siempre montada, con
            alto reservado (`h-5`), para que aparecer/desaparecer no corra
            nada del toolbar. `absolute` la saca del flujo, así tampoco hace
            crecer la cabecera de `h-14`.
          */}
          <div
            role={blockReason !== null ? "alert" : undefined}
            aria-live="polite"
            className={`absolute left-0 top-full z-10 mt-1 flex h-5 items-center gap-1.5 whitespace-nowrap text-xs ${
              blockReason !== null ? "" : "invisible"
            }`}
          >
            <span className="text-text-secondary">{blockReason ?? "—"}</span>
            <button
              type="button"
              onClick={handleResolve}
              className="font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Resolver
            </button>
          </div>
        </div>
      ) : null}
      <ExportDialog open={open} onClose={() => setOpen(false)} />
      {conflictDialogId !== null ? (
        <ConflictDialog
          conflictId={conflictDialogId}
          open
          onClose={() => setConflictDialogId(null)}
        />
      ) : null}
    </>
  );
}
