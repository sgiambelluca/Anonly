/**
 * Escenario 10 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 10):
 * "Fusionar y dividir grupos → verificar índices y reemplazos."
 *
 * `text-10p.pdf` (`tests/fixtures/README.md`) trae cada DNI con una única
 * ocurrencia, así que no hay nada que dividir hasta fusionar primero
 * (`03_Data_Model.md` §9: `members.length >= 1` en ambos lados de un split).
 * Este spec fusiona dos de los tres grupos DNI y después divide el
 * resultante, verificando en cada paso el conteo de ocurrencias
 * (`EntityGroupItem` — no hay `indexInType` expuesto en el DOM, solo se
 * verifica indirectamente por qué grupo "sobrevive" con qué identidad) y el
 * modo de reemplazo (`ReplacementModeSelect`), contra el algoritmo exacto de
 * `grouping.engine.ts` (`applyGroupMerge`/`doApplyGroupSplit`):
 * - Merge: "el grupo sobreviviente conserva su propia identidad (id,
 *   replacementMode, enabled); solo su indexInType puede bajar al del
 *   origen" — el DESTINO (target) es siempre el que sobrevive, y con un solo
 *   alias por lado el desempate de `canonicalValue` (`recomputeCanonicalValue`,
 *   frecuencia → longitud → orden de inserción en `aliases`) deja el valor
 *   del target sin cambios.
 * - Split: el grupo nuevo hereda el valor de la ocurrencia movida; el
 *   original recalcula su canónico sobre los members que le quedan.
 *
 * NER desactivado (mismo mecanismo que `scenario-8-ner-disabled.spec.ts`,
 * PR16.5): el escenario ejercita Grouping/merge/split puro, sin relación con
 * NER — desactivarlo evita ruido de timing y llega a `Ready` rápido.
 *
 * Timeout global con headroom real sobre la suma, en el peor caso, de los
 * `timeout` de los `expect` internos de abajo (~15 pasos secuenciales, la
 * mayoría con el timeout default de 5 s más el de 30 s del primer
 * `ExportButton`) — sin ese margen, un timeout global más ajustado podría
 * cortar la corrida con un mensaje genérico antes de que el paso más lento
 * tuviera chance de fallar con un mensaje claro.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(150_000);

test("fusionar y dividir grupos actualiza índices y reemplazos", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 30_000 });

  const dni1 = page.getByRole("treeitem", { name: "34.567.891" }); // pág. 1, menor índice
  const dni2 = page.getByRole("treeitem", { name: "18.445.212" }); // pág. 2
  await expect(dni1).toBeVisible();
  await expect(dni2).toBeVisible();
  await expect(dni1).toContainText("(1)");
  await expect(dni2).toContainText("(1)");

  // Fusionar: dni2 (origen) dentro de dni1 (destino) — dni1 sobrevive con su
  // propia identidad y conserva su canonicalValue (único alias en el
  // desempate de frecuencia/longitud/orden de inserción).
  await dni2.getByRole("button", { name: "Más acciones" }).click();
  await dni2
    .getByRole("group", { name: "Acciones del grupo" })
    .getByRole("button", { name: "Fusionar con…" })
    .click();
  const mergeDialog = page.getByRole("dialog", { name: "Fusionar grupo" });
  await expect(mergeDialog).toBeVisible();
  await mergeDialog.getByRole("combobox", { name: "Grupo destino 1" }).click();
  await page.getByRole("option", { name: /34\.567\.891/ }).click();
  await mergeDialog.getByRole("button", { name: "Fusionar" }).click();
  await expect(mergeDialog).toHaveCount(0);

  // dni2 desapareció; dni1 conserva su identidad con 2 ocurrencias.
  await expect(dni2).toHaveCount(0);
  await expect(dni1).toBeVisible();
  await expect(dni1).toContainText("(2)");

  // El reemplazo se recalcula sobre los members fusionados (ADR-029) pero el
  // modo sigue siendo el default (nadie lo tocó todavía).
  // ADR-087 §3/§4: el modo vive en el nombre accesible del disparador, con la
  // etiqueta nueva ("Placeholder" → "Etiquetar").
  await expect(dni1.getByRole("button", { name: /^Modo de reemplazo de / })).toHaveAccessibleName(
    /Etiquetar/,
  );

  // Dividir: separar de vuelta la ocurrencia que vino de dni2 (página 2 —
  // `SplitDialog.tsx`: "Página N — <fuente>"). ADR-087 pasó las fuentes a
  // lenguaje del usuario: Regex/NER/OCR se muestran todas como "Detectado
  // automáticamente" (`conflictLabels.ts`), así que la ocurrencia se
  // identifica por su página, que es lo que este escenario necesita.
  await dni1.getByRole("button", { name: "Más acciones" }).click();
  await dni1
    .getByRole("group", { name: "Acciones del grupo" })
    .getByRole("button", { name: "Dividir…" })
    .click();
  const splitDialog = page.getByRole("dialog", { name: "Dividir grupo" });
  await expect(splitDialog).toBeVisible();
  await splitDialog.getByRole("checkbox", { name: /Página 2 — Detectado automáticamente/ }).click();
  await splitDialog.getByRole("button", { name: "Dividir" }).click();
  await expect(splitDialog).toHaveCount(0);

  // Vuelven a existir dos grupos DNI de 1 ocurrencia cada uno: el original
  // (recalculó su canónico sobre el único member que le queda) y uno nuevo
  // con el valor de la ocurrencia dividida.
  await expect(dni1).toContainText("(1)");
  const splitOffGroup = page.getByRole("treeitem", { name: "18.445.212" });
  await expect(splitOffGroup).toBeVisible();
  await expect(splitOffGroup).toContainText("(1)");
});

/*
 * Fusión de varios grupos en una sola pasada (`ui/Components.md` §3.6,
 * `UX_Guidelines.md` §3.2: "2+ grupos del mismo tipo").
 *
 * El Core sigue recibiendo `GROUP_MERGE_REQUESTED` de a uno y la UI emite N-1
 * en fila; lo que este escenario prueba es lo que ningún unit test puede
 * probar — que los N-1 requests seguidos, con el bus y el motor reales,
 * terminen en UN grupo y no en dos fusiones a medias. Los tres DNI de
 * `text-10p.pdf` son el caso mínimo que necesita el botón "+".
 */
