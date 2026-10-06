import { expect, openApp, test } from "./support/electronApp.js";
import { interactionOnePageFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(120_000);

test("la lupa proyecta una coincidencia oculta al reemplazo y no permite seleccionarlo", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const file = await interactionOnePageFile();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible();

  await page.getByRole("tab", { name: "Anonimizado" }).click();
  await expect(page.getByRole("tab", { name: "Anonimizado" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
  await search.fill("DNI");

  const highlight = page
    .locator('[class*="border-warning-strong"][class*="bg-warning/30"]')
    .first();
  await expect(highlight).toBeVisible({ timeout: 15_000 });
  const dniBox = await highlight.boundingBox();
  expect(dniBox).not.toBeNull();
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  await expect(page.getByRole("region", { name: "Resultados de la búsqueda" })).toHaveCount(0);

  await search.fill("34.567.891");
  await expect
    .poll(async () => {
      const box = await highlight.boundingBox();
      return box === null ? null : `${box.x},${box.y},${box.width},${box.height}`;
    })
    .not.toBe(`${dniBox!.x},${dniBox!.y},${dniBox!.width},${dniBox!.height}`);
  const replacementBox = await highlight.boundingBox();
  expect(replacementBox).not.toBeNull();
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  await page.mouse.click(
    replacementBox!.x + replacementBox!.width / 2,
    replacementBox!.y + replacementBox!.height / 2,
  );

  // The hit is on the replacement label, whose visible region is covered by
  // the redaction map; it must not open the manual-entity selection popover.
  await expect(page.getByRole("dialog", { name: /Agregar .* como entidad/ })).toHaveCount(0);

  await search.fill("Nombre");
  await expect
    .poll(async () => {
      const box = await highlight.boundingBox();
      return box === null ? null : `${box.x},${box.y},${box.width},${box.height}`;
    })
    .not.toBe(
      `${replacementBox!.x},${replacementBox!.y},${replacementBox!.width},${replacementBox!.height}`,
    );
  const endBox = await highlight.boundingBox();
  expect(endBox).not.toBeNull();
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  await search.fill("DNI");
  await expect(highlight).toBeVisible();
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  const startX = dniBox!.x + dniBox!.width / 2;
  const startY = dniBox!.y + dniBox!.height / 2;
  const endX = endBox!.x + endBox!.width / 2;
  const endY = endBox!.y + endBox!.height / 2;
  const dragEndY = endY + 3;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, dragEndY, { steps: 8 });
  await expect(page.locator('[class*="border-accent"][class*="bg-accent/20"]')).toBeVisible();
  await page.mouse.up();

  const selectionDialog = page.getByRole("dialog", { name: "Agregar la selección como entidad" });
  await expect(selectionDialog).toBeVisible();
  await expect(selectionDialog.locator("b")).toHaveText("«DNI»");
  await selectionDialog.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByRole("button", { name: "DNI (1)" })).toBeVisible({ timeout: 15_000 });
});

test("el mismo arrastre que empieza en blanco selecciona el primer token visible en ambas vistas", async ({
  page,
}) => {
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

  const start = { x: box!.x + 2, y: box!.y - 7 };
  const end = { x: box!.x + box!.width - 2, y: box!.y + box!.height + 7 };
  const drag = async (from = start, to = end): Promise<void> => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  };
  const reverseStart = { x: end.x, y: end.y };
  const reverseEnd = { x: start.x, y: start.y };

  // El inicio está fuera de la palabra, pero el rectángulo real cubre la línea.
  await drag();
  const originalSelection = page.getByRole("dialog", { name: "Agregar la selección como entidad" });
  await expect(originalSelection).toBeVisible();
  await expect(originalSelection.locator("b")).toHaveText("«DNI»");
  await originalSelection.getByRole("button", { name: "Cancelar" }).click();
  await drag(reverseStart, reverseEnd);
  const originalReverseSelection = page.getByRole("dialog", {
    name: "Agregar la selección como entidad",
  });
  await expect(originalReverseSelection.locator("b")).toHaveText("«DNI»");
  await originalReverseSelection.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("tab", { name: "Anonimizado" }).click();
  await expect(page.getByRole("tab", { name: "Anonimizado" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await search.fill("DNI");
  await expect(highlight).toBeVisible();
  const anonymousBox = await highlight.boundingBox();
  expect(anonymousBox).not.toBeNull();
  expect(anonymousBox!.x).toBeCloseTo(box!.x, 0);
  expect(anonymousBox!.y).toBeCloseTo(box!.y, 0);
  await page.getByRole("button", { name: "Cerrar resultados" }).click();
  await drag();

  const anonymousSelection = page.getByRole("dialog", {
    name: "Agregar la selección como entidad",
  });
  await expect(anonymousSelection).toBeVisible();
  await expect(anonymousSelection.locator("b")).toHaveText("«DNI»");
  await anonymousSelection.getByRole("button", { name: "Cancelar" }).click();
  await drag(reverseStart, reverseEnd);
  const anonymousReverseSelection = page.getByRole("dialog", {
    name: "Agregar la selección como entidad",
  });
  await expect(anonymousReverseSelection.locator("b")).toHaveText("«DNI»");
});
