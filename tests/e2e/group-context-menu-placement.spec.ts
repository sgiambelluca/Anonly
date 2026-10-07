import { type ElectronApplication, type Locator, type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";
import { setContentSizeAndWait } from "./support/windowSize.js";

async function menuFitsClippingBoundary(page: Page, menu: Locator): Promise<boolean> {
  const handle = await menu.elementHandle();
  if (handle === null) return false;
  return page.evaluate((element) => {
    const menuRect = element.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).overflowY === "visible") continue;
      const rect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    return menuRect.top >= top - 0.5 && menuRect.bottom <= bottom + 0.5;
  }, handle);
}

async function menuMetrics(
  page: Page,
  menu: Locator,
): Promise<{
  readonly intrinsicHeight: number;
  readonly boundaryHeight: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
}> {
  const handle = await menu.elementHandle();
  if (handle === null) throw new Error("El menú no está montado");
  return page.evaluate((element) => {
    let top = 0;
    let bottom = window.innerHeight;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).overflowY === "visible") continue;
      const rect = node.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    const style = getComputedStyle(element);
    return {
      intrinsicHeight:
        element.scrollHeight +
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0),
      boundaryHeight: Math.max(0, bottom - top),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
    };
  }, handle);
}

async function everyMenuButtonCanBeReached(
  page: Page,
  trigger: Locator,
  menu: Locator,
  tree: Locator,
): Promise<void> {
  await expect.poll(() => menuFitsClippingBoundary(page, menu)).toBe(true);
  const metrics = await menuMetrics(page, menu);
  const buttons = menu.getByRole("button");
  const externalScrollBefore = await tree.evaluate((element) => element.scrollTop);
  if (metrics.intrinsicHeight <= metrics.boundaryHeight) {
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    expect(metrics.scrollTop).toBe(0);
    expect(await everyMenuButtonIsReachable(page, menu)).toBe(true);
  } else {
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      await button.scrollIntoViewIfNeeded();
      expect(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && element.contains(hit);
        }),
      ).toBe(true);
      expect(await tree.evaluate((element) => element.scrollTop)).toBe(externalScrollBefore);
    }
    await trigger.focus();
    for (let index = 0; index < (await buttons.count()); index += 1) {
      await page.keyboard.press("Tab");
      await expect(buttons.nth(index)).toBeFocused();
      expect(
        await buttons.nth(index).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && element.contains(hit);
        }),
      ).toBe(true);
      expect(await tree.evaluate((element) => element.scrollTop)).toBe(externalScrollBefore);
    }
  }
}

async function resizeToNativeWideArea(
  page: Page,
  electronApp: ElectronApplication,
): Promise<{ readonly width: number; readonly height: number }> {
  const requested = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const appWindow = BrowserWindow.getAllWindows()[0];
    const workArea = screen.getDisplayMatching(
      appWindow?.getBounds() ?? { x: 0, y: 0, width: 1024, height: 700 },
    ).workAreaSize;
    return {
      width: Math.min(1440, workArea.width),
      height: Math.max(700, Math.min(900, workArea.height - 80)),
    };
  });
  return setContentSizeAndWait(page, electronApp, requested);
}

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

test("el menú ⋯ queda visible y alcanzable con tamaño mínimo y nativo", async ({
  page,
  electronApp,
}) => {
  const minimumBounds = await setContentSizeAndWait(page, electronApp, {
    width: 1024,
    height: 700,
  });
  if (process.platform === "win32") expect(minimumBounds).toEqual({ width: 1024, height: 700 });
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  const triggers = page.getByRole("button", { name: "Más acciones" });
  await expect(triggers.first()).toBeVisible();
  const menu = page.getByRole("group", { name: "Acciones del grupo" });

  const tree = page.getByRole("tree", { name: "Entidades detectadas" });
  const scrollBeforeOpen = await tree.evaluate((element) => element.scrollTop);
  await triggers.first().click();
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  await everyMenuButtonCanBeReached(page, triggers.first(), menu, tree);
  expect(await tree.evaluate((element) => element.scrollTop)).toBe(scrollBeforeOpen);

  await menu.getByRole("button", { name: "Ver apariciones" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Buscar en el documento" })).toHaveValue(
    /34\.567\.891/,
  );

  await triggers.first().click();
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  await tree.evaluate((element) => {
    element.style.flex = "none";
    element.style.height = "150px";
  });
  await expect
    .poll(() => menu.evaluate((element) => element.clientHeight))
    .toBeLessThanOrEqual(150);
  await everyMenuButtonCanBeReached(page, triggers.first(), menu, tree);
  expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await tree.evaluate((element) => {
    element.style.removeProperty("flex");
    element.style.removeProperty("height");
  });
  await expect.poll(() => menu.evaluate((element) => element.clientHeight)).toBeGreaterThan(150);
  await everyMenuButtonCanBeReached(page, triggers.first(), menu, tree);

  const nativeWideBounds = await resizeToNativeWideArea(page, electronApp);
  expect(nativeWideBounds.width).toBeGreaterThan(0);
  expect(nativeWideBounds.height).toBeGreaterThan(0);
  await everyMenuButtonCanBeReached(page, triggers.first(), menu, tree);
  await setContentSizeAndWait(page, electronApp, { width: 1024, height: 700 });
  await everyMenuButtonCanBeReached(page, triggers.first(), menu, tree);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  const last = triggers.last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(menu).toHaveAttribute("data-placement", "top");
  await everyMenuButtonCanBeReached(page, last, menu, tree);
});