test("fusionar tres grupos en una sola pasada deja un solo grupo", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 30_000 });

  const dni1 = page.getByRole("treeitem", { name: "34.567.891" });
  const dni2 = page.getByRole("treeitem", { name: "18.445.212" });
  const dni3 = page.getByRole("treeitem", { name: "42.998.103" });
  for (const group of [dni1, dni2, dni3]) {
    await expect(group).toContainText("(1)");
  }

  // Origen: dni3. Destinos: dni1 (el primero, que es el que sobrevive) y dni2.
  await dni3.getByRole("button", { name: "Más acciones" }).click();
  await dni3
    .getByRole("group", { name: "Acciones del grupo" })
    .getByRole("button", { name: "Fusionar con…" })
    .click();
  const mergeDialog = page.getByRole("dialog", { name: "Fusionar grupo" });
  await expect(mergeDialog).toBeVisible();

  await mergeDialog.getByRole("combobox", { name: "Grupo destino 1" }).click();
  await page.getByRole("option", { name: /34\.567\.891/ }).click();

  // El botón "+" agrega la segunda fila, que arranca en el único grupo que
  // queda sin tomar.
  await mergeDialog.getByRole("button", { name: "Agregar otro grupo" }).click();
  const secondRow = mergeDialog.getByRole("combobox", { name: "Grupo destino 2" });
  await expect(secondRow).toBeVisible();
  await expect(secondRow).toContainText("18.445.212");

  // Sin más grupos del tipo para ofrecer, el "+" queda deshabilitado: no hay
  // forma de agregar una fila que no tenga nada que elegir.
  await expect(mergeDialog.getByRole("button", { name: "Agregar otro grupo" })).toBeDisabled();

  await mergeDialog.getByRole("button", { name: "Fusionar" }).click();
  await expect(mergeDialog).toHaveCount(0);

  // Un solo grupo con las tres ocurrencias: el destino de la primera fila.
  await expect(dni1).toContainText("(3)");
  await expect(dni2).toHaveCount(0);
  await expect(dni3).toHaveCount(0);
});
