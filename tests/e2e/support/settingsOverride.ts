/**
 * `settingsOverride.ts` — persiste settings parciales bajo la key de
 * `apps/react-client/src/store/settings.store.ts` (`"anonly:settings"`)
 * ANTES de que la app cargue, para escenarios que necesitan un
 * `EngineConfigOverrides` distinto del default en el primer `initCore()`
 * (`App.tsx`, PR16.5, `ADR-048 §7 punto 2`).
 *
 * Usa `page.addInitScript` (corre antes de cualquier script de la página, en
 * cada navegación) para escribir `localStorage` previo al primer
 * `useSettingsStore.getState().load()` del bootstrap. `load()` (`settings.store.ts`)
 * solo pisa los campos presentes en el JSON persistido — un objeto parcial
 * alcanza, no hace falta serializar todo `SettingsSlice`.
 *
 * Sin import de `@anonly/anonymization-core`: `tests/e2e/tsconfig.json` no
 * tiene el remapeo de `paths` que sí tiene `tests/tsconfig.json` (comentario
 * de ese archivo: "Ningún @anonly/*-engine es dependencia del package.json de
 * la raíz"), así que los tipos acá son un espejo plano y self-contained del
 * shape persistido, no una importación cruzada de paquete.
 */

import type { Page } from "@playwright/test";

const SETTINGS_STORAGE_KEY = "anonly:settings";

export interface SettingsOverride {
  readonly language?: "es" | "en";
  readonly performancePreset?: "auto" | "low" | "high";
  readonly nerEnabled?: boolean;
  readonly ocrLanguages?: ReadonlyArray<string>;
}

/** Instala `partial` en `localStorage` antes del primer load de la app. */
export async function installSettingsOverride(
  page: Page,
  partial: SettingsOverride,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: SettingsOverride }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: SETTINGS_STORAGE_KEY, value: partial },
  );
}
