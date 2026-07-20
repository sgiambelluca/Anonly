/**
 * `ExportButton` (`ui/Components.md` §2.5). Vive en `toolbar/` (no en
 * `export/`) siguiendo el árbol de componentes exacto de §1.
 *
 * Visible cuando `stage === Ready` — mismo criterio de auto-gating que
 * `CancelButton.tsx`: el propio componente decide su visibilidad, `Toolbar`
 * solo lo monta sin condicionales (`ui/Components.md` §2.1: "Acciones:
 * ninguna directa; delega en hijos"). Atajo `Cmd/Ctrl+E`
 * (`ui/UX_Guidelines.md` §9).
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ExportDialog } from "../export/ExportDialog.js";

export function ExportButton() {
  const stage = usePipelineStore((state) => state.stage);
  const visible = stage === PipelineStage.Ready;
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

  if (!visible) return null;

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Exportar
      </Button>
      <ExportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
