/**
 * `ExportDialog` (`ui/Components.md` §7.1, `ui/UX_Guidelines.md` §8.2).
 *
 * Form: nombre de archivo, formato de imagen (png/jpeg), calidad JPEG (solo
 * si jpeg), DPI (150/300), título opcional, checkbox de referencia de
 * marcadores (ADR-059 §1, apagado por default). Resumen: cantidad de páginas
 * (+1 con el checkbox activo, `UX_Guidelines.md` §8.2) + grupos
 * habilitados/total (`exportPreflight.ts`).
 *
 * Sin "tamaño estimado" (el mockup de `UX_Guidelines.md` §8.2 muestra
 * "~1.2 MB"): no hay fórmula documentada para estimarlo en función de
 * dpi/formato/calidad — `core/Export_Engine.md` §12 solo da un rango
 * aproximado para una combinación fija (150 DPI, JPEG q 0.85: ~100-300
 * KB/página). Inventar una fórmula general sería precisamente el tipo de
 * "improvisar arquitectura" que este PR debe evitar; se omite (documentado
 * también en el reporte del PR).
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
 *
 * Sin store `settings` pese a que `Components.md` §7.1 lo lista como
 * dependencia: ningún campo de `settings.store` (`React_Client.md` §3.6)
 * aplica a este formulario — `defaultReplacementMode` es sobre grupos, no
 * sobre `ExportOptions`, y los defaults de `imageFormat`/`dpi`/`jpegQuality`
 * vienen de `core/Export_Engine.md` §6 (`ExportConfig`), no de settings.
 */

import { useEffect, useState, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";
import { Select, type SelectOption } from "../common/Select.js";

import { countGroups, needsNoEnabledGroupsConfirmation } from "./exportPreflight.js";
import { ExportProgress } from "./ExportProgress.js";
import {
  buildExportOptions,
  validateExportForm,
  type ExportFormState,
} from "./exportValidation.js";

const DEFAULT_FILENAME = "anonimizado.pdf";
const DEFAULT_IMAGE_FORMAT: ExportFormState["imageFormat"] = "jpeg";
const DEFAULT_JPEG_QUALITY = 0.85;
const DEFAULT_DPI = 150;

const IMAGE_FORMAT_OPTIONS: ReadonlyArray<SelectOption<"png" | "jpeg">> = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
];

const DPI_OPTIONS: ReadonlyArray<SelectOption<"150" | "300">> = [
  { value: "150", label: "150 (estándar)" },
  { value: "300", label: "300 (alta calidad)" },
];

export interface ExportDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const pageCount = useDocumentStore((state) => state.pageCount);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);

  const [filename, setFilename] = useState(DEFAULT_FILENAME);
  const [imageFormat, setImageFormat] = useState<"png" | "jpeg">(DEFAULT_IMAGE_FORMAT);
  const [jpegQuality, setJpegQuality] = useState(DEFAULT_JPEG_QUALITY);
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [title, setTitle] = useState("");
  const [includeMarkerLegend, setIncludeMarkerLegend] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Re-sincroniza el formulario cada vez que se abre (mismo criterio que
  // `SettingsDialog`/`MergeDialog`): también es lo que evita re-mostrar el
  // resultado de una exportación previa (`submitted` vuelve a `false`).
  useEffect(() => {
    if (!open) return;
    setFilename(DEFAULT_FILENAME);
    setImageFormat(DEFAULT_IMAGE_FORMAT);
    setJpegQuality(DEFAULT_JPEG_QUALITY);
    setDpi(DEFAULT_DPI);
    setTitle("");
    setIncludeMarkerLegend(false);
    setSubmitted(false);
    setPreflightOpen(false);
    setFormError(null);
  }, [open]);

  const counts = countGroups(groupsByType);
  const form: ExportFormState = {
    filename,
    imageFormat,
    jpegQuality,
    dpi,
    title,
    includeMarkerLegend,
  };
  const validation = validateExportForm(form);

  function startExport(): void {
    const options = buildExportOptions(form);
    if (options === null) {
      setFormError(validation.reason ?? "Opciones de export inválidas.");
      return;
    }
    actions.requestExport(options);
    setSubmitted(true);
  }

  function handleSubmit(): void {
    if (!validation.valid) {
      setFormError(validation.reason ?? null);
      return;
    }
    setFormError(null);
    if (needsNoEnabledGroupsConfirmation(counts)) {
      setPreflightOpen(true);
      return;
    }
    startExport();
  }

  function handleExportAnother(): void {
    setSubmitted(false);
    setFormError(null);
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Exportar PDF anonimizado">
        {submitted ? (
          <ExportProgress
            filename={filename.trim() !== "" ? filename.trim() : DEFAULT_FILENAME}
            onExportAnother={handleExportAnother}
            onClose={onClose}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <FormRow label="Nombre">
              <input
                type="text"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                className="w-full rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </FormRow>

            <FormRow label="Formato de imagen">
              <Select
                value={imageFormat}
                onChange={setImageFormat}
                options={IMAGE_FORMAT_OPTIONS}
                aria-label="Formato de imagen"
              />
            </FormRow>

            {imageFormat === "jpeg" ? (
              <FormRow label={`Calidad JPEG (${jpegQuality.toFixed(2)})`}>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={jpegQuality}
                  onChange={(event) =>
                    setJpegQuality(Math.round(Number(event.target.value) * 100) / 100)
                  }
                  aria-label="Calidad JPEG"
                  className="w-full"
                />
              </FormRow>
            ) : null}

            <FormRow label="DPI">
              <Select
                value={dpi === 300 ? "300" : "150"}
                onChange={(value) => setDpi(value === "300" ? 300 : 150)}
                options={DPI_OPTIONS}
                aria-label="DPI"
              />
            </FormRow>

            <FormRow label="Título (metadata, opcional)">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </FormRow>

            <Checkbox
              id="export-include-marker-legend"
              checked={includeMarkerLegend}
              onCheckedChange={setIncludeMarkerLegend}
              label={
                <span className="flex flex-col gap-0.5">
                  <span>Incluir referencia de marcadores</span>
                  <span className="text-xs text-text-secondary">
                    Agrega una página final que explica qué significa cada marcador (PRS = Persona,
                    MAT = Matrícula…). Solo los tipos: nunca los datos originales.
                  </span>
                </span>
              }
            />

            <div className="rounded-md bg-bg-secondary p-3 text-xs text-text-secondary">
              <p>{includeMarkerLegend ? pageCount + 1 : pageCount} páginas</p>
              <p>
                {counts.enabled} grupos anonimizados (de {counts.total} detectados)
              </p>
              {counts.disabled > 0 ? <p>{counts.disabled} grupos deshabilitados</p> : null}
            </div>

            {formError !== null ? (
              <p role="alert" className="text-xs text-error">
                {formError}
              </p>
            ) : null}

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
        title="Exportar sin grupos habilitados"
        message="No hay grupos habilitados. El export será idéntico al original. ¿Continuar?"
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

function FormRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
