import { type Locator, type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

async function everyMenuButtonIsReachable(page: Page, menu: Locator): Promise<boolean> {
  const handle = await menu.elementHandle();
  if (handle === null) return false;
  return page.evaluate((element) => {
    const buttons = [...element.querySelectorAll("button")];
    return (
      buttons.length > 0 &&
      buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        const top = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return top !== null && button.contains(top);
      })
    );
  }, handle);
}

test("el menú ⋯ cabe hacia abajo en una fila alta y hacia arriba al final", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  const triggers = page.getByRole("button", { name: "Más acciones" });
  await expect(triggers.first()).toBeVisible();
  const menu = page.getByRole("group", { name: "Acciones del grupo" });

  await triggers.first().click();
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  expect(await everyMenuButtonIsReachable(page, menu)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  const last = triggers.last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(menu).toHaveAttribute("data-placement", "top");
  expect(await everyMenuButtonIsReachable(page, menu)).toBe(true);
});
