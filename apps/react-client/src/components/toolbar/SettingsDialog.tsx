/**
 * `SettingsDialog` (`ui/Components.md` §2.6, ADR-038 §7).
 *
 * Form: idioma (`es` default), performance preset (`auto`/`low`/`high`), NER
 * toggle, OCR languages (`docs/roadmap/MVP.md` §2.3, `settings.store.ts` §3.6).
 * `defaultReplacementMode` **no** es parte de este form: ni `Components.md`
 * §2.6 ni el prompt de este PR lo mencionan como campo de Settings.
 *
 * Flujo (ADR-038 §7, `React_Client.md` §3.7):
 * - `language`: UI-only, se persiste sin confirmación.
 * - `performancePreset`: no dispara `reanalyze` nunca; se persiste y aplica
 *   "al próximo documento" — se muestra un hint cuando hay un documento
 *   abierto (ADR-038 §7 Q3).
 * - `nerEnabled` / `ocrLanguages`: si cambiaron Y hay un documento abierto,
 *   `ConfirmDialog` ("¿Reanalizar el documento con la nueva configuración? Tus
 *   ediciones se conservan.") → al confirmar, `actions.reanalyze` (mitigación
 *   de doble llamada secuencial si ambos cambiaron, ver `reanalyzePlan.ts`) →
 *   `actions.requestRender(...)` para refrescar previews, sobre la **unión**
 *   de los rangos visibles de los dos paneles (`visibleRange` es por panel
 *   desde ADR-054 §1: con scroll independiente son dos regiones distintas,
 *   no una — `unionVisibleRange`, `React_Client.md` §3.7 último párrafo). Sin
 *   documento abierto, se persisten sin diálogo ni `reanalyze` (solo afectan
 *   al próximo `createCore`, que hoy ocurre una sola vez por carga de la
 *   app — `core-adapter/index.ts` no deriva `EngineConfig` de
 *   `settings.store` todavía, gap heredado de PR5, fuera de alcance de este
 *   PR).
 *
 * El guardado es atómico: si se necesita confirmación y el usuario cancela,
 * NINGÚN campo se aplica (ni siquiera `language`/`performancePreset`) — el
 * formulario queda abierto para seguir editando.
 */

