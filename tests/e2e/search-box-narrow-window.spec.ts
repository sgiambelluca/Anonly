/**
 * El campo de la lupa tiene que poder usarse con la ventana en su ancho
 * mínimo (1024 px, `apps/desktop-shell/src/main.ts`).
 *
 * Con la barra en tres columnas simétricas, el contador y el botón «Agregar»
 * (fijos) dejaban el campo de texto en 0 px a 1024 y a 1100. En una pantalla
 * grande no se veía: lo encontró el runner de CI, que abre la ventana chica.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

for (const width of [1024, 1100, 1280, 1440]) {
  test(`el campo de búsqueda se puede usar con la ventana a ${width} px`, async ({
    page,
    electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }, w) => {
      BrowserWindow.getAllWindows()[0]?.setSize(w, 768);
    }, width);
    await installSettingsOverride(page, { nerEnabled: false });
    await openApp(page, "networkidle");

    await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
    await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

    const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    // 60 px: lo justo para ver unos ocho caracteres de lo que se escribe.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(60);

    await search.fill("34.567.891");
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeEnabled({
      timeout: 15_000,
    });
  });
}
