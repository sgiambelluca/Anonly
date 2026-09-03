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
 * la página. La aserción central no es que el diálogo abra —eso lo ve
 * cualquiera— sino que la elección **llegue al análisis**.
 *
 * El control es NER: `text-10p.pdf` produce grupos `Person` ("Juan Pérez",
 * "María Gómez", "Carlos López") **solo** si NER está activo — con NER
 * apagado, la categoría "Personas" no existe en el árbol, que es justamente
 * lo que verifica `scenario-8-ner-disabled.spec.ts` por la otra vía
 * (`installSettingsOverride`, que escribe el `localStorage` antes de que
 * arranque la app). Acá el camino es el del usuario: abrir el diálogo y
 * apagar el toggle con la app ya corriendo.
 *
 * Sin la recreación del core de ADR-125 §2, este test falla mostrando las tres
 * personas: la única señal posible de "el botón es decorativo".
 */

import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";

test.setTimeout(240_000);

test("la configuración elegida antes de cargar el PDF se aplica al análisis", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // El botón existe en la pantalla de carga, sin ningún documento abierto.
  const settingsButton = page.getByRole("button", { name: "Configuración" });
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog).toBeVisible();

  // Apagar la detección de nombres. Sin documento abierto no hay confirmación
  // de reanálisis (ADR-038 §7): guardar recrea el core y cierra.
  await dialog
    .getByRole("checkbox", { name: "Detectar nombres de personas y organizaciones" })
    .click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toHaveCount(0);

  // Recién ahora se carga el documento.
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 120_000 });

  // Las entidades de Regex están (el análisis corrió de verdad)...
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible();

  // ...y las de NER no, porque el usuario lo apagó antes de empezar.
  await expect(page.getByRole("treeitem", { name: "Personas" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Juan Pérez" })).toHaveCount(0);
});
