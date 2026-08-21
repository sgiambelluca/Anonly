/**
 * `ExportDialog` (`ui/Components.md` §7.1, `ui/UX_Guidelines.md` §8.2,
 * simplificado por ADR-087 §5).
 *
 * **Dos controles**: el nombre del archivo y el checkbox de la referencia de
 * marcadores. Los cuatro campos técnicos del formulario anterior —formato de
 * imagen, calidad JPEG, DPI y título de metadata— pasan a ser valores fijos en
 * `exportValidation.ts`.
 *
 * El criterio del recorte: **se pregunta lo que altera el documento, no lo que
 * ajusta su codificación**. El checkbox sobrevive porque suma una página
 * (ADR-059 §6); el nombre porque identifica el resultado y es del usuario.
 * Ninguno de los otros cuatro cambia qué dice el documento, solo cuánto pesa.
 *
 * Sin validación de formulario: el nombre vacío cae al default y la extensión
 * se completa sola (`normalizeExportFilename`), así que no hay estado inválido
 * que reportar. El `formError` del formulario anterior se retira con los
 * campos técnicos.
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

import { useEffect, useState, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";

import { countGroups, needsNoEnabledGroupsConfirmation } from "./exportPreflight.js";
import { ExportProgress } from "./ExportProgress.js";
import {
  DEFAULT_EXPORT_FILENAME,
  buildExportOptions,
  normalizeExportFilename,
} from "./exportValidation.js";

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const pageCount = useDocumentStore((state) => state.pageCount);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);

  const exportResult = usePipelineStore((state) => state.exportResult);

  const [filename, setFilename] = useState(DEFAULT_EXPORT_FILENAME);
  const [includeMarkerLegend, setIncludeMarkerLegend] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);

  // Re-sincroniza cada vez que se abre (mismo criterio que
  // `SettingsDialog`/`MergeDialog`), **salvo `submitted`**: si hay un
  // `exportResult` vigente, el diálogo reabre mostrándolo en vez del
  // formulario.
  //
  // Resetear `submitted` a ciegas era una pérdida de datos real: al cerrar el
  // diálogo tras exportar, el `blobUrl` seguía existiendo en `pipeline.store`
  // pero **la UI no tenía ningún camino de vuelta a él** — reabrir mostraba un
  // formulario en blanco y la única salida era volver a exportar. Reportado
  // desde la prueba manual.
  useEffect(() => {
    if (!open) return;
    const reopenOnResult = shouldReopenOnResult(exportResult);
    // El nombre **sobrevive** al reabrir sobre un resultado: es el nombre con
    // el que se exportó, y el ancla "Descargar" lo usa. Resetearlo hacía que
    // reabrir para descargar bajara el archivo como `anonimizado.pdf` en vez
    // del nombre que el usuario había escrito.
    if (!reopenOnResult) setFilename(DEFAULT_EXPORT_FILENAME);
    setIncludeMarkerLegend(false);
    setPreflightOpen(false);
    setSubmitted(reopenOnResult);
    // `exportResult` deliberadamente fuera de las deps: lo que decide la vista
    // es su valor **al abrir**. Incluirlo haría que un export terminado
    // mientras el diálogo está abierto reejecutara el reset y borrara el
    // nombre que el usuario acaba de escribir.
  }, [open]);

  const counts = countGroups(groupsByType);

  function startExport(): void {
    actions.requestExport(buildExportOptions({ filename, includeMarkerLegend }));
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
            filename={normalizeExportFilename(filename)}
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

            <FormRow label="Nombre del archivo">
              <input
                type="text"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                aria-label="Nombre del archivo"
                className="w-full rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </FormRow>

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

/**
 * Si el diálogo reabre mostrando el resultado en vez del formulario.
 *
 * Separado del componente para poder testearlo: los tests de
 * `apps/react-client` corren en Node sin jsdom, así que lo que vive dentro de
 * un componente no se testea.
 */
export function shouldReopenOnResult(exportResult: { readonly blobUrl: string } | null): boolean {
  return exportResult !== null;
}

function FormRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
