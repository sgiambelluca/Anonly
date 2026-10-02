/**
 * El menú de modos de una fila de la lista de entidades tiene que leerse
 * entero sin scrollear, también en las últimas filas.
 *
 * La lista scrollea y recorta lo que se sale. El menú abría siempre hacia
 * abajo, así que en las últimas filas quedaba tapado. Ahora abre hacia arriba
 * cuando abajo no entra (`entities/menuPlacement.ts`).
 */

import { type Locator, type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

/** `true` si las cuatro opciones del menú son lo que está arriba de todo en su centro. */
async function everyOptionIsOnTop(page: Page, menu: Locator): Promise<boolean> {
  const handle = await menu.elementHandle();
  if (handle === null) return false;
  return page.evaluate((element) => {
    const options = [...element.querySelectorAll("button")];
    return (
      options.length === 4 &&
      options.every((option) => {
        const rect = option.getBoundingClientRect();
        const top = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return top !== null && option.contains(top);
      })
    );
  }, handle);
}

test("el menú de modos de la última fila se lee entero sin scrollear", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  const triggers = page.getByRole("button", { name: /^Modo de reemplazo de / });
  await expect(triggers.first()).toBeVisible();
  const menu = page.getByRole("group", { name: "Modo de reemplazo" });

  // Una fila de arriba: abre hacia abajo, como siempre.
  await triggers.first().click();
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  expect(await everyOptionIsOnTop(page, menu)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // La última fila, llevada al borde de abajo del área visible.
  const last = triggers.last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(menu).toHaveAttribute("data-placement", "top");
  expect(await everyOptionIsOnTop(page, menu)).toBe(true);
});
