/**
 * `settings.store.ts` — settings del usuario, persistidos en `localStorage`
 * (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.6. Defaults:
 * - `language`/`defaultReplacementMode`: docs/roadmap/MVP.md §2.3 (es default)
 *   y docs/ui/UX_Guidelines.md UX-7 ("placeholder por defecto, más informativo").
 * - `performancePreset`: "auto" (ADR-194: se resuelve a un nivel según la RAM
 *   y los hilos del equipo, docs/ui/React_Client.md §3.7).
 * - `nerEnabled`/`ocrLanguages`: mismos defaults que `EngineConfig` del Core
 *   (`ner.enabled = true`, `ocr.languages = ["spa", "eng"]`), replicados acá
 *   a propósito — el cliente no importa el façade del Core para esto porque
 *   este PR bootea sin Core (no hay `core-adapter` todavía, ver
 *   docs/roadmap/MVP.md, Hito 10, orden de PRs); `ocr.languages` coincide con
 *   docs/roadmap/MVP.md §2.1 ("Tesseract.js con modelo spa+eng").
 *
 * `scrollSyncEnabled` se retiró en ADR-087 §2 junto con el lado a lado: con un
 * solo visor no hay dos scrolls que sincronizar. Una clave vieja que haya
 * quedado en `localStorage` se ignora sola, sin migración: `load()` copia
 * únicamente las claves que conoce.
 *
 * **`nerEnabled` dejó de ser un setting del usuario** (ADR-126). No tiene
 * control en `SettingsDialog`, `persist()` **no lo escribe**, y ningún camino
 * de producto lo apaga: la detección de nombres está siempre activa, y que su
 * modelo no cargue es un fallo del pipeline (`NER_MODEL_MISSING`), no una
 * opción de seguir sin ella — un documento anonimizado al que le faltan
 * justamente los nombres es un resultado equivocado con cara de éxito.
 *
 * `load()` **sí** lo sigue leyendo si está presente, y eso es lo único que lo
 * mantiene vivo: es el canal por el que los escenarios E2E que no necesitan
 * NER lo apagan antes del arranque (`tests/e2e/support/settingsOverride.ts`),
 * sin pagar la descarga y la inferencia del modelo en cada spec. Es un canal
 * de override, no una preferencia: nada en la app escribe esa clave.
 *
 * Solo settings van a `localStorage`, nunca documentos
 * (docs/architecture/08_Security_Model.md §10.2).
 *
 * `persist()`/`load()` son los únicos puntos de escritura/lectura de
 * `localStorage` de este store; los campos individuales se mutan con el
 * `setState` que expone el propio hook de Zustand (`useSettingsStore.setState`),
 * ya que el spec (§3.6) no declara setters por campo.
 */

import { ReplacementMode } from "@anonly/anonymization-core";
import { create } from "zustand";

export type Language = "es" | "en";

/**
 * `"system"` sigue a `prefers-color-scheme` del sistema operativo; los otros
 * dos lo pisan en las dos direcciones. Default `"system"`: la mayoría de la
 * gente ya configuró su preferencia una vez a nivel del SO y no quiere
 * volver a hacerlo por aplicación.
 */
export type Theme = "system" | "light" | "dark";
/**
 * ADR-194 §1: cuatro niveles y `auto`, que no es un nivel: se resuelve a uno
 * (`core-adapter/settingsToEngineConfig.ts`).
 */
export type PerformancePreset = "auto" | "low" | "medium" | "high" | "ultra";

const PERFORMANCE_PRESETS: ReadonlySet<string> = new Set<PerformancePreset>([
  "auto",
  "low",
  "medium",
  "high",
  "ultra",
]);

/**
 * Versión del formato persistido. 2 = ADR-194: `high` pasó de dos a cuatro
 * reconocedores, así que un `high` guardado sin versión (o con una menor) no
 * se respeta.
 */
const SETTINGS_VERSION = 2;

/**
 * El preset a cargar (ADR-194 §5). Un `high` de una versión anterior vuelve a
 * `auto` y un valor desconocido también; `load()` no escribe, así que la
 * migración se repite igual hasta el primer `persist()`.
 */
function migratePerformancePreset(value: unknown, version: unknown): PerformancePreset {
  if (typeof value !== "string" || !PERFORMANCE_PRESETS.has(value)) return "auto";
  const preset = value as PerformancePreset;
  const outdated = typeof version !== "number" || version < SETTINGS_VERSION;
  return preset === "high" && outdated ? "auto" : preset;
}

/** ADR-195 §1: una sola preferencia en lugar de `autoUpdate` y `checkUpdates`. */
export type UpdateMode = "install" | "notify" | "off";

const UPDATE_MODES: ReadonlySet<string> = new Set<UpdateMode>(["install", "notify", "off"]);

/** Lo que se le informa al shell con `setAutomaticChecks` (ADR-188 §2). */
export function searchesAutomatically(mode: UpdateMode): boolean {
  return mode !== "off";
}

/** Con una versión lista, ¿se aplica sin preguntar? Solo en `install` (ADR-195 §1). */
export function installsWithoutAsking(mode: UpdateMode): boolean {
  return mode === "install";
}

/**
 * El modo a cargar (ADR-195 §2). Sin `updateMode` guardado se deduce de las
 * dos claves anteriores; la búsqueda apagada gana sobre la instalación.
 */
function migrateUpdateMode(parsed: PersistedSettings): UpdateMode {
  if (parsed.updateMode !== undefined) {
    const value: unknown = parsed.updateMode;
    return typeof value === "string" && UPDATE_MODES.has(value) ? (value as UpdateMode) : "notify";
  }
  if (parsed.checkUpdates === false) return "off";
  return parsed.autoUpdate === true ? "install" : "notify";
}

