/**
 * El menú de modos de una fila de la lista de entidades tiene que leerse
 * entero sin scrollear, también en las últimas filas.
 *
 * La lista scrollea y recorta lo que se sale. El menú abría siempre hacia
 * abajo, así que en las últimas filas quedaba tapado. Ahora abre hacia arriba
 * cuando abajo no entra (`entities/menuPlacement.ts`).
 */

import { type ElectronApplication, type Locator, type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";
import { setContentSizeAndWait } from "./support/windowSize.js";

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

async function everyOptionIsReachableByTab(
  page: Page,
  trigger: Locator,
  menu: Locator,
  tree: Locator,
): Promise<void> {
  const options = menu.getByRole("button");
  const externalScrollBefore = await tree.evaluate((element) => element.scrollTop);
  await trigger.focus();
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    await expect(options.nth(index)).toBeFocused();
    expect(
      await options.nth(index).evaluate((element) => {
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

/**
 * `true` si alguna opción queda, aunque sea en parte, fuera del área visible del
 * propio menú. Un menú puede desbordar su límite solo por el padding de abajo:
 * entonces tiene scroll interno pero ninguna opción necesita scrollear para verse.
 */
async function someOptionIsClipped(menu: Locator): Promise<boolean> {
  return menu.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const top = rect.top + (Number.parseFloat(style.borderTopWidth) || 0);
    const bottom = rect.bottom - (Number.parseFloat(style.borderBottomWidth) || 0);
    return [...element.querySelectorAll("button")].some((option) => {
      const optionRect = option.getBoundingClientRect();
      return optionRect.top < top - 0.5 || optionRect.bottom > bottom + 0.5;
    });
  });
}

async function everyOptionCanBeReached(
  page: Page,
  trigger: Locator,
  menu: Locator,
  tree: Locator,
): Promise<void> {
  await expect.poll(() => menuFitsClippingBoundary(page, menu)).toBe(true);
  const metrics = await menuMetrics(page, menu);
  const options = menu.getByRole("button");
  const externalScrollBefore = await tree.evaluate((element) => element.scrollTop);
  if (metrics.intrinsicHeight <= metrics.boundaryHeight) {
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    expect(metrics.scrollTop).toBe(0);
    expect(await everyOptionIsOnTop(page, menu)).toBe(true);
    return;
  }
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  // Antes de recorrer: scrollIntoViewIfNeeded y Tab ya mueven el scroll interno.
  const clippedBeforeTraversal = await someOptionIsClipped(menu);
  for (let index = 0; index < (await options.count()); index += 1) {
    const option = options.nth(index);
    await option.scrollIntoViewIfNeeded();
    expect(
      await option.evaluate((element) => {
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
  await everyOptionIsReachableByTab(page, trigger, menu, tree);
  // El scroll interno solo es obligatorio si alguna opción estaba recortada.
  if (clippedBeforeTraversal) {
    expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
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

test("el menú de modos se mantiene visible y permite recorrer opciones en scroll interno", async ({
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

  const tree = page.getByRole("tree", { name: "Entidades detectadas" });
  const triggers = tree.getByRole("button", { name: /^Modo de reemplazo de / });
  await expect(triggers.first()).toBeVisible();
  const menu = page.getByRole("group", { name: "Modo de reemplazo" });

  // Una fila de arriba: abre hacia abajo, como siempre.
  await triggers.first().click();
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  await everyOptionCanBeReached(page, triggers.first(), menu, tree);

  // ResizeObserver vuelve a acomodar un menú con el tamaño nativo disponible.
  const nativeWideBounds = await resizeToNativeWideArea(page, electronApp);
  expect(nativeWideBounds.width).toBeGreaterThan(0);
  expect(nativeWideBounds.height).toBeGreaterThan(0);
  await everyOptionCanBeReached(page, triggers.first(), menu, tree);

  // Obliga una región de recorte pequeña para cubrir el fallback de scroll interno.
  await tree.evaluate((element) => {
    element.style.flex = "none";
    element.style.height = "150px";
  });
  await expect
    .poll(() => menu.evaluate((element) => element.clientHeight))
    .toBeLessThanOrEqual(150);
  expect(await menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await menuFitsClippingBoundary(page, menu)).toBe(true);
  await everyOptionCanBeReached(page, triggers.first(), menu, tree);
  expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await tree.evaluate((element) => {
    element.style.removeProperty("flex");
    element.style.removeProperty("height");
  });
  await expect.poll(() => menu.evaluate((element) => element.clientHeight)).toBeGreaterThan(150);
  const afterReflow = await menuMetrics(page, menu);
  if (afterReflow.intrinsicHeight <= afterReflow.boundaryHeight) {
    await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBe(0);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // La última fila, llevada al borde de abajo del área visible.
  const last = triggers.last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(menu).toHaveAttribute("data-placement", "top");
  await everyOptionCanBeReached(page, last, menu, tree);
});
