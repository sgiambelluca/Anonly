import { expect, expectDownloadFilename, openApp, test } from "./support/electronApp.js";
import { interactionOnePageFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(180_000);

test("reabre la exportación vigente y pide volver a exportar tras editar un grupo", async ({
  page,
  electronApp,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const file = await interactionOnePageFile();
  await page.locator('input[type="file"]').setInputFiles(file);
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 45_000 });
  const group = page.getByRole("treeitem", { name: "34.567.891" });
  await expect(group).toBeVisible();

  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await dialog.getByRole("textbox", { name: "Nombre del archivo" }).fill("inicial.pdf");
  await dialog.getByRole("button", { name: "Exportar", exact: true }).click();
  const download = dialog.getByRole("link", { name: "Descargar" });
  await expect(download).toBeVisible({ timeout: 60_000 });
  expect(
    await expectDownloadFilename(electronApp, async () => {
      await download.click();
    }),
  ).toBe("inicial.pdf");
  await expect(dialog.getByText("Se descargó inicial.pdf")).toBeVisible();
  await dialog.getByRole("button", { name: "Listo" }).click();
  await expect(dialog).toHaveCount(0);

  await exportButton.click();
  await expect(dialog.getByRole("link", { name: "Descargar" })).toHaveAttribute(
    "download",
    "inicial.pdf",
  );
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toHaveCount(0);

  const modeSelect = group.getByRole("button", { name: /^Modo de reemplazo de / });
  await modeSelect.click();
  await page
    .getByRole("group", { name: "Modo de reemplazo" })
    .getByRole("button", { name: /^Ocultar parcialmente/ })
    .click();
  await expect(modeSelect).toHaveAccessibleName(/Ocultar parcialmente/);

  await exportButton.click();
  await expect(
    dialog
      .getByRole("status")
      .getByText("Ya exportaste este documento anteriormente. Hay cambios pendientes de exportar."),
  ).toBeVisible();
  await dialog.getByRole("textbox", { name: "Nombre del archivo" }).fill("actualizado.pdf");
  await dialog.getByRole("button", { name: "Exportar", exact: true }).click();
  const updatedDownload = dialog.getByRole("link", { name: "Descargar" });
  await expect(updatedDownload).toBeVisible({ timeout: 60_000 });
  expect(
    await expectDownloadFilename(electronApp, async () => {
      await updatedDownload.click();
    }),
  ).toBe("actualizado.pdf");
});
