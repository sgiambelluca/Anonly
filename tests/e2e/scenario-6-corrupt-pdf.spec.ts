/**
 * Escenario 6 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 6):
 * "Cargar PDF corrupto → verificar error tipado y mensaje claro."
 *
 * Fixture `corrupt.pdf` (`tests/fixtures/README.md`): header `%PDF-1.4`
 * válido + 200 bytes deterministas (0x41) que no forman un PDF parseable.
 * El PDF Engine lo rechaza durante `Extracting` con `PDF_INVALID`, que el
 * Orchestrator traduce siempre a `PIPELINE_FAILED`
 * (`core/Orchestrator.md` §13 caso 4).
 *
 * **Desde ADR-168 §4 un fallo de importación vuelve a la zona de carga**: la
 * última etapa observada fue `Extracting`, así que la UI cierra el documento y
 * vuelve a ① con la `DropZone` en estado de error —el nombre del archivo y el
 * mensaje mapeado para `PDF_INVALID` (`pipelineErrorPresentation.ts`)— en vez
 * de pasar a ②b con un banner cuya única salida era "Cerrar documento".
 *
 * No involucra OCR ni NER: el PDF Engine falla antes de llegar a Detecting,
 * así que este test no necesita el timeout extendido de `scenario-1-*`.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { corruptFile } from "./support/fixtures.js";

test("cargar PDF corrupto vuelve a la zona de carga con un mensaje claro", async ({ page }) => {
  await openApp(page, "networkidle");

  const file = await corruptFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  const dropZoneError = page
    .getByRole("alert")
    .filter({ hasText: "El archivo no es un PDF válido." });
  await expect(dropZoneError).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No se pudo abrir el archivo")).toBeVisible();

  // Se volvió a ① sin un paso intermedio: no hay banner de ②b ni "Cerrar
  // documento", y la salida es elegir otro archivo en la misma zona.
  await expect(page.getByRole("button", { name: "Cerrar documento" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Elegir otro archivo" })).toBeVisible();
});
