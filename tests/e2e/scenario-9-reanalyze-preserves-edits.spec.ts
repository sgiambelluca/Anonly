/**
 * Escenario 9 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 9):
 * un `reanalyze` (ADR-038) **preserva las ediciones previas del usuario**: un
 * grupo que deshabilitó sigue deshabilitado, una decisión por tipo sigue
 * aplicando, un merge manual persiste.
 *
 * **Qué cambió con ADR-126** (y por qué este archivo se llama distinto): el
 * escenario decía "activar NER en runtime", y ese era el disparador —el
 * checkbox de detección de nombres en `SettingsDialog`—, no lo que medía. Ese
 * control se retiró: la detección de nombres pasó a estar siempre activa,
 * porque apagarla solo puede dejar datos sin detectar, y un análisis al que le
 * faltan justamente los nombres no sirve. Con el control se fue también la
 * única forma de activarla en runtime.
 *
 * Lo que el escenario mide sigue igual y sigue disponible: `ocrLanguages` es
 * el otro setting que dispara `reanalyze` con confirmación (ADR-038 §7), y las
 * tres ediciones tienen que sobrevivir esa segunda pasada lo mismo. Lo que se
 * perdió es la mitad "se descarga el modelo de nombres en runtime", que ya no
 * describe ningún camino de usuario — la cobertura de que el detector corre y
 * llega a la UI vive en `scenario-5-edit-during-ner.spec.ts` (ADR-055 §6).
 *
 * Arranca con la detección de nombres apagada por el canal de override
 * (`installSettingsOverride`, ADR-126 §3: un canal de test, no una preferencia
 * — nada en la app escribe esa clave) para llegar a `Ready` rápido solo con
 * Regex. Las tres ediciones se hacen sobre grupos de tipo DNI; la decisión
 * "por tipo" se toma desde la cabecera de la categoría en el árbol, que es
 * donde ADR-087 §3 puso ese nivel al retirar el panel de Reglas.
 *
 * El timeout global baja de 480 s a 240 s: sin descarga de modelo en la
 * segunda pasada, el paso más caro desapareció.
 */
import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(240_000);

test("un reanalyze preserva las ediciones previas del usuario", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // Ready rápido: sin NER, solo Regex.
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 30_000 });

  // Los tres DNI de `text-10p.pdf` (README): 34.567.891 (pág. 1), 18.445.212
  // (pág. 2), 42.998.103 (pág. 3).
  const dni1 = page.getByRole("treeitem", { name: "34.567.891" });
  const dni2 = page.getByRole("treeitem", { name: "18.445.212" });
  const dni3 = page.getByRole("treeitem", { name: "42.998.103" });
  await expect(dni1).toBeVisible();
  await expect(dni2).toBeVisible();
  await expect(dni3).toBeVisible();

  // Edición 1: deshabilitar 34.567.891.
  await dni1.getByRole("checkbox", { name: "Habilitar 34.567.891" }).click();
  await expect(dni1).toHaveAttribute("aria-checked", "false");

  // Edición 2: fusionar 42.998.103 (origen) dentro de 18.445.212 (destino) —
  // merge manual.
  await dni3.getByRole("button", { name: "Más acciones" }).click();
  await dni3
    .getByRole("group", { name: "Acciones del grupo" })
    .getByRole("button", { name: "Fusionar con…" })
    .click();
  const mergeDialog = page.getByRole("dialog", { name: "Fusionar grupo" });
  await expect(mergeDialog).toBeVisible();
  await mergeDialog.getByRole("combobox", { name: "Grupo destino 1" }).click();
  await page.getByRole("option", { name: /18\.445\.212/ }).click();
  await mergeDialog.getByRole("button", { name: "Fusionar" }).click();
  await expect(mergeDialog).toHaveCount(0);
  await expect(dni3).toHaveCount(0);
  await expect(dni2).toContainText("(2)");

  // Edición 3: decisión "por tipo" sobre DNI — debe seguir aplicando tras el
  // reanalyze.
  //
  // ADR-087 §3 retiró el panel de Reglas y su diálogo "Nueva regla": el nivel
  // "tipo" pasó a la cabecera de la categoría en el propio árbol. Lo que se
  // escribe abajo es lo MISMO —una `Rule` de scope `type` (§3.1a)—, así que
  // este escenario sigue cubriendo lo que decía cubrir: que una decisión de
  // alcance tipo sobrevive al reanalyze. Cambia por dónde la toma el usuario.
  //
  // Sin diálogo de confirmación: §3.3 solo lo pide cuando ese tipo tiene filas
  // con decisión propia, y acá ninguna la tiene todavía (las ediciones 1 y 2
  // fueron deshabilitar y fusionar).
  const dniTypeMode = page.getByRole("button", { name: /^Modo de reemplazo de DNI:/ });
  await dniTypeMode.click();
  await page
    .getByRole("group", { name: "Modo de reemplazo" })
    .getByRole("button", { name: /^Ocultar parcialmente/ })
    .click();

  // Ya afecta a los grupos DNI existentes (recomputo de `replacementMode`).
  await expect(dni1.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Ocultar parcialmente/,
  );
  await expect(dni2.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Ocultar parcialmente/,
  );

  // Disparar el reanalyze con el documento abierto.
  await page.getByRole("button", { name: "Configuración" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Configuración" });
  await expect(settingsDialog).toBeVisible();

  // Atribución CC-BY visible en el producto (ADR-070 §5, ADR-060 §11): el
  // crédito del léxico de género y el enlace a su licencia se ven dentro del
  // diálogo que ya está abierto para este escenario.
  const aboutSection = settingsDialog.getByRole("region", { name: "Acerca de" });
  await expect(aboutSection).toBeVisible();
  await expect(aboutSection.getByRole("link", { name: /Nombres Permitidos/ })).toBeVisible();
  const licenseLink = aboutSection.getByRole("link", { name: "CC-BY-2.5-AR" });
  await expect(licenseLink).toBeVisible();
  await expect(licenseLink).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/2.5/ar/",
  );

  /*
   * El disparador es **Idiomas del documento**. Hasta ADR-126 este escenario
   * activaba acá la detección de nombres, que era el otro setting que dispara
   * `reanalyze` con confirmación (ADR-038 §7) — y dejó de existir como control
   * cuando esa detección pasó a estar siempre activa. `ocrLanguages` sigue
   * siendo del usuario y sigue disparando el mismo camino, que es el que este
   * escenario mide.
   */
  await settingsDialog.getByRole("checkbox", { name: "Inglés" }).click();
  await settingsDialog.getByRole("button", { name: "Guardar" }).click();

  const confirmReanalyze = page.getByRole("dialog", { name: "Reanalizar documento" });
  await expect(confirmReanalyze).toBeVisible();
  await confirmReanalyze.getByRole("button", { name: "Reanalizar" }).click();

  // El reanálisis pasa por Detecting y vuelve a Ready: el diálogo
  // de confirmación se cierra solo al terminar (`SettingsDialog.tsx`,
  // `handleConfirmReanalyze`) y `ExportButton` reaparece.
  await expect(confirmReanalyze).toHaveCount(0, { timeout: 240_000 });
  await expect(exportButton).toBeVisible({ timeout: 30_000 });

  // Las tres ediciones sobrevivieron la segunda pasada.
  await expect(dni1).toHaveAttribute("aria-checked", "false");
  await expect(dni1.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Ocultar parcialmente/,
  );
  await expect(dni2).toContainText("(2)");
  await expect(dni2.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Ocultar parcialmente/,
  );
  await expect(dni3).toHaveCount(0);
});
