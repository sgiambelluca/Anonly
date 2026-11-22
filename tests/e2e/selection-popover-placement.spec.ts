/**
 * El globo «Agregar la selección como entidad» queda entero dentro del visor
 * (ADR-207): en una ventana baja se corre lo mínimo, y usar sus botones no mueve
 * el documento.
 *
 * El caso que lo motiva: en el runner de macOS, el «Cancelar» del globo quedaba
 * debajo del borde visible del visor. Para alcanzarlo había que scrollear, y la
 * página se corría 16 px (`anonymized-interaction-geometry.spec.ts`).
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { interactionOnePageFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(120_000);

for (const height of [900, 720]) {
  test(`el globo de la selección entra en el visor con la ventana de ${height} px de alto`, async ({
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
    const zoomControls = page.getByRole("group", { name: "Zoom del visor" });
    const zoomIn = zoomControls.getByRole("button", { name: "Acercar" });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    await expect(zoomControls.getByText("130%", { exact: true })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
    const highlight = page
      .locator('[class*="border-warning-strong"][class*="bg-warning/30"]')
      .first();
    await search.fill("DNI");
    await expect(highlight).toBeVisible();
    const box = await highlight.boundingBox();
    expect(box).not.toBeNull();
    await page.getByRole("button", { name: "Cerrar resultados" }).click();

    // Cuánto scrolleó cada contenedor: tiene que seguir igual después de usar el globo.
    const scrollOffsets = (): Promise<string> =>
      page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((element) => element.scrollTop > 0)
          .map((element) => `${element.tagName}:${element.scrollTop}`)
          .join(" "),
      );
    const before = await scrollOffsets();

    await page.mouse.move(box!.x + 2, box!.y - 7);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height + 7, { steps: 6 });
    await page.mouse.up();
    const popover = page.getByRole("dialog", { name: "Agregar la selección como entidad" });
    await expect(popover).toBeVisible();
    await expect(popover.locator("b")).toHaveText("«DNI»");

    // Entero dentro del área visible: la ventana y los ancestros que recortan.
    const fits = await popover.evaluate((element) => {
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
    expect(fits, "el globo queda entero dentro del visor").toBe(true);

    await popover.getByRole("button", { name: "Cancelar" }).click();
    await expect(popover).toHaveCount(0);
    expect(await scrollOffsets(), "cancelar no movió el documento").toBe(before);
  });
}
