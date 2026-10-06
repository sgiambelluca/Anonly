import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test("un Select se cierra sin cerrar Configuración y el Escape cierra en orden", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Configuración" }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(dialog).toBeVisible();

  await page.getByRole("combobox", { name: "Actualizaciones" }).click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();

  await dialog.getByText("Elegí qué hace Anonly con las versiones nuevas.").click();
  await expect(listbox).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await page.getByRole("combobox", { name: "Actualizaciones" }).click();
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Configuración" }).click();
  const reopened = page.getByRole("dialog", { name: "Configuración" });
  await expect(reopened).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(reopened).toHaveCount(0);

  await page.getByRole("button", { name: "Configuración" }).click();
  const forBackdrop = page.getByRole("dialog", { name: "Configuración" });
  await expect(forBackdrop).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(forBackdrop).toHaveCount(0);
});

test("el diálogo de confirmación conserva su aislamiento sobre Configuración", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Configuración" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Configuración" });
  const englishCheckbox = settingsDialog.locator("#settings-ocr-eng");
  await englishCheckbox.click();
  await settingsDialog.getByRole("button", { name: "Guardar" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Reanalizar documento" });
  await expect(confirmDialog).toBeVisible();
  const checkedBefore = await englishCheckbox.getAttribute("aria-checked");
  const checkboxBox = await englishCheckbox.boundingBox();
  expect(checkboxBox).not.toBeNull();
  await page.mouse.click(
    (checkboxBox?.x ?? 0) + (checkboxBox?.width ?? 0) / 2,
    (checkboxBox?.y ?? 0) + (checkboxBox?.height ?? 0) / 2,
  );
  await expect(confirmDialog).toBeVisible();
  await expect(englishCheckbox).toHaveAttribute("aria-checked", checkedBefore ?? "false");

  await page.mouse.click(5, 5);
  await expect(confirmDialog).toHaveCount(0);
  await expect(settingsDialog).toBeVisible();

  await settingsDialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(settingsDialog).toHaveCount(0);
});
