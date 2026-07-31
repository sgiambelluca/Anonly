/**
 * `CancelButton` (`ui/Components.md` §2.4).
 *
 * Visible cuando `stage ∉ {Idle, Done, Failed, Cancelled}` — regla canónica de
 * su propia sección del catálogo. `ui/Components.md` §2.1 menciona, para
 * `stage === Ready`, un matiz adicional ("+ CancelButton si hay jobs
 * remanentes"): `pipeline.store` (`React_Client.md` §3.4) no expone ningún
 * campo de "jobs remanentes", así que este PR implementa la regla de §2.4 sin
 * ese matiz (Ready se trata como cualquier otro stage no terminal). Si se
 * necesita el matiz, hace falta un campo de store nuevo — fuera de alcance de
 * este PR sin ADR/spec previo.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";

const HIDDEN_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Idle,
  PipelineStage.Done,
  PipelineStage.Failed,
  PipelineStage.Cancelled,
]);

export function CancelButton() {
  const stage = usePipelineStore((state) => state.stage);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const visible = !HIDDEN_STAGES.has(stage);

  useEffect(() => {
    if (!visible) return;
    function onKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        setConfirmOpen(true);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
        Cancelar
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancelar procesamiento"
        message="¿Cancelar el procesamiento? Los cambios no guardados se perderán."
        confirmLabel="Cancelar procesamiento"
        cancelLabel="Seguir esperando"
        variant="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          actions.cancel();
        }}
      />
    </>
  );
}
