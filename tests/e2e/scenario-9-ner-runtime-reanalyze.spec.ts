/**
 * Escenario 9 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 9):
 * "Activar NER en runtime (`reanalyze`, ADR-038) → verificar que se descarga
 * el modelo y reanaliza preservando las ediciones previas del usuario: un
 * grupo que el usuario deshabilitó sigue deshabilitado, una regla creada
 * sigue aplicando, un merge manual persiste."
 *
 * Flujo (`docs/adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` §5
 * flujo 1, §7): arranca con `nerEnabled: false` (mismo mecanismo que
 * `scenario-8-ner-disabled.spec.ts`, PR16.5) para llegar a `Ready` rápido
 * solo con Regex; el usuario edita tres cosas sobre grupos de tipo DNI
 * (deshabilita uno, fusiona otros dos, y toma una decisión "por tipo" que
 * cambia el modo de reemplazo — desde la cabecera de la categoría en el árbol,
 * que es donde ADR-087 §3 puso ese nivel al retirar el panel de Reglas); recién ahí activa "Detección con NER" en
 * `SettingsDialog` con el documento abierto → `ConfirmDialog` → `reanalyze`
 * (`stage → Detecting`, `reopenSession({ expectNer: true })`, NER corre sobre
 * el `Document` retenido, Regex NO se re-corre — ADR-038 §5 flujo 1) → de
 * vuelta a `Ready`. La aserción central: las tres ediciones sobreviven la
 * segunda pasada, y además NER se descargó y corrió de verdad (prueba de que
 * el reanalyze no es un no-op) — verificado por la señal de carga del modelo
 * (`NER_MODEL_LOADING` → "Preparando el detector de nombres…", `pipelineStageLabel.ts`), no
 * por una entidad puntual: confirmado empíricamente que el modelo cuantizado
 * no reconoce "Juan Pérez" como Persona en este fixture sintético — cuestión
 * de precisión del modelo (dataset de referencia, Hito 11), no de integración
 * del pipeline, que es lo que corresponde a este E2E (mismo criterio que
 * `scenario-5-edit-during-ner.spec.ts`). La cobertura de ADR-055 §6 ("al
 * menos una entidad NER llega a la UI") vive en ese escenario, no en este:
 * ahí NER corre en el camino de una sola pasada (el que reportó el bug de
 * ADR-055 Contexto §1), es más barato de correr (240 s vs. los 480 s de
 * acá), y usa un fixture propio con nombres en oraciones limpias en vez de
 * "Juan Pérez" — ver su docblock.
 *
 * El más caro en tiempo de corrida de los cuatro escenarios "sin fixture
 * nueva" (`07` §11.3, ADR-048 §4): a diferencia de scenario-5/10/11, acá el
 * modelo NER (real, first-party, ADR-018) se carga y corre DESPUÉS de que el
 * documento ya está `Ready` (dentro de `reanalyze`), sumado a la carga
 * inicial de la app — dos round-trips en vez de uno. Timeout propio,
 * generoso, mismo criterio que `scenario-1-import-edit-export.spec.ts`. El
 * timeout global del test queda con headroom real sobre la suma, en el peor
 * caso, de los `timeout` de los `expect` internos de abajo (~400 s: el `wait`
 * de 240 s del reanalyze domina, pero son ~15 pasos secuenciales más con
 * timeout default de 5 s cada uno) — sin ese margen, un timeout global más
 * ajustado podría cortar la corrida con un mensaje genérico antes de que el
 * `expect` interno más largo tuviera chance de fallar con un mensaje claro.
 */

import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(480_000);

test("activar NER en runtime reanaliza preservando ediciones previas", async ({ page }) => {
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
  await mergeDialog.getByRole("combobox", { name: "Grupo destino" }).click();
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

  // Activar NER en runtime, con el documento abierto.
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

  // ADR-087 §7.1: la opción dejó de nombrar el motor ("Detección con NER
  // (nombres, organizaciones)") y dice qué hace ("Detectar nombres de
  // personas y organizaciones", `SettingsDialog.tsx`).
  await settingsDialog
    .getByRole("checkbox", { name: "Detectar nombres de personas y organizaciones" })
    .click();
  await settingsDialog.getByRole("button", { name: "Guardar" }).click();

  const confirmReanalyze = page.getByRole("dialog", { name: "Reanalizar documento" });
  await expect(confirmReanalyze).toBeVisible();
  await confirmReanalyze.getByRole("button", { name: "Reanalizar" }).click();

  // Prueba de que el reanalyze no es un no-op: el modelo NER (recién
  // habilitado) se descarga y carga de verdad — señal transitoria, hay que
  // atraparla antes de esperar el cierre del diálogo de confirmación.
  // ADR-087 §7.1: "Cargando modelo NER…" pasó a "Preparando el detector de
  // nombres… N%" (`pipelineStageLabel.ts`). Se localiza por texto y no por
  // `role="status"` porque en la fase `work` hay más de un `role="status"` en
  // pantalla (el de la toolbar y el del host de toasts), y un locator ambiguo
  // falla por strict mode en vez de por lo que el test quiere afirmar.
  await expect(page.getByText(/Preparando el detector de nombres…/)).toBeVisible({
    timeout: 60_000,
  });

  // El reanálisis pasa por Detecting (NER real) y vuelve a Ready: el diálogo
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
