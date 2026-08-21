/**
 * `ExportDialog` (`ui/Components.md` §7.1, `ui/UX_Guidelines.md` §8.2,
 * simplificado por ADR-087 §5).
 *
 * **Un solo control**: el checkbox de la referencia de marcadores. Los cinco
 * campos técnicos del formulario anterior —nombre, formato de imagen, calidad
 * JPEG, DPI y título de metadata— pasan a ser valores fijos en
 * `exportValidation.ts`.
 *
 * El criterio del recorte: **se pregunta lo que altera el documento, no lo que
 * ajusta su codificación**. El checkbox sobrevive porque suma una página
 * (ADR-059 §6); ninguno de los otros cinco cambia qué dice el documento, solo
 * cuánto pesa.
 *
 * Sin validación de formulario: sin campos editables no hay nada que validar,
 * y el `formError` que mostraba esos mensajes se retira con ellos.
 *
 * Pre-flight (`ui/React_Client.md` §8, cálculo **local**, no evento):
 * `enabledGroups === 0` → `ConfirmDialog` anidado antes de exportar.
 *
 * Tras el submit, el diálogo transiciona a `ExportProgress`
 * (`exportPhase.ts#resolveExportPhase` decide la fase a partir del estado
 * local `submitted` + `pipeline.store`). `submitted` se resetea cada vez que
 * el diálogo se abre (mismo patrón que `SettingsDialog`/`MergeDialog`), lo
 * que evita mostrar el resultado obsoleto de una exportación anterior si el
 * usuario reabre el diálogo sin haber vuelto a exportar.
 */

import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";

import { countGroups, needsNoEnabledGroupsConfirmation } from "./exportPreflight.js";
import { ExportProgress } from "./ExportProgress.js";
import { DEFAULT_EXPORT_FILENAME, buildExportOptions } from "./exportValidation.js";

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const pageCount = useDocumentStore((state) => state.pageCount);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);

  const [includeMarkerLegend, setIncludeMarkerLegend] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);

  // Re-sincroniza cada vez que se abre (mismo criterio que
  // `SettingsDialog`/`MergeDialog`): también es lo que evita re-mostrar el
  // resultado de una exportación previa (`submitted` vuelve a `false`).
  useEffect(() => {
    if (!open) return;
    setIncludeMarkerLegend(false);
    setSubmitted(false);
    setPreflightOpen(false);
  }, [open]);

  const counts = countGroups(groupsByType);

  function startExport(): void {
    actions.requestExport(buildExportOptions({ includeMarkerLegend }));
    setSubmitted(true);
  }

  function handleSubmit(): void {
    if (needsNoEnabledGroupsConfirmation(counts)) {
      setPreflightOpen(true);
      return;
    }
    startExport();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Exportar documento anonimizado">
        {submitted ? (
          <ExportProgress
            filename={DEFAULT_EXPORT_FILENAME}
            onExportAnother={() => setSubmitted(false)}
            onClose={onClose}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm text-text-primary">
              <p>
                <strong className="font-medium">
                  {counts.enabled} de {counts.total}
                </strong>{" "}
                {counts.total === 1 ? "entidad será anonimizada" : "entidades serán anonimizadas"}
              </p>
              <p className="text-text-secondary">
                {includeMarkerLegend ? pageCount + 1 : pageCount}{" "}
                {pageCount === 1 && !includeMarkerLegend ? "página" : "páginas"}
              </p>
            </div>

            <Checkbox
              id="export-include-marker-legend"
              checked={includeMarkerLegend}
              onCheckedChange={setIncludeMarkerLegend}
              label={
                <span className="flex flex-col gap-0.5">
                  <span>Agregar una página con la referencia de marcadores</span>
                  <span className="text-sm text-text-secondary">
                    Explica qué significa cada marcador (PRS = Persona, MAT = Matrícula…). Solo los
                    tipos: nunca los datos originales.
                  </span>
                </span>
              }
            />

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleSubmit}>
                Exportar
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={preflightOpen}
        title="Exportar sin nada anonimizado"
        message="No hay entidades habilitadas. El documento exportado será idéntico al original. ¿Continuar?"
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        onCancel={() => setPreflightOpen(false)}
        onConfirm={() => {
          setPreflightOpen(false);
          startExport();
        }}
      />
    </>
  );
}
