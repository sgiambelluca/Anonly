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
 * **Páginas que no se pudieron leer** (ADR-190 §4, `ui/Components.md` §7.1):
 * segundo pre-flight, también local. Si `computePendingPages` (misma regla
 * que el aviso de `PageCanvas`, §5.4) devuelve algo, se abre
 * `PendingPagesDialog` en vez de exportar directo — a diferencia del de
 * arriba, **no bloquea** (ADR-176 sí bloquea; este no): siempre se puede
 * exportar, pero después de ver la lista. Cada fila viaja con "Tapar página
 * entera" **marcada por defecto**; lo que quede marcado al confirmar se junta
 * en `ExportOptions.coveredPages`.
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
import { useUnreadableInkStore } from "../../store/unreadableInk.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
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
import {
  buildCoveredPages,
  computePendingPages,
  shouldConfirmPendingPages,
} from "./unreadableExportConfirmation.js";

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const pageCount = useDocumentStore((state) => state.pageCount);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const unreadableInkPages = useUnreadableInkStore((state) => state.pages);

  const exportResult = usePipelineStore((state) => state.exportResult);

  const [filename, setFilename] = useState(DEFAULT_EXPORT_FILENAME);
  const [includeMarkerLegend, setIncludeMarkerLegend] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  // ADR-190 §4: filas destildadas de "Tapar página entera" en la confirmación
  // de páginas no leídas — vacío ≡ todas tildadas (default de la fila).
  const [pendingConfirmOpen, setPendingConfirmOpen] = useState(false);
  const [uncheckedPendingPages, setUncheckedPendingPages] = useState<ReadonlySet<number>>(
    new Set(),
  );

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
    setPendingConfirmOpen(false);
    setUncheckedPendingPages(new Set());
    setSubmitted(reopenOnResult);
    // `exportResult` deliberadamente fuera de las deps: lo que decide la vista
    // es su valor **al abrir**. Incluirlo haría que un export terminado
    // mientras el diálogo está abierto reejecutara el reset y borrara el
    // nombre que el usuario acaba de escribir.
  }, [open]);

  const counts = countGroups(groupsByType);
  const pendingPages = computePendingPages(unreadableInkPages, groupsByType);

  function startExport(): void {
    actions.requestExport(
      buildExportOptions({
        filename,
        includeMarkerLegend,
        coveredPages: buildCoveredPages(pendingPages, uncheckedPendingPages),
      }),
    );
    setSubmitted(true);
  }

  function proceedPastPendingPages(): void {
    if (shouldConfirmPendingPages(pendingPages)) {
      setUncheckedPendingPages(new Set());
      setPendingConfirmOpen(true);
      return;
    }
    startExport();
  }

  function handleSubmit(): void {
    if (needsNoEnabledGroupsConfirmation(counts)) {
      setPreflightOpen(true);
      return;
    }
    proceedPastPendingPages();
  }

  function togglePendingPage(pageIndex: number): void {
    setUncheckedPendingPages((current) => {
      const next = new Set(current);
      if (next.has(pageIndex)) next.delete(pageIndex);
      else next.add(pageIndex);
      return next;
    });
  }

  function handleGoToPendingPage(pageIndex: number): void {
    useViewerStore.getState().requestPageJump(pageIndex);
    setPendingConfirmOpen(false);
    // Cierra también el diálogo de export entero: es modal y taparía el
    // visor al que "Ir a la página" acaba de mandar al usuario.
    onClose();
  }

  return (
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

      {/*
        Anidados DENTRO de los `children` del `Dialog` de afuera (no como
        hermanos en un fragment) a propósito: dos `RadixDialog.Root`
        independientes abiertos a la vez, sin relación de anidamiento en el
        árbol de React, confunden la pila de "dismissable layers" de Radix —
        el foco que vuelve a `document.body` cuando el interno se cierra sin
        que nada más lo reciba (el caso de `PendingPagesDialog` confirmando:
        no se abre ningún diálogo detrás) se leía como una interacción "de
        afuera" del externo y lo cerraba también, perdiendo `submitted` justo
        antes de mostrar el resultado del export. Anidado como hijo real de
        `Dialog.Content`, Radix trata la pila correctamente (mismo patrón que
        documenta Radix para diálogos anidados).
      */}
      <ConfirmDialog
        open={preflightOpen}
        title="Exportar sin nada anonimizado"
        message="No hay entidades habilitadas. El documento exportado será idéntico al original. ¿Continuar?"
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        onCancel={() => setPreflightOpen(false)}
        onConfirm={() => {
          setPreflightOpen(false);
          proceedPastPendingPages();
        }}
      />

      <PendingPagesDialog
        open={pendingConfirmOpen}
        pendingPages={pendingPages}
        uncheckedPages={uncheckedPendingPages}
        onToggleCoverPage={togglePendingPage}
        onGoToPage={handleGoToPendingPage}
        onCancel={() => setPendingConfirmOpen(false)}
        onConfirm={() => {
          setPendingConfirmOpen(false);
          startExport();
        }}
      />
    </Dialog>
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

/**
 * Confirmación de páginas con `unreadableInk` y ninguna entidad (ADR-190 §4,
 * `ui/Components.md` §7.1). No bloquea: siempre hay un botón "Exportar" acá
 * también, a diferencia de `ManualOverlapDialog`/ADR-176.
 */
interface PendingPagesDialogProps {
  readonly open: boolean;
  readonly pendingPages: ReadonlyArray<number>;
  readonly uncheckedPages: ReadonlySet<number>;
  readonly onToggleCoverPage: (pageIndex: number) => void;
  readonly onGoToPage: (pageIndex: number) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function PendingPagesDialog({
  open,
  pendingPages,
  uncheckedPages,
  onToggleCoverPage,
  onGoToPage,
  onCancel,
  onConfirm,
}: PendingPagesDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Páginas que no se pudieron leer"
      description="Estas páginas tienen contenido que no se pudo leer y no tienen nada marcado para tapar."
    >
      <div className="flex flex-col gap-3">
        {pendingPages.map((pageIndex) => (
          <div
            key={pageIndex}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text-primary">Página {pageIndex + 1}</span>
              <Checkbox
                id={`pending-page-${pageIndex}-cover`}
                checked={!uncheckedPages.has(pageIndex)}
                onCheckedChange={() => onToggleCoverPage(pageIndex)}
                label="Tapar página entera"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => onGoToPage(pageIndex)}>
              Ir a la página
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          Exportar
        </Button>
      </div>
    </Dialog>
  );
}
