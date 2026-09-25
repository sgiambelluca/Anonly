/**
 * `settingsCopy.ts` — textos y ranuras de `SettingsDialog` (ADR-169 §8,
 * `Components.md` §2.6).
 *
 * **Diseño estable** (UX-10, ADR-169 §1): la descripción del perfil de
 * rendimiento ocupa siempre el mismo renglón para los tres perfiles, y el
 * error "Elegí al menos un idioma" y el aviso de re-análisis comparten una
 * ranura de alto fijo con un texto neutro cuando no hay nada que avisar.
 * Cambiar una opción no cambia el alto del diálogo.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type { PerformancePreset, Theme } from "../../store/settings.store.js";

export const PERFORMANCE_PRESET_DESCRIPTION: Readonly<Record<PerformancePreset, string>> = {
  auto: "Anonly se ajusta a tu equipo. Es lo recomendado.",
  low: "Usa menos memoria y procesador. Puede tardar más.",
  high: "Termina antes a cambio de usar más recursos del equipo.",
};

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
