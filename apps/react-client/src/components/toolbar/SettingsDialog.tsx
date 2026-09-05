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
 *   `actions.requestRender(...)` para refrescar previews, sobre el rango
 *   visible del visor — uno solo desde ADR-087 §2; hasta entonces era la
 *   unión de los rangos de los dos paneles del lado a lado. Sin
 *   documento abierto, se persisten sin diálogo ni `reanalyze` y **el core se
 *   recrea con la config nueva** (ADR-125 §2, que implementa lo que ADR-038
 *   §7 ya había decidido: "sin documento abierto, la UI recrea el core al
 *   vuelo — nada que perder").
 *
 *   Ese último paso es nuevo y hace falta: `App.tsx` hace `settings.load()` →
 *   `deriveEngineConfigOverrides` → `initCore(overrides)` desde PR16.5, pero
 *   `initCore` corre **una sola vez por carga de la app**. Sin recrear, un
 *   cambio hecho antes de cargar el primer PDF se guardaba y el análisis
 *   corría igual con la config de cuando cargó la página — que es
 *   exactamente el caso que ADR-125 §1 abre al poner Configuración en la
 *   pantalla de carga.
 *
 * El guardado es atómico: si se necesita confirmación y el usuario cancela,
 * NINGÚN campo se aplica (ni siquiera `language`/`performancePreset`) — el
 * formulario queda abierto para seguir editando.
 */

import { useEffect, useState, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";
import { recreateCore } from "../../core-adapter/index.js";
import {
  deriveEngineConfigOverrides,
  sameEngineConfigOverrides,
} from "../../core-adapter/settingsToEngineConfig.js";
import { useDocumentStore } from "../../store/document.store.js";
import {
  useSettingsStore,
  type Language,
  type Theme,
  type PerformancePreset,
} from "../../store/settings.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { applyTheme } from "../../theme.js";
import { getShellUpdater } from "../../updater/index.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";
import { Select, type SelectOption } from "../common/Select.js";
import { DARK_PREVIEW, LIGHT_PREVIEW, ThemePreview } from "../common/ThemePreview.js";
import { computeReanalyzeRenderRequest } from "../viewer/reanalyzeRenderRequest.js";

import { diffReanalyzeChange, planReanalyzePatches } from "./reanalyzePlan.js";
import { THIRD_PARTY_CREDITS } from "./thirdPartyCredits.js";

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
  // Sin los códigos ISO entre paréntesis (ADR-087 §4): "spa" y "eng" son cómo
  // se le pide el modelo al motor de reconocimiento de texto, no algo que el
  // usuario tenga que elegir sabiendo.
  { code: "spa", label: "Español" },
  { code: "eng", label: "Inglés" },
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
  /*
   * ADR-126 §1: sin control en el formulario. Se lee del store y viaja tal
   * cual en `next` para no pisarlo al guardar — el único que lo escribe hoy
   * es el canal de override de los tests (`load()`), y nadie desde la UI.
   */
  const nerEnabled = useSettingsStore((state) => state.nerEnabled);
  const [ocrLanguages, setOcrLanguages] = useState<ReadonlyArray<string>>(
    () => useSettingsStore.getState().ocrLanguages,
  );

  const [autoUpdate, setAutoUpdate] = useState<boolean>(
    () => useSettingsStore.getState().autoUpdate,
  );
  /*
   * `null` fuera del contenedor de escritorio: en un navegador no hay
   * actualizador y la sección entera no se muestra. Se resuelve una vez y no
   * en cada render — no cambia durante la vida de la página.
   */
  const [theme, setTheme] = useState<Theme>(() => useSettingsStore.getState().theme);
  const [shellUpdater] = useState(() => getShellUpdater());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sincroniza el formulario con el store vigente cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    const current = useSettingsStore.getState();
    setLanguage(current.language);
    setPerformancePreset(current.performancePreset);
    setOcrLanguages(current.ocrLanguages);
    setAutoUpdate(current.autoUpdate);
    setTheme(current.theme);
    setSaveError(null);
  }, [open]);

  function applyToStore(next: {
    language: Language;
    performancePreset: PerformancePreset;
    nerEnabled: boolean;
    ocrLanguages: ReadonlyArray<string>;
    autoUpdate: boolean;
    theme: Theme;
  }): void {
    useSettingsStore.setState(next);
    useSettingsStore.getState().persist();
    // El tema se aplica al guardar y no al elegir: el diálogo es atómico, y si
    // el usuario cancela nada tiene que haber cambiado. La vista previa es lo
    // que da la devolución inmediata, que es para lo que existe.
    applyTheme(next.theme);
  }

  async function handleSave(): Promise<void> {
    const previous = useSettingsStore.getState();
    const next = { language, performancePreset, nerEnabled, ocrLanguages, autoUpdate, theme };
    const change = diffReanalyzeChange(previous, next);
    const needsReanalyze =
      (change.ner !== undefined || change.ocr !== undefined) && documentId !== null;

    if (needsReanalyze) {
      setConfirmOpen(true);
      return;
    }

    /*
     * ADR-125 §2: sin documento abierto, un cambio de `EngineConfig` hay que
     * aplicarlo recreando el core. `initCore` corre una sola vez por carga de
     * la app y `createCore` congela su config: sin esto, elegir "no detectar
     * nombres" antes de cargar el PDF se guardaría y el análisis correría con
     * NER igual.
     *
     * Se compara el override DERIVADO: cambiar solo el idioma de la interfaz
     * no toca el Core y no puede costar recrear cinco workers.
     *
     * Va antes de `onClose` a propósito (ADR-125 §3): el modal es lo que
     * garantiza que nadie suelte un PDF en la ventana sin core, donde
     * `getCore()` lanzaría.
     */
    const nextOverrides = deriveEngineConfigOverrides(next);
    const needsRecreate =
      documentId === null &&
      !sameEngineConfigOverrides(deriveEngineConfigOverrides(previous), nextOverrides);

    if (needsRecreate) {
      setSaving(true);
      setSaveError(null);
      try {
        await recreateCore(nextOverrides);
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "No se pudo aplicar la configuración.",
        );
        return;
      } finally {
        setSaving(false);
      }
    }

    applyToStore(next);
    onClose();
  }

  async function handleConfirmReanalyze(): Promise<void> {
    const previous = useSettingsStore.getState();
    const next = { language, performancePreset, nerEnabled, ocrLanguages, autoUpdate, theme };
    const change = diffReanalyzeChange(previous, next);
    const patches = planReanalyzePatches(change);

    setSaving(true);
    setSaveError(null);
    try {
      for (const patch of patches) {
        // Secuencial a propósito (no Promise.all): mitigación de la
        // limitación conocida de un patch combinado, ver reanalyzePlan.ts.
        await actions.reanalyze(patch);
      }
      // El store se escribe DESPUÉS de que los patches resolvieron, no antes.
      // Con `applyToStore` arriba del loop, un rechazo del primer patch (ocr)
      // dejaba el store persistido con AMBOS cambios y el segundo (ner) sin
      // enviar: el reintento del usuario recalculaba `diffReanalyzeChange`
      // contra el store ya mutado, daba diff vacío, y "Guardar" cerraba el
      // diálogo sin reanalizar nada. Desde PR16.5 ese store mentiroso además
      // se convierte en la config real del próximo `createCore`.
      applyToStore(next);
      // `kind: "anonymized"` fijo (ADR-056 §3): el `original` se renderiza sin
      // `replacements` y —hasta que exista el highlight de entidades— sin
      // `annotations`, así que un reanalyze no puede cambiar un solo píxel de
      // ese lado. Refrescarlo sería trabajo garantizado-inútil. Un solo rango
      // desde ADR-087 §2 (hay un solo visor). Composición extraída a
      // `computeReanalyzeRenderRequest` (misma razón que `canvasDimensions.ts`:
      // testeable sin jsdom).
      const { visibleRange } = useViewerStore.getState();
      const { pageIndices, kind } = computeReanalyzeRenderRequest(visibleRange);
      actions.requestRender(pageIndices, kind);
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
      <Dialog
        open={open}
        onClose={onClose}
        title="Configuración"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            {/*
              `loading` (no solo `disabled`): guardar puede recrear el core sin
              documento abierto (ADR-125 §2) y eso tarda lo que tardan cinco
              workers.
            */}
            <Button
              variant="primary"
              disabled={ocrLanguagesEmpty}
              loading={saving}
              onClick={() => {
                void handleSave();
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
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
              <p className="mt-1 text-sm text-text-secondary">
                Se aplica al próximo documento; no afecta al que está abierto.
              </p>
            ) : null}
          </FormRow>

          <FormRow label="Idiomas del documento">
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
              <p role="alert" className="mt-1 text-sm text-error">
                Elegí al menos un idioma.
              </p>
            ) : null}
          </FormRow>

          <FormRow label="Apariencia">
            <Checkbox
              id="settings-theme-system"
              checked={theme === "system"}
              onCheckedChange={(checked) => setTheme(checked ? "system" : "light")}
              label="Seguir la configuración del sistema"
            />
            {/*
              Las miniaturas son el control, no una ilustración al lado del
              control: elegir un tema mirando su nombre es adivinar, y elegirlo
              mirando cómo queda es decidir.
            */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  { value: "light", label: "Modo claro", palette: LIGHT_PREVIEW },
                  { value: "dark", label: "Modo oscuro", palette: DARK_PREVIEW },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => setTheme(option.value)}
                  className={`flex flex-col gap-1.5 rounded-md border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    theme === option.value
                      ? "border-accent ring-1 ring-accent"
                      : "border-border hover:border-text-secondary"
                  } ${theme === "system" ? "opacity-60" : ""}`}
                >
                  <ThemePreview palette={option.palette} />
                  <span className="px-0.5 text-sm text-text-primary">{option.label}</span>
                </button>
              ))}
            </div>
            {theme === "system" ? (
              <p className="mt-1 text-sm text-text-secondary">
                Anonly usa el tema de tu sistema y lo acompaña si lo cambiás.
              </p>
            ) : null}
          </FormRow>

          {/*
            Solo dentro del contenedor de escritorio: en un navegador no hay
            actualizador y mostrar el control sería ofrecer algo que no existe.
          */}
          {shellUpdater !== null ? (
            <FormRow label="Actualizaciones">
              <Checkbox
                id="settings-auto-update"
                checked={autoUpdate}
                onCheckedChange={setAutoUpdate}
                label="Actualizar automáticamente"
              />
              {/*
                Texto único que describe LOS DOS estados, no el estado actual.
                La versión anterior decía "Te vamos a avisar..." cuando estaba
                apagado, y pegada debajo de un checkbox sin marcar se leía como
                lo que iba a pasar **si lo activabas** — o sea, exactamente al
                revés. Un texto que cambia con el toggle es ambiguo por
                posición aunque sea correcto por contenido.
              */}
              <p className="mt-1 text-sm text-text-secondary">
                Activado, las versiones nuevas se instalan solas al reiniciar la app. Desactivado,
                te avisamos y vos decidís cuándo instalarlas.
              </p>
              <button
                type="button"
                onClick={() => shellUpdater.check()}
                className="mt-2 text-sm text-accent underline"
              >
                Buscar actualizaciones ahora
              </button>
            </FormRow>
          ) : null}
        </div>

        <AboutSection />

        {/*
          Hasta ADR-125 `saveError` solo se renderizaba dentro del
          `ConfirmDialog`, que es el camino con documento abierto. El camino
          sin documento no abre ninguna confirmación, así que un fallo al
          recrear el core no tenía dónde aparecer.
        */}
        {saveError !== null && !confirmOpen ? (
          <p role="alert" className="mt-4 text-sm text-error">
            {saveError}
          </p>
        ) : null}
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
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

