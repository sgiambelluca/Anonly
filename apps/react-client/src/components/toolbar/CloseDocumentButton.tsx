/**
 * `CloseDocumentButton` (ADR-051, `ui/Components.md` §2.8). Vive en
 * `toolbar/`, hermano de `CancelButton`/`ExportButton`.
 *
 * Por qué existe (ADR-051 §Contexto): sin este control, un documento que
 * llega a `Ready` solo se podía cerrar recargando la pestaña — el banner de
 * `Failed` (`PipelineStatus`) y el "Cancelar" de `PasswordDialog` eran los
 * únicos dos caminos de UI a `actions.closeDocument()`, y ninguno cubre el
 * flujo normal de "documento que cargó bien". Como
 * `Orchestrator#validateImportInput` exige cerrar el documento activo antes
 * de importar otro (`Orchestrator.md` §13 caso 12), tampoco se podía abrir un
 * segundo PDF sin recargar. Bloqueaba además el Escenario 7 E2E y el gate
 * `test:leak` de Hito 11.
 *
 * Gate de visibilidad: `closeDocumentButtonVisibility.ts` (ver ese archivo
 * para el detalle de las dos condiciones y la regla 9 — mismo patrón que
 * `exportButtonVisibility.ts`/`ExportButton.tsx`, bug #7 del Escenario 1 E2E).
 *
 * `ConfirmDialog`, siempre (ADR-051 §2): cerrar descarta ediciones/reglas sin
 * undo, mismo criterio que `CancelButton` y "Eliminar grupo". `variant="danger"`
 * en el diálogo (igual que `CancelButton`) y `variant="ghost"` en el trigger
 * — a propósito distinto del `variant="secondary"` de `CancelButton`, para que
 * "Cancelar" (acción del pipeline en curso) y "Cerrar" (acción del documento)
 * no se confundan visualmente (ADR-051, sección Consecuencias/Negativas).
 *
 * Sin atajo de teclado en MVP (ADR-051 §1): `Cmd/Ctrl+W` lo captura el
 * navegador.
 *
 * No confundir con el "Cerrar documento" del banner de `Failed`
 * (`PipelineStatus.tsx`): ese cierra sin confirmación porque en `Failed` no
 * hay ediciones que perder. Los dos conviven a propósito (ADR-051 §3,
 * `Components.md` §2.1/§2.8) — este PR no toca `PipelineStatus.tsx`.
 */

import { useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";

import {
  isCloseDocumentTriggerVisible,
  shouldMountCloseDocumentButton,
} from "./closeDocumentButtonVisibility.js";

export function CloseDocumentButton() {
  const stage = usePipelineStore((state) => state.stage);
  const hasActiveDocument = useDocumentStore((state) => state.id !== null);
  const visible = isCloseDocumentTriggerVisible(stage, hasActiveDocument);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!shouldMountCloseDocumentButton(stage, hasActiveDocument, confirmOpen)) return null;

  return (
    <>
      {visible ? (
        <Button variant="ghost" aria-label="Cerrar documento" onClick={() => setConfirmOpen(true)}>
          Cerrar documento
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title="Cerrar documento"
        message="¿Cerrar el documento? Se perderán las ediciones y reglas de esta sesión."
        confirmLabel="Cerrar documento"
        cancelLabel="Seguir editando"
        variant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          actions.closeDocument();
        }}
      />
    </>
  );
}
