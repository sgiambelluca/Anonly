/**
 * `ExportButton` (`ui/Components.md` §2.5). Vive en `toolbar/` (no en
 * `export/`) siguiendo el árbol de componentes exacto de §1.
 *
 * Visible cuando `stage ∈ {Ready, Done}` — mismo criterio de auto-gating que
 * `CancelButton.tsx`: el propio componente decide su visibilidad, `Toolbar`
 * solo lo monta sin condicionales (`ui/Components.md` §2.1: "Acciones:
 * ninguna directa; delega en hijos"). Atajo `Cmd/Ctrl+E`
 * (`ui/UX_Guidelines.md` §9), activo solo cuando el botón es visible.
 *
 * El gate de `stage` aplica SOLO al botón: mientras `ExportDialog` esté
 * abierto, el componente sigue montado aunque `stage` salga de
 * `{Ready, Done}` (`Exporting`, durante el propio export) — ver
 * `exportButtonVisibility.ts` y `Components.md` §2.5/§13.9 (bug #7 del
 * Escenario 1 E2E, 2026-07-22).
 */

import { useEffect, useState } from "react";

import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ExportDialog } from "../export/ExportDialog.js";

import { isExportTriggerVisible, shouldMountExportButton } from "./exportButtonVisibility.js";

export function ExportButton() {
  const stage = usePipelineStore((state) => state.stage);
  const visible = isExportTriggerVisible(stage);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    function onKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [visible]);

  if (!shouldMountExportButton(stage, open)) return null;

  return (
    <>
      {visible ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Exportar
        </Button>
      ) : null}
      <ExportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
