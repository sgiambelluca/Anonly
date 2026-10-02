/**
 * `settingsCopy.ts` — textos y ranuras de `SettingsDialog` (ADR-169 §8,
 * `Components.md` §2.6).
 *
 * **Diseño estable** (UX-10, ADR-169 §1): la descripción del perfil de
 * rendimiento ocupa siempre una ranura de alto fijo para los cinco perfiles (ADR-194 §6), y el
 * error "Elegí al menos un idioma" y el aviso de re-análisis comparten una
 * ranura de alto fijo con un texto neutro cuando no hay nada que avisar.
 * Cambiar una opción no cambia el alto del diálogo.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  resolvePerformanceLevel,
  type DeviceSignals,
  type PerformanceLevel,
} from "../../core-adapter/settingsToEngineConfig.js";
import type { ShellPlatform } from "../../core-adapter/settingsToEngineConfig.js";
import type { PerformancePreset, Theme, UpdateMode } from "../../store/settings.store.js";

/** Nombre en la UI de cada nivel (ADR-194 §1). */
export const PERFORMANCE_LEVEL_LABEL: Readonly<Record<PerformanceLevel, string>> = {
  low: "Bajo consumo",
  medium: "Intermedio",
  high: "Alto rendimiento",
  ultra: "Ultra",
};

export const PERFORMANCE_PRESET_LABEL: Readonly<Record<PerformancePreset, string>> = {
  auto: "Automático",
  ...PERFORMANCE_LEVEL_LABEL,
};

/** Orden del selector (ADR-194 §6). */
export const PERFORMANCE_PRESET_ORDER: ReadonlyArray<PerformancePreset> = [
  "auto",
  "low",
  "medium",
  "high",
  "ultra",
];

/** Descripción de los niveles; la de `auto` depende del equipo (`describePerformancePreset`). */
export const PERFORMANCE_LEVEL_DESCRIPTION: Readonly<Record<PerformanceLevel, string>> = {
  low: "Usa menos memoria y procesador. Puede tardar más.",
  medium: "Equilibrio entre velocidad y uso de memoria.",
  high: "Termina antes en documentos escaneados. Usa más memoria.",
  ultra: "El más rápido en escaneados. Para equipos con 16 GB o más.",
};

/**
 * La línea bajo el selector de rendimiento (ADR-194 §6). Con `auto` nombra el
 * nivel que resolvió `resolvePerformanceLevel`, la misma función que deriva el
 * override: no puede decir un nivel distinto del que se aplica.
 */
export function describePerformancePreset(
  preset: PerformancePreset,
  signals: DeviceSignals,
): string {
  const level = resolvePerformanceLevel(preset, signals);
  return preset === "auto"
    ? `Anonly elige según tu equipo. En este equipo usa: ${PERFORMANCE_LEVEL_LABEL[level]}.`
    : PERFORMANCE_LEVEL_DESCRIPTION[level];
}

export const THEME_LABEL: Readonly<Record<Theme, string>> = {
  system: "Como el sistema",
  light: "Claro",
  dark: "Oscuro",
};

export const THEME_ORDER: ReadonlyArray<Theme> = ["system", "light", "dark"];

/** La línea bajo "Apariencia": qué hace la opción elegida. */
export function describeTheme(theme: Theme): string {
  return theme === "system"
    ? "Sigue el tema de tu sistema y lo acompaña si lo cambiás."
    : "Se aplica al guardar.";
}

/**
 * ADR-131 §5 con el texto de `Components.md` §2.6: la única salida de red, y
 * que GitHub ve la IP y la versión. Suavizado respecto del anterior, pero lo
 * **sigue diciendo** (ADR-169 §8).
 */
export const UPDATE_NETWORK_NOTICE =
  "Es la única conexión de Anonly a internet: le pregunta a GitHub si hay una versión nueva. Como en cualquier conexión, GitHub ve desde dónde llega la consulta (tu IP) y qué versión tenés.";
export const UPDATE_NETWORK_NOTICE_EMPHASIS =
  "Nunca se envía el contenido ni el nombre de un documento.";
