/**
 * Los globos «Agregar como…» de la lupa quedan enteros en la ventana (ADR-207).
 *
 * El caso que lo motiva: con la ventana de 720 px de alto, el globo de un
 * resultado colgaba debajo de la lista y sus botones quedaban 38 px por debajo
 * del borde de la ventana. Con un solo resultado la lista es corta, pero el
 * globo mide unos 400 px.
 */

import type { Locator } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { interactionOnePageFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(120_000);

/** Entero dentro de la ventana y de los ancestros que recortan. */
function fitsInView(popover: Locator): Promise<boolean> {
  return popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      if (window.getComputedStyle(node).overflowY === "visible") continue;
      const bounds = node.getBoundingClientRect();
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
    return rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5;
  });
}

for (const height of [900, 720]) {
  test(`los globos de la lupa entran en la ventana de ${height} px de alto`, async ({
    page,
    electronApp,
  }) => {
    await electronApp.evaluate(({ BrowserWindow }, windowHeight) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, windowHeight);
    }, height);
    await installSettingsOverride(page, { nerEnabled: false });
    await openApp(page, "networkidle");
    await page.locator('input[type="file"]').setInputFiles(await interactionOnePageFile());
    await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });

    const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
    const popover = page.getByRole("dialog", { name: "Agregar la búsqueda como entidad" });
    await search.fill("DNI");
    const results = page.getByRole("region", { name: "Resultados de la búsqueda" });
    await expect(results.getByRole("button", { name: "Agregar como…" }).first()).toBeVisible();

    // El de un resultado: cuelga de la lista.
    await results.getByRole("button", { name: "Agregar como…" }).first().click();
    await expect(popover).toBeVisible();
    expect(await fitsInView(popover), "el globo del resultado entra en la ventana").toBe(true);
    await popover.getByRole("button", { name: "Cancelar" }).click();
    await expect(popover).toHaveCount(0);

    // El de «+ Agregar»: cuelga del campo.
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(popover).toBeVisible();
    expect(await fitsInView(popover), "el globo de la búsqueda entra en la ventana").toBe(true);
    await popover.getByRole("button", { name: "Cancelar" }).click();
    await expect(popover).toHaveCount(0);
  });
}
