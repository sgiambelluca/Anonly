/**
 * Choque de un agregado manual (ADR-174 §4, ADR-175 §4, `Components.md` §6.3).
 *
 * Ningún test unitario monta `ManualOverlapDialog`, y su selector devolvía un array nuevo en cada
 * llamada (Zustand 5 sin `useShallow`), lo que puede dejar el diálogo en un
 * bucle de render. `apps/react-client` no tiene librería de DOM para tests
 * (R-12), así que el montaje real se prueba acá, sobre la app empaquetada.
 *
 * `text-10p.pdf` trae el DNI 34.567.891 detectado. Marcarlo a mano como
 * Teléfono choca con esa detección (mismo texto, otro tipo): el agregado queda
 * retenido y se abre el diálogo de choques, que bloquea el export hasta que se
 * resuelve.
 *
 * NER desactivado (mismo mecanismo que `scenario-8-ner-disabled.spec.ts`): el
 * escenario ejercita Grouping y la UI de choques, no NER.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(120_000);

test("agregar a mano una entidad que choca con una detectada abre el diálogo y se resuelve", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible();

  // Lupa → «Agregar» → Teléfono: el mismo texto que el DNI detectado.
  await page.getByRole("searchbox", { name: "Buscar en el documento" }).fill("34.567.891");
  const addFromSearch = page.getByRole("button", { name: "Agregar", exact: true });
  await expect(addFromSearch).toBeEnabled({ timeout: 15_000 });
  await addFromSearch.click();

  const addPopover = page.getByRole("dialog", { name: "Agregar la búsqueda como entidad" });
  await expect(addPopover).toBeVisible();
  await addPopover.getByRole("radio", { name: /Teléfono/ }).click();
  await addPopover.getByRole("button", { name: "Agregar", exact: true }).click();

  // El diálogo de choques se monta (si el selector entrara en bucle, la página
  // se colgaría o el diálogo nunca quedaría estable).
  const overlapDialog = page.getByRole("dialog", { name: "Se superpone con una detección" });
  await expect(overlapDialog).toBeVisible({ timeout: 15_000 });
  await expect(overlapDialog.getByText("Lo que marcaste", { exact: true })).toBeVisible();
  await expect(
    overlapDialog.getByText("Lo que ya estaba detectado", { exact: true }),
  ).toBeVisible();

  await overlapDialog.getByRole("button", { name: "Ocultar lo que marqué" }).click();
  await expect(overlapDialog).toHaveCount(0);

  // Nada pendiente: ni aviso persistente ni bloqueo del export.
  await expect(page.getByText(/Quedó un choque sin resolver/)).toHaveCount(0);
  await expect(page.getByText("El export está bloqueado hasta que elijas.")).toHaveCount(0);
});