import { useEffect, useState, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import {
  useSettingsStore,
  type Language,
  type PerformancePreset,
} from "../../store/settings.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";
import { Select, type SelectOption } from "../common/Select.js";
import { rangeToPageIndices, unionVisibleRange } from "../viewer/visibleRange.js";

import { diffReanalyzeChange, planReanalyzePatches } from "./reanalyzePlan.js";

const LANGUAGE_OPTIONS: ReadonlyArray<SelectOption<Language>> = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

const PERFORMANCE_PRESET_OPTIONS: ReadonlyArray<SelectOption<PerformancePreset>> = [
  { value: "auto", label: "Automático" },
  { value: "low", label: "Bajo consumo" },
  { value: "high", label: "Alto rendimiento" },
];

// Únicos idiomas de OCR documentados (docs/core/OCR_Engine.md, MVP.md §2.3,
// default de settings.store.ts): ampliar esta lista requiere actualizar esos
// docs primero (R-19).
const OCR_LANGUAGE_OPTIONS = [
  { code: "spa", label: "Español (spa)" },
  { code: "eng", label: "English (eng)" },
] as const;

function toggleLanguage(
  languages: ReadonlyArray<string>,
  code: string,
  checked: boolean,
): ReadonlyArray<string> {
  if (checked) {
    return languages.includes(code) ? languages : [...languages, code];
  }
  return languages.filter((lang) => lang !== code);
}

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const documentId = useDocumentStore((state) => state.id);

  const [language, setLanguage] = useState<Language>(() => useSettingsStore.getState().language);
  const [performancePreset, setPerformancePreset] = useState<PerformancePreset>(
    () => useSettingsStore.getState().performancePreset,
  );
  const [nerEnabled, setNerEnabled] = useState(() => useSettingsStore.getState().nerEnabled);
  const [ocrLanguages, setOcrLanguages] = useState<ReadonlyArray<string>>(
    () => useSettingsStore.getState().ocrLanguages,
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sincroniza el formulario con el store vigente cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    const current = useSettingsStore.getState();
    setLanguage(current.language);
    setPerformancePreset(current.performancePreset);
    setNerEnabled(current.nerEnabled);
    setOcrLanguages(current.ocrLanguages);
    setSaveError(null);
  }, [open]);

  function applyToStore(next: {
    language: Language;
    performancePreset: PerformancePreset;
    nerEnabled: boolean;
    ocrLanguages: ReadonlyArray<string>;
  }): void {
    useSettingsStore.setState(next);
    useSettingsStore.getState().persist();
  }

  function handleSave(): void {
    const previous = useSettingsStore.getState();
    const next = { language, performancePreset, nerEnabled, ocrLanguages };
    const change = diffReanalyzeChange(previous, next);
    const needsReanalyze =
      (change.ner !== undefined || change.ocr !== undefined) && documentId !== null;

    if (needsReanalyze) {
      setConfirmOpen(true);
      return;
    }

    applyToStore(next);
    onClose();
  }

  async function handleConfirmReanalyze(): Promise<void> {
    const previous = useSettingsStore.getState();
    const next = { language, performancePreset, nerEnabled, ocrLanguages };
    const change = diffReanalyzeChange(previous, next);
    const patches = planReanalyzePatches(change);

    setSaving(true);
    setSaveError(null);
    try {
      applyToStore(next);
      for (const patch of patches) {
        // Secuencial a propósito (no Promise.all): mitigación de la
        // limitación conocida de un patch combinado, ver reanalyzePlan.ts.
        await actions.reanalyze(patch);
      }
      // Unión de los dos rangos por panel (ADR-054 §1): `visibleRange` ya no
      // es un único rango global, así que "lo que el usuario está viendo" son
      // dos regiones — una por `PdfViewer` — que hay que refrescar juntas.
      const { visibleRange } = useViewerStore.getState();
      const unifiedRange = unionVisibleRange(visibleRange.original, visibleRange.anonymized);
      actions.requestRender(rangeToPageIndices(unifiedRange));
      setConfirmOpen(false);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No se pudo reanalizar el documento.");
    } finally {
      setSaving(false);
    }
  }

  const ocrLanguagesEmpty = ocrLanguages.length === 0;

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Configuración">
        <div className="flex flex-col gap-4">
          <FormRow label="Idioma">
            <Select
              value={language}
              onChange={setLanguage}
              options={LANGUAGE_OPTIONS}
              aria-label="Idioma"
            />
          </FormRow>

          <FormRow label="Rendimiento">
            <Select
              value={performancePreset}
              onChange={setPerformancePreset}
              options={PERFORMANCE_PRESET_OPTIONS}
              aria-label="Preset de rendimiento"
            />
            {documentId !== null ? (
              <p className="mt-1 text-xs text-text-secondary">
                Se aplicará al próximo documento (no afecta al documento abierto).
              </p>
            ) : null}
          </FormRow>

          <FormRow label="Detección">
            <Checkbox
              id="settings-ner-enabled"
              checked={nerEnabled}
              onCheckedChange={setNerEnabled}
              label="Detección con NER (nombres, organizaciones)"
            />
          </FormRow>

          <FormRow label="Idiomas de OCR">
            <div className="flex flex-col gap-1.5">
              {OCR_LANGUAGE_OPTIONS.map((option) => (
                <Checkbox
                  key={option.code}
                  id={`settings-ocr-${option.code}`}
                  checked={ocrLanguages.includes(option.code)}
                  onCheckedChange={(checked) =>
                    setOcrLanguages(toggleLanguage(ocrLanguages, option.code, checked))
                  }
                  label={option.label}
                />
              ))}
            </div>
            {ocrLanguagesEmpty ? (
              <p role="alert" className="mt-1 text-xs text-error">
                Elegí al menos un idioma de OCR.
              </p>
            ) : null}
          </FormRow>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={ocrLanguagesEmpty} onClick={handleSave}>
            Guardar
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Reanalizar documento"
        message="¿Reanalizar el documento con la nueva configuración? Tus ediciones se conservan."
        confirmLabel="Reanalizar"
        cancelLabel="Cancelar"
        busy={saving}
        errorMessage={saveError}
        onCancel={() => {
          if (saving) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleConfirmReanalyze();
        }}
      />
    </>
  );
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
