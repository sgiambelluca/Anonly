/**
 * `support/engineOverrides.ts` — instala un `EngineConfigOverrides` bajo
 * `localStorage["anonly:engine-overrides"]` (ADR-155) antes de que la app
 * arranque, para atribuir memoria pool por pool sin pasar por el preset
 * bucketado de `installSettingsOverride`/`settingsToEngineConfig.ts`
 * (`performancePreset` mueve los cuatro tamaños de pool juntos).
 *
 * Mismo mecanismo que `tests/e2e/support/settingsOverride.ts`
 * (`page.addInitScript`, corre antes de cualquier script de la página, en
 * cada navegación) — pero, a diferencia de ese archivo, `tests/perf/` sí
 * tiene el remapeo de `paths` de `tests/tsconfig.json` (`e2e/**` está
 * excluido de ese tsconfig, `perf/**` no), así que acá se importa el tipo
 * real (`import type`, se borra en runtime — no hace falta que
 * `@anonly/anonymization-core` sea resoluble por Node en `tests/`) en vez de
 * un espejo plano.
 */

import type { EngineConfigOverrides } from "@anonly/anonymization-core";
import type { Page } from "@playwright/test";

const ENGINE_OVERRIDES_STORAGE_KEY = "anonly:engine-overrides";

/** Instala `overrides` en `localStorage` antes del primer boot de la app (`initCore`, ADR-155). */
export async function installEngineOverrides(
  page: Page,
  overrides: EngineConfigOverrides,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: EngineConfigOverrides }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: ENGINE_OVERRIDES_STORAGE_KEY, value: overrides },
  );
}
