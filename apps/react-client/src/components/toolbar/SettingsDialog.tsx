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

import {
  CheckIcon,
  GaugeIcon,
  GlobeIcon,
  InfoIcon,
  LanguagesIcon,
  RefreshCwIcon,
  SunMoonIcon,
  TriangleAlertIcon,
} from "lucide-react";
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
import {
  DARK_PREVIEW,
  LIGHT_PREVIEW,
  SystemThemePreview,
  ThemePreview,
} from "../common/ThemePreview.js";
import { computeReanalyzeRenderRequest } from "../viewer/reanalyzeRenderRequest.js";

import { diffReanalyzeChange, planReanalyzePatches } from "./reanalyzePlan.js";
import {
  describeTheme,
  OCR_LANGUAGES_SLOT_TEXT,
  PERFORMANCE_PRESET_DESCRIPTION,
  resolveOcrLanguagesSlot,
  THEME_LABEL,
  THEME_ORDER,
  UPDATE_NETWORK_NOTICE,
  UPDATE_NETWORK_NOTICE_EMPHASIS,
} from "./settingsCopy.js";

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
  const ocrSlot = resolveOcrLanguagesSlot({
    selected: ocrLanguages,
    saved: useSettingsStore.getState().ocrLanguages,
    documentOpen: documentId !== null,
  });

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Configuración"
        description="Cómo se analiza el documento y cómo se ve Anonly."
        size="lg"
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              ADR-168 §3: "Acerca de" (créditos y código fuente) dejó este
              diálogo y pasó al pie de la pantalla de inicio. Una línea dice
              dónde quedó, para quien lo busque donde estaba.
            */}
            <span className="inline-flex flex-1 items-center gap-1.5 text-sm text-text-secondary">
              <InfoIcon className="h-4 w-4 shrink-0" aria-hidden />
              Créditos y licencias: en «Acerca de…», al pie del inicio.
            </span>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            {/*
              `loading` (no solo `disabled`): guardar puede recrear el core sin
              documento abierto (ADR-125 §2) y eso tarda lo que tardan cinco
              workers. Ancho mínimo: el texto no cambia de ancho (UX-10).
            */}
            <Button
              variant="primary"
              className="min-w-[6rem]"
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
        <div className="flex flex-col gap-3.5">
          <Section
            icon={<LanguagesIcon className="h-5 w-5" aria-hidden />}
            title="Idioma de la interfaz"
            subtitle="Los textos de la app. No cambia el idioma del documento."
            aside={
              <div className="w-40">
                <Select
                  value={language}
                  onChange={setLanguage}
                  options={LANGUAGE_OPTIONS}
                  aria-label="Idioma"
                />
              </div>
            }
          />

          <Section
            icon={<GaugeIcon className="h-5 w-5" aria-hidden />}
            title="Análisis"
            subtitle="Cómo trabaja Anonly al revisar un documento."
          >
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text-primary">Rendimiento</span>
              <div className="w-56">
                <Select
                  value={performancePreset}
                  onChange={setPerformancePreset}
                  options={PERFORMANCE_PRESET_OPTIONS}
                  aria-label="Preset de rendimiento"
                />
              </div>
              {/* Un renglón fijo para los tres perfiles (UX-10). */}
              <p className="h-5 truncate text-sm text-text-secondary">
                {PERFORMANCE_PRESET_DESCRIPTION[performancePreset]}
              </p>
              {/* Ranura reservada aunque no haya documento: no cambia el alto. */}
              <p
                className={`flex h-5 items-center gap-1.5 text-sm text-text-secondary ${
                  documentId === null ? "invisible" : ""
                }`}
              >
                <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Se aplica al próximo documento; no cambia el que está abierto.
              </p>
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text-primary">Idiomas del documento</span>
              <span className="text-sm text-text-secondary">
                Se usan para leer las páginas escaneadas.
              </span>
              <div className="flex gap-4">
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
              {/*
                Ranura de alto fijo (UX-10): el texto neutro, el error y el
                aviso de re-análisis ocupan el mismo lugar.
              */}
              <div
                role={ocrSlot === "empty" ? "alert" : undefined}
                aria-live="polite"
                className={`flex h-14 items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-snug ${
                  ocrSlot === "empty"
                    ? "border-error bg-error/10 font-medium text-error"
                    : ocrSlot === "reanalyze"
                      ? "border-warning-strong bg-warning/15 text-text-primary"
                      : "border-border bg-bg-secondary text-text-secondary"
                }`}
              >
                {ocrSlot === "idle" ? (
                  <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <TriangleAlertIcon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      ocrSlot === "reanalyze" ? "text-warning-strong" : ""
                    }`}
                    aria-hidden
                  />
                )}
                <span className="line-clamp-2">{OCR_LANGUAGES_SLOT_TEXT[ocrSlot]}</span>
              </div>
            </div>
          </Section>

          <Section
            icon={<SunMoonIcon className="h-5 w-5" aria-hidden />}
            title="Apariencia"
            subtitle={describeTheme(theme)}
          >
            {/*
              ADR-169 §8: tres opciones con miniatura en vez del checkbox
              "Seguir la configuración del sistema" más dos miniaturas. Las
              miniaturas son el control: elegir un tema mirando cómo queda es
              decidir, no adivinar.
            */}
            <div role="radiogroup" aria-label="Apariencia" className="grid grid-cols-3 gap-2.5">
              {THEME_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={theme === option}
                  onClick={() => setTheme(option)}
                  className={`flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    theme === option
                      ? "border-accent ring-2 ring-accent/20"
                      : "border-border hover:border-text-secondary"
                  }`}
                >
                  {option === "system" ? (
                    <SystemThemePreview />
                  ) : (
                    <ThemePreview palette={option === "light" ? LIGHT_PREVIEW : DARK_PREVIEW} />
                  )}
                  <span className="flex items-center justify-between px-0.5 text-sm font-semibold text-text-primary">
                    {THEME_LABEL[option]}
                    {theme === option ? (
                      <CheckIcon className="h-4 w-4 text-accent" aria-hidden />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {/*
            Solo dentro del contenedor de escritorio: en un navegador no hay
            actualizador y mostrar el control sería ofrecer algo que no existe.
          */}
          {shellUpdater !== null ? (
            <Section
              icon={<RefreshCwIcon className="h-5 w-5" aria-hidden />}
              title="Actualizaciones"
              subtitle="Activado, las versiones nuevas se instalan solas al reiniciar. Desactivado, te avisamos y vos decidís cuándo."
            >
              <Checkbox
                id="settings-auto-update"
                checked={autoUpdate}
                onCheckedChange={setAutoUpdate}
                label="Actualizar automáticamente"
              />
              {/*
                ADR-131 §5: buscar actualizaciones es la **única** salida de
                red del producto, y el usuario tiene que enterarse por la app.
                Texto de `Components.md` §2.6: sigue diciendo que GitHub ve la
                IP y la versión.
              */}
              <div className="flex gap-2.5 rounded-lg bg-bg-tertiary px-3 py-2.5 text-sm leading-snug text-text-secondary">
                <GlobeIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {UPDATE_NETWORK_NOTICE}{" "}
                  <b className="font-semibold text-text-primary">
                    {UPDATE_NETWORK_NOTICE_EMPHASIS}
                  </b>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-text-secondary">
                  Versión instalada:{" "}
                  <b className="font-semibold text-text-primary">{__ANONLY_VERSION__}</b>
                </span>
                <Button variant="secondary" onClick={() => shellUpdater.check()}>
                  Buscar actualizaciones ahora
                </Button>
              </div>
            </Section>
          ) : null}
        </div>

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

/**
 * Una sección del diálogo (ADR-169 §8): ícono, título y bajada, y su
 * contenido debajo — o un control al costado (`aside`) cuando es uno solo.
 */
function Section({
  icon,
  title,
  subtitle,
  aside,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-border bg-bg-primary p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-text-secondary">
            {icon}
          </span>
          <div className="flex min-w-0 flex-col">
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary">{subtitle}</p>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
