/**
 * ADR-125 — configurar la app ANTES de cargar el primer PDF.
 *
 * Hasta ADR-125 no había forma de abrir Configuración sin un documento:
 * `SettingsButton` vive en la `Toolbar` y ADR-087 §1 dejó la `Toolbar` fuera
 * de la pantalla de carga. El botón vuelve a esa pantalla (solo él, no la
 * toolbar).
 *
 * Pero el botón por sí solo no alcanzaría, y eso es lo que este spec prueba:
 * `initCore` corre **una sola vez por carga de la app** y `createCore` congela
 * su `mergedConfig`, así que una configuración elegida en la landing quedaba
 * guardada y el análisis siguiente corría igual con la config de cuando cargó
 * la página. ADR-125 §2 la aplica recreando el core.
 *
 * **Cómo se prueba, y por qué así** (ADR-126, tercera consecuencia): la
 * versión original de este spec apagaba la detección de nombres desde
 * Configuración y verificaba que la categoría "Personas" no apareciera en el
 * árbol — el efecto de la elección, visible de punta a punta. Ese control
 * dejó de existir cuando ADR-126 retiró el checkbox, y de los settings que
 * quedan ninguno cambia el árbol de un PDF con texto.
 *
 * Lo que sigue siendo exacto y falsable es el mecanismo: guardar un cambio que
 * toca el `EngineConfig` **reemplaza la instancia del core**, y guardar uno que
 * no lo toca **no**. Las dos mitades juntas son la contracara de
 * `sameEngineConfigOverrides`, y la primera falla si alguien quita la
 * recreación de ADR-125 §2. `window.__anonlyCore` la expone `initCore` en DEV
 * (`core-adapter/index.ts#exposeCoreForMeasurement`), que es como corre el
 * webServer de Playwright.
 */

import { expect, test, type Page } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";

test.setTimeout(240_000);

/** Marca la instancia viva para poder comparar identidad después de guardar. */
async function markCore(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __anonlyCore?: unknown; __coreMark?: unknown };
    scope.__coreMark = scope.__anonlyCore;
  });
}

/** `true` si la instancia sigue siendo la misma que marcó `markCore`. */
async function coreUnchanged(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scope = window as unknown as { __anonlyCore?: unknown; __coreMark?: unknown };
    return scope.__anonlyCore !== undefined && scope.__anonlyCore === scope.__coreMark;
  });
}

test("la configuración elegida antes de cargar el PDF se aplica al análisis", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // El botón existe en la pantalla de carga, sin ningún documento abierto
  // (ADR-125 §1). Antes de este ADR no había ninguno.
  const settingsButton = page.getByRole("button", { name: "Configuración" });
  await expect(settingsButton).toBeVisible();

  // El core ya está creado en este punto: `App.tsx` lo crea al montar.
  await expect.poll(async () => coreUnchanged(page)).toBe(false); // todavía no hay marca
  await markCore(page);
  expect(await coreUnchanged(page)).toBe(true);

  // 1. Un cambio que NO toca el EngineConfig: el idioma de la interfaz.
  await settingsButton.click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Idioma" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toHaveCount(0);

  expect(await coreUnchanged(page)).toBe(true);

  // 2. Un cambio que SÍ lo toca: el preset de rendimiento (→ workerPool).
  await settingsButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Preset de rendimiento" }).click();
  await page.getByRole("option", { name: "Bajo consumo" }).click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toHaveCount(0);

  // La instancia es otra: el core se recreó con la configuración elegida.
  await expect.poll(async () => coreUnchanged(page)).toBe(false);

  // Y el core recreado sirve: el documento que se carga después se analiza.
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible();
});
