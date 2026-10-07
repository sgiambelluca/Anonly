import type { Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

async function deleteFirstEntity(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Más acciones" }).first().click();
  const menu = page.getByRole("group", { name: "Acciones del grupo" });
  await menu.getByRole("button", { name: "Eliminar entidad" }).click();
  const confirmation = page.getByRole("dialog", { name: "Eliminar entidad" });
  await confirmation.getByRole("button", { name: "Eliminar" }).click();
  await expect(confirmation).toHaveCount(0);
}

test("la eliminación muestra su tono, reemplaza el toast previo y expira a los tres segundos", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  await deleteFirstEntity(page);
  const firstToast = page.locator('li[data-state="open"]').filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(firstToast).toBeVisible();
  await expect(firstToast.getByRole("button", { name: "Deshacer" })).toBeVisible();
  expect(
    await firstToast.evaluate((toast) => ({
      backgroundImage: getComputedStyle(toast).backgroundImage,
      backgroundColor: getComputedStyle(toast).backgroundColor,
      borderColor: getComputedStyle(toast).borderTopColor,
    })),
  ).toMatchObject({
    backgroundImage: expect.stringContaining("linear-gradient"),
    backgroundColor: expect.not.stringContaining("rgba(0, 0, 0, 0)"),
  });
  const firstTitle = await firstToast.getByText(/^Eliminaste/).textContent();

  const shownAt = Date.now();
  await deleteFirstEntity(page);
  const secondToast = page.locator('li[data-state="open"]').filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(secondToast).toBeVisible();
  const secondTitle = await secondToast.getByText(/^Eliminaste/).textContent();
  expect(secondTitle).not.toBe(firstTitle);
  const undo = secondToast.getByRole("button", { name: "Deshacer" });
  await expect(undo).toBeVisible();
  await expect(undo).toBeEnabled();
  expect(await secondToast.evaluate((element) => element.hasAttribute("inert"))).toBe(false);

  await expect(secondToast).toHaveCount(0, { timeout: 4_500 });
  expect(Date.now() - shownAt).toBeGreaterThanOrEqual(2_800);
});

test("el cierre manual y una acción conservan el toast durante su animación inversa", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  const watchExit = async (toast: ReturnType<typeof page.locator>) =>
    toast.evaluate(
      (element) =>
        new Promise<{ readonly name: string; readonly durationMs: number }>((resolve) => {
          const onAnimationStart = (event: Event): void => {
            const animation = event as AnimationEvent;
            if (animation.animationName !== "anonly-toast-out") return;
            element.removeEventListener("animationstart", onAnimationStart);
            const duration = getComputedStyle(element).animationDuration.split(",")[0]!.trim();
            const durationValue = Number.parseFloat(duration);
            resolve({
              name: animation.animationName,
              durationMs: duration.endsWith("ms") ? durationValue : durationValue * 1000,
            });
          };
          element.addEventListener("animationstart", onAnimationStart);
        }),
    );

  await deleteFirstEntity(page);
  const first = page.locator('li[data-state="open"]').filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(first).toBeVisible();
  const firstExit = watchExit(first);
  // File import leaves the hidden file input focused; shortcuts intentionally
  // preserve native editing there, so put focus on a neutral heading first.
  await page.getByRole("heading", { name: "Entidades" }).click();
  await page.keyboard.press("Control+z");
  expect(await firstExit).toEqual({ name: "anonly-toast-out", durationMs: 260 });
  await expect(first).toHaveCount(0);

  await deleteFirstEntity(page);
  const manual = page.locator('li[data-state="open"]').filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(manual).toBeVisible();
  const entityCountBeforeExit = await page.getByRole("treeitem").count();
  const manualExit = watchExit(manual);
  await manual.getByRole("button", { name: "Cerrar aviso" }).click();
  const exitingToast = page.locator("li.anonly-toast-out").filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(exitingToast).toBeVisible();
  const closedToastState = await exitingToast.evaluate((element) => {
    const buttons = Array.from(element.querySelectorAll("button"));
    return {
      tabIndex: element.getAttribute("tabindex"),
      hidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
      focusInside: element.contains(document.activeElement),
      controlsDisabled: buttons.length > 0 && buttons.every((button) => button.disabled),
    };
  });
  expect(closedToastState).toEqual({
    tabIndex: "-1",
    hidden: "true",
    inert: true,
    focusInside: false,
    controlsDisabled: true,
  });
  expect(
    await exitingToast.evaluate((element) => {
      element.focus();
      return element.contains(document.activeElement);
    }),
  ).toBe(false);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("li.anonly-toast-out")?.contains(document.activeElement) ?? false,
    ),
  ).toBe(false);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("li.anonly-toast-out")?.contains(document.activeElement) ?? false,
    ),
  ).toBe(false);
  await page.getByRole("heading", { name: "Entidades" }).evaluate((heading) => {
    heading.tabIndex = -1;
    heading.focus();
  });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("treeitem")).toHaveCount(entityCountBeforeExit);
  expect(await manualExit).toEqual({ name: "anonly-toast-out", durationMs: 260 });
  await expect(manual).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await deleteFirstEntity(page);
  const second = page.locator('li[data-state="open"]').filter({
    has: page.getByText(/^Eliminaste/),
  });
  await expect(second).toBeVisible();
  await expect
    .poll(() => second.evaluate((element) => getComputedStyle(element).animationName))
    .toBe("none");
  await second.getByRole("button", { name: "Deshacer" }).click();
  await expect(second).toHaveCount(0);
});
