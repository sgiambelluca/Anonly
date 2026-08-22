/**
 * Escenario 6 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 6):
 * "Cargar PDF corrupto → verificar error tipado y mensaje claro."
 *
 * Fixture `corrupt.pdf` (`tests/fixtures/README.md`): header `%PDF-1.4`
 * válido + 200 bytes deterministas (0x41) que no forman un PDF parseable.
 * El PDF Engine lo rechaza durante `Extracting` con `PDF_INVALID`, que el
 * Orchestrator traduce siempre a `PIPELINE_FAILED`
 * (`core/Orchestrator.md` §13 caso 4; `core-adapter/bus-bridge.ts`, comentario
 * junto a `PIPELINE_FAILED`). La UI (`PipelineStatus` +
 * `pipelineErrorPresentation.ts`) muestra un único banner persistente
 * (`role="alert"`, `ui/React_Client.md` §8) con el mensaje mapeado para
 * `PDF_INVALID` y el botón "Cerrar documento" (sin "Desactivar NER y
 * reanalizar": ese botón solo aparece para `NER_MODEL_MISSING`).
 *
 * No involucra OCR ni NER: el PDF Engine falla antes de llegar a Detecting,
 * así que este test no necesita el timeout extendido de `scenario-1-*`.
 */

import { expect, test } from "@playwright/test";

import { corruptFile } from "./support/fixtures.js";

test("cargar PDF corrupto muestra un error tipado y mensaje claro", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await corruptFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  const errorBanner = page
    .getByRole("alert")
    .filter({ hasText: "El archivo no es un PDF válido." });
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });

  // Solo "Cerrar documento": PDF_INVALID no dispara la oferta de
  // "Desactivar NER y reanalizar" (esa es exclusiva de NER_MODEL_MISSING,
  // `pipelineErrorPresentation.ts`).
  const closeButton = errorBanner.getByRole("button", { name: "Cerrar documento" });
  await expect(closeButton).toBeVisible();
  await expect(
    errorBanner.getByRole("button", { name: "Desactivar NER y reanalizar" }),
  ).toHaveCount(0);

  // "Cerrar documento" vuelve al estado Idle: el banner desaparece y
  // El afordance de importar reaparece: sin documento, la app vuelve a la
  // pantalla de carga de ADR-087 §1 ("Elegir archivo"). Antes era el
  // `ImportButton` de la toolbar, retirado con el rediseño.
  // (`actions.closeDocument`, `pipeline.store.reset()`).
  await closeButton.click();
  await expect(errorBanner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
});