/**
 * ADR-195 §3: última oración del aviso de red. Con "No buscar", la única
 * conexión de la app queda del todo bajo control del usuario.
 */
export const UPDATE_NETWORK_NOTICE_CHECK_OFF =
  'Si elegís "No buscar", Anonly no se conecta a internet salvo que toques "Buscar actualizaciones ahora".';

/** ADR-195 §3: subtítulo de la sección «Actualizaciones». */
export const UPDATE_SECTION_SUBTITLE = "Elegí qué hace Anonly con las versiones nuevas.";

/** Orden del selector (ADR-195 §3). */
export const UPDATE_MODE_ORDER: ReadonlyArray<UpdateMode> = ["install", "notify", "off"];

export const UPDATE_MODE_LABEL: Readonly<Record<UpdateMode, string>> = {
  install: "Instalar automáticamente",
  notify: "Avisarme",
  off: "No buscar",
};

/** ADR-197 §4 (reemplaza a ADR-195 §3). Son los textos de Windows. */
export const UPDATE_MODE_DESCRIPTION: Readonly<Record<UpdateMode, string>> = {
  install: "Busca versiones nuevas y las instala al cerrar Anonly.",
  notify: "Busca versiones nuevas y te avisa cuando están listas.",
  off: "No se conecta a internet. Podés buscar con el botón de abajo.",
};

/**
 * ADR-197 §6: en macOS la instalación es al abrir, no al cerrar. Es el único
 * texto de Configuración que cambia con la plataforma.
 */
export const UPDATE_INSTALL_DESCRIPTION_MAC =
  "Busca versiones nuevas y las instala al abrir Anonly.";

/**
 * La descripción del modo según la plataforma (ADR-197 §6): en macOS `install`
 * es «al abrir»; fuera de Windows y macOS, o sin dato, `install` se comporta
 * como `notify` y dice lo mismo.
 */
export function updateModeDescription(mode: UpdateMode, platform: ShellPlatform): string {
  if (mode === "install" && platform === "macos") return UPDATE_INSTALL_DESCRIPTION_MAC;
  return UPDATE_MODE_DESCRIPTION[mode === "install" && platform === "other" ? "notify" : mode];
}

/** Qué muestra la ranura fija bajo "Idiomas del documento". */
export type OcrLanguagesSlot = "idle" | "empty" | "reanalyze";

export function resolveOcrLanguagesSlot(params: {
  readonly selected: ReadonlyArray<string>;
  readonly saved: ReadonlyArray<string>;
  readonly documentOpen: boolean;
}): OcrLanguagesSlot {
  if (params.selected.length === 0) return "empty";
  const changed =
    params.selected.length !== params.saved.length ||
    params.selected.some((language) => !params.saved.includes(language));
  return changed && params.documentOpen ? "reanalyze" : "idle";
}

export const OCR_LANGUAGES_SLOT_TEXT: Readonly<Record<OcrLanguagesSlot, string>> = {
  idle: "Si cambiás los idiomas con un documento abierto, al guardar se vuelve a analizar. Tus ediciones se conservan.",
  empty: "Elegí al menos un idioma para poder guardar.",
  reanalyze:
    "Al guardar, el documento abierto se vuelve a analizar con estos idiomas. Tus ediciones se conservan.",
};

/**
 * N-5 / UX-10: la ranura de `saveError`, bajo el pie del diálogo, tiene alto
 * fijo — hasta este hallazgo del revisor solo se montaba con error, y
 * aparecer/desaparecer corría el pie. Queda siempre montada (`SettingsDialog`
 * le pone `h-5 truncate`) y esta función decide si en ese momento tiene algo
 * que mostrar.
 *
 * Con `confirmOpen` el error ya se muestra dentro del `ConfirmDialog`
 * (`errorMessage`, ADR-125): mostrarlo también acá lo duplicaría.
 */
export function resolveSaveErrorSlot(params: {
  readonly saveError: string | null;
  readonly confirmOpen: boolean;
}): { readonly visible: boolean; readonly text: string } {
  if (params.saveError === null || params.confirmOpen) return { visible: false, text: "—" };
  return { visible: true, text: params.saveError };
}
