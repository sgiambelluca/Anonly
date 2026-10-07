import type { ElectronApplication } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { interactionOnePageFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

async function sendUpdaterEvent(electronApp: ElectronApplication, type: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, eventType) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("updater:event", { type: eventType });
  }, type);
}

async function replaceUpdaterCheckWithControlledHandler(
  electronApp: ElectronApplication,
): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners("updater:check");
    // Success/error outcomes are injected by this spec, so a real unpackaged
    // check cannot race those assertions with check-unavailable.
    ipcMain.on("updater:check", () => undefined);
  });
}

test("Windows sin empaquetar informa que no puede buscar desde el botón manual", async ({
  page,
}) => {
  test.skip(process.platform !== "win32", "El resultado omitido de electron-updater es de Windows");
  await installSettingsOverride(page, {});
  await page.addInitScript(() => {
    const key = "anonly:settings";
    const current = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(key, JSON.stringify({ ...current, updateMode: "off" }));
  });
  await openApp(page, "networkidle");
  await page.getByRole("button", { name: "Configuración" }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  const searchButton = dialog.getByRole("button", { name: "Buscar actualizaciones ahora" });
  await searchButton.click();

  const unavailable = dialog.getByText("Para buscar actualizaciones, abrí la app instalada.", {
    exact: true,
  });
  await expect(unavailable).toBeVisible({ timeout: 10_000 });
  await expect(
    dialog.getByText("Estás utilizando la última versión.", { exact: true }),
  ).toHaveCount(0);
  const statusBox = await unavailable.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(statusBox!.x).toBeGreaterThanOrEqual(dialogBox!.x + 1);
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width - 1);
  await dialog.getByRole("button", { name: "Cerrar" }).click();
});

test("solo update-not-available de una búsqueda manual confirma la versión instalada", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, {});
  await page.addInitScript(() => {
    const key = "anonly:settings";
    const current = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(key, JSON.stringify({ ...current, updateMode: "off" }));
  });
  await openApp(page);
  await replaceUpdaterCheckWithControlledHandler(electronApp);
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1024, 768);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(1024);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(900);

  await page.getByRole("button", { name: "Configuración" }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("radio", { name: "Claro" }).click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Configuración" }).click();
  const lightDialog = page.getByRole("dialog", { name: "Configuración" });
  const searchButton = lightDialog.getByRole("button", {
    name: "Buscar actualizaciones ahora",
  });
  const currentVersion = lightDialog.getByText("Estás utilizando la última versión.", {
    exact: true,
  });
  await sendUpdaterEvent(electronApp, "update-not-available");
  await expect(currentVersion).toHaveCount(0);

  await searchButton.click();
  await sendUpdaterEvent(electronApp, "checking");
  await expect(currentVersion).toHaveCount(0);
  await sendUpdaterEvent(electronApp, "error");
  await expect(currentVersion).toHaveCount(0);

  await searchButton.click();
  await sendUpdaterEvent(electronApp, "update-available");
  await expect(currentVersion).toHaveCount(0);

  await searchButton.click();
  await sendUpdaterEvent(electronApp, "update-not-available");
  await expect(currentVersion).toBeVisible();
  const confirmation = await currentVersion.boundingBox();
  const dialogBox = await lightDialog.boundingBox();
  expect(confirmation).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(confirmation?.x).toBeGreaterThanOrEqual((dialogBox?.x ?? 0) + 1);
  expect((confirmation?.x ?? 0) + (confirmation?.width ?? 0)).toBeLessThanOrEqual(
    (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) - 1,
  );

  await lightDialog.getByRole("radio", { name: "Oscuro" }).click();
  await lightDialog.getByRole("button", { name: "Guardar" }).click();
  await expect(lightDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Configuración" }).click();
  const reopened = page.getByRole("dialog", { name: "Configuración" });
  const reopenedConfirmation = reopened.getByText("Estás utilizando la última versión.", {
    exact: true,
  });
  await expect(reopenedConfirmation).toHaveCount(0);
  await reopened.getByRole("button", { name: "Buscar actualizaciones ahora" }).click();
  await expect(reopenedConfirmation).toHaveCount(0);
  await sendUpdaterEvent(electronApp, "update-not-available");
  await expect(reopenedConfirmation).toBeVisible();
  await expect
    .poll(() => reopenedConfirmation.evaluate((element) => getComputedStyle(element).color))
    .not.toBe("rgba(0, 0, 0, 0)");

  await reopened.getByRole("button", { name: "Cerrar" }).click();
});

test("la confirmación de actualización se suscribe y limpia al reabrir tras cambiar de pantalla", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false, updateMode: "off" });
  await openApp(page, "networkidle");
  await replaceUpdaterCheckWithControlledHandler(electronApp);

  await page.getByRole("button", { name: "Configuración" }).click();
  const loadSettings = page.getByRole("dialog", { name: "Configuración" });
  await expect(loadSettings).toBeVisible();
  await loadSettings.getByRole("button", { name: "Cerrar" }).click();
  await expect(loadSettings).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles(await interactionOnePageFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });

  await page.getByRole("button", { name: "Configuración" }).click();
  const toolbarSettings = page.getByRole("dialog", { name: "Configuración" });
  const confirmation = toolbarSettings.getByText("Estás utilizando la última versión.", {
    exact: true,
  });
  await expect(confirmation).toHaveCount(0);
  await toolbarSettings.getByRole("button", { name: "Buscar actualizaciones ahora" }).click();
  await sendUpdaterEvent(electronApp, "checking");
  await expect(confirmation).toHaveCount(0);
  await sendUpdaterEvent(electronApp, "update-not-available");
  await expect(confirmation).toBeVisible();

  await toolbarSettings.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Configuración" }).click();
  const reopened = page.getByRole("dialog", { name: "Configuración" });
  const reopenedConfirmation = reopened.getByText("Estás utilizando la última versión.", {
    exact: true,
  });
  await expect(reopenedConfirmation).toHaveCount(0);
  await reopened.getByRole("button", { name: "Cerrar" }).click();
});