export interface SettingsSlice {
  readonly language: Language;
  readonly performancePreset: PerformancePreset;
  readonly defaultReplacementMode: ReplacementMode;
  readonly nerEnabled: boolean;
  readonly ocrLanguages: ReadonlyArray<string>;
  /**
   * Qué hace Anonly con las versiones nuevas (ADR-195): `install` busca y
   * aplica sola al reiniciar, `notify` busca y pregunta, `off` no se conecta
   * salvo con "Buscar actualizaciones ahora".
   *
   * El default es preguntar, y es una decisión de producto: reemplazarle la
   * aplicación en silencio a alguien que está anonimizando pericias es lo que
   * genera desconfianza en una herramienta que se vende como local.
   *
   * Solo tiene efecto dentro del contenedor de escritorio (ADR-131 §3). En un
   * navegador no hay actualizador y el control no se muestra.
   */
  readonly updateMode: UpdateMode;
  readonly theme: Theme;
  /**
   * ADR-169 §7: avisos de descubrimiento que el usuario cerró
   * (`"selection-hint"` = la tarjeta sobre el visor; `"panel-footer-hint"` =
   * la nota al pie del panel). **Persistido**: cerrado una vez, no vuelve.
   */
  readonly dismissedHints: ReadonlyArray<DismissibleHint>;
  persist(): void;
  load(): void;
}

export type DismissibleHint = "selection-hint" | "panel-footer-hint";

const DISMISSIBLE_HINTS: ReadonlySet<string> = new Set<DismissibleHint>([
  "selection-hint",
  "panel-footer-hint",
]);

function isDismissibleHint(value: unknown): value is DismissibleHint {
  return typeof value === "string" && DISMISSIBLE_HINTS.has(value);
}

/**
 * La lista con `hint` agregado, sin repetidos. Una clave desconocida que haya
 * quedado en `localStorage` se descarta al leer (`load`), así que la lista
 * solo contiene avisos que existen.
 */
export function withDismissedHint(
  hints: ReadonlyArray<DismissibleHint>,
  hint: DismissibleHint,
): ReadonlyArray<DismissibleHint> {
  return hints.includes(hint) ? hints : [...hints, hint];
}

/** Cierra un aviso de descubrimiento y lo persiste (ADR-169 §7). */
export function dismissHint(hint: DismissibleHint): void {
  const state = useSettingsStore.getState();
  useSettingsStore.setState({ dismissedHints: withDismissedHint(state.dismissedHints, hint) });
  useSettingsStore.getState().persist();
}

const STORAGE_KEY = "anonly:settings";

type SettingsData = Pick<
  SettingsSlice,
  | "language"
  | "performancePreset"
  | "defaultReplacementMode"
  | "nerEnabled"
  | "ocrLanguages"
  | "updateMode"
  | "theme"
  | "dismissedHints"
>;

const DEFAULT_SETTINGS: SettingsData = {
  language: "es",
  performancePreset: "auto",
  defaultReplacementMode: ReplacementMode.Placeholder,
  nerEnabled: true,
  ocrLanguages: ["spa", "eng"],
  updateMode: "notify",
  theme: "system",
  dismissedHints: [],
};

type PersistedSettings = Partial<SettingsData> & {
  readonly settingsVersion?: number;
  // Claves anteriores a ADR-195: se leen para migrar y ya no se escriben.
  readonly autoUpdate?: unknown;
  readonly checkUpdates?: unknown;
};

function isPersistedSettings(value: unknown): value is PersistedSettings {
  return typeof value === "object" && value !== null;
}

export const useSettingsStore = create<SettingsSlice>((set, get) => ({
  ...DEFAULT_SETTINGS,
  persist() {
    const state = get();
    const toStore: PersistedSettings = {
      settingsVersion: SETTINGS_VERSION,
      language: state.language,
      performancePreset: state.performancePreset,
      defaultReplacementMode: state.defaultReplacementMode,
      ocrLanguages: state.ocrLanguages,
      updateMode: state.updateMode,
      theme: state.theme,
      dismissedHints: state.dismissedHints,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      // localStorage puede fallar (quota excedida, modo privado). No es
      // fatal: los settings quedan en memoria para la sesión actual.
      console.warn("No se pudieron persistir los settings.", error);
    }
  },
  load() {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn("No se pudieron leer los settings persistidos.", error);
      return;
    }
    if (raw === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("Settings persistidos corruptos, se ignoran.", error);
      return;
    }
    if (!isPersistedSettings(parsed)) return;

    set({
      ...(parsed.language !== undefined ? { language: parsed.language } : {}),
      ...(parsed.performancePreset !== undefined
        ? {
            performancePreset: migratePerformancePreset(
              parsed.performancePreset,
              parsed.settingsVersion,
            ),
          }
        : {}),
      ...(parsed.defaultReplacementMode !== undefined
        ? { defaultReplacementMode: parsed.defaultReplacementMode }
        : {}),
      ...(parsed.nerEnabled !== undefined ? { nerEnabled: parsed.nerEnabled } : {}),
      ...(parsed.ocrLanguages !== undefined ? { ocrLanguages: parsed.ocrLanguages } : {}),
      updateMode: migrateUpdateMode(parsed),
      ...(parsed.theme !== undefined ? { theme: parsed.theme } : {}),
      // Se filtra contra los avisos que existen: una clave vieja o corrupta no
      // puede esconder un aviso nuevo.
      ...(Array.isArray(parsed.dismissedHints)
        ? { dismissedHints: parsed.dismissedHints.filter(isDismissibleHint) }
        : {}),
    });
  },
}));