// Bloque estático (ADR-070 §1): lee `THIRD_PARTY_CREDITS`, un módulo de
// datos puro, nunca `settings.store`. No participa de `diffReanalyzeChange`
// ni de `handleSave`/`handleConfirmReanalyze` — "Cancelar" y "Guardar" no lo
// tocan porque no hay nada de él que aplicar o descartar.
/**
 * El repo del proyecto. Constante y no un setting: es una propiedad del
 * producto, no algo que el usuario configure.
 */
const REPOSITORY_URL = "https://github.com/sgiambelluca/Anonly";

function AboutSection() {
  return (
    <>
      <div className="my-4 border-t border-border" />
      <section aria-label="Acerca de" className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-text-secondary">Acerca de</h3>
        {/*
          Que el código sea auditable es parte de la promesa del producto, no
          un dato de color: alguien que va a confiarle una pericia a esta
          herramienta tiene que poder ir a mirar qué hace. El link va acá y no
          escondido en un README.
        */}
        <p className="text-sm text-text-secondary">
          Anonly es software libre.{" "}
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Ver el código fuente en GitHub
          </a>
          {" · "}
          <a
            href={`${REPOSITORY_URL}/issues/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Reportar un problema
          </a>
        </p>
        {THIRD_PARTY_CREDITS.map((credit) => (
          <p key={credit.id} className="text-sm text-text-secondary">
            <a
              href={credit.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {credit.title}
            </a>
            {" — "}
            {credit.holder}. Licencia{" "}
            <a
              href={credit.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {credit.license}
            </a>
            {". "}
            {credit.changes} {credit.usedFor}
          </p>
        ))}
      </section>
    </>
  );
}
