/**
 * Escenario 2 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 2):
 * "Cargar PDF escaneado → ver progreso OCR → ver grupos → exportar."
 *
 * Fixture (ADR-048 §2, `tests/fixtures/README.md` fila "2"): generada EN EL
 * BROWSER dentro de este mismo spec (`support/scannedPdf.ts`) — rasteriza
 * `text-10p.pdf` (`generateText10p()`, mismo contenido conocido que el resto
 * de los specs) página por página con `pdfjs-dist` y re-arma un PDF de solo
 * imágenes con `pdf-lib`, sin capa de texto. El PDF Engine lo detecta como
 * páginas `requiresOCR` y el Orchestrator despacha OCR real (Tesseract.js,
 * first-party — ADR-018) antes de Regex/NER.
 *
 * Este test estuvo en `test.fixme` desde PR17 por dos bugs reales de
 * `ocr-engine`, los dos corregidos por PR 17.6 (`OCR_Engine.md` §15.22,
 * partes a y b; sin ADR — no toca CSP ni contratos, `ADR-018` §2 documenta
 * las dos precisiones):
 *
 * a) `TESSERACT_WORKER_PATH` (`worker/kernel.ts`) apuntaba al DIRECTORIO
 *    (`"/wasm/tesseract/"`) en vez de al archivo real (`worker.min.js`) —
 *    `tesseract.js` hace `importScripts(workerPath)` tal cual, sin agregarle
 *    nombre de archivo. Arregla el fallback in-process (sin Worker real).
 * b) Insuficiente por sí sola: en producción el OCR corre DENTRO de un
 *    `OcrWorker` real (wireado sin condición desde PR14/ADR-045). Ahí
 *    `tesseract.js` no absolutiza `langPath`/`corePath`/`workerPath` por su
 *    cuenta (su detección de entorno da `'webworker'`, no `'browser'`), y su
 *    wrapper `workerBlobURL` (default `true`) corre con `self.location` =
 *    una base `blob:` contra la que un path root-relative NUNCA resuelve
 *    (confirmado en browser real: `new URL("/wasm/…", "blob:http://origen/uuid")`
 *    lanza `Invalid URL`, archivo o directorio da igual). El kernel ahora
 *    absolutiza las tres rutas contra `self.location.origin` antes de
 *    `createWorker` (no-op solo en el entorno Node de los tests, que no
 *    tiene `self`; en el browser absolutiza siempre, también en el fallback
 *    in-process, donde `self === window`).
 *
 * Las dos partes tienen su regresión unitaria en
 * `ocr-engine/src/__tests__/worker-entry.test.ts` (mocks de `tesseract.js`) —
 * pero el mock nunca ejercita resolución real de URLs, así que ninguna de
 * las dos partes por sí sola garantiza el comportamiento real del browser.
 * Por eso la aserción central de este spec es el conteo de grupos de
 * entidades REALMENTE detectados (no el `stage`): con cualquiera de los dos
 * bugs vivo, el pipeline llega igual a "Listo" — silencioso, sin evento de
 * fallo — pero con cero entidades.
 *
 * Decisión de alcance (no ambigüedad): NER queda desactivado
 * (`installSettingsOverride`, mismo mecanismo que `scenario-8-ner-disabled.spec.ts`,
 * desbloqueado por PR16.5). `07_Performance_Strategy.md` §11.3 item 2 no
 * exige NER activo, y dejarlo activo sumaría el costo de descarga+inferencia
 * del modelo ONNX a un test ya lento por el OCR real (3-10s/página ×
 * 10 páginas, `OCR_Engine.md` §12) sin aportar señal adicional sobre el bug
 * de este PR, que es sobre el propio OCR. Con NER off, la detección que
 * demuestra que Tesseract reconoció texto real es puramente Regex (DNI de la
 * página 0, mismo patrón que `scenario-8`).
 */

import { expect, test } from "@playwright/test";

import { generateText10p } from "../fixtures/generate.js";

import { rasterizeToScannedPdf } from "./support/scannedPdf.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

// Generoso: OCR real de 10 páginas (30-100s, `OCR_Engine.md` §12) + export
// full-quality de 10 páginas después (scenario-1 necesitó hasta 300s solo
// para el link de descarga en un Chromium headless sin aceleración gráfica).
test.setTimeout(600_000);

test("Escenario 2: cargar PDF escaneado → ver progreso OCR → ver grupos → exportar", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await page.goto("/", { waitUntil: "networkidle" });

  const sourceBytes = await generateText10p();
  const scannedFile = await rasterizeToScannedPdf(page, sourceBytes);
  await page.locator('input[type="file"]').setInputFiles(scannedFile);

  // "ver progreso OCR": el texto de `PipelineStatus` (`pipelineStageLabel.ts`)
  // durante el stage `OCRing` tiene la forma exacta "OCR página N de M… X%".
  const pipelineStatus = page.getByRole("status");
  await expect(pipelineStatus).toContainText(/OCR página \d+ de \d+…/, { timeout: 60_000 });

  // El pipeline llega a Ready: `ExportButton` decide su propia visibilidad
  // por `stage ∈ {Ready, Done}` (`ui/Components.md` §2.5) — con NER
  // desactivado no hay modelo que cargar, pero el OCR real de 10 páginas
  // sigue siendo el costo dominante.
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 180_000 });

  // Aserción central de este PR (17.6): entidades REALES detectadas, no solo
  // el stage. Con cualquiera de los dos bugs de `ocr-engine` vivo,
  // tesseract.js nunca reconoce ninguna palabra (falla en silencio) y
  // `groupsByType` queda vacío — `EntitiesPanel` (y su `role="tree"`) ni
  // siquiera se monta (`App.tsx` solo la monta con `hasAnyGroup`), así que
  // este `expect` es el que efectivamente distingue "OCR funcionó" de "OCR
  // roto en silencio".
  const entityTree = page.getByRole("tree", { name: "Entidades detectadas" });
  await expect(entityTree).toBeVisible();
  const detectedGroups = page.getByRole("treeitem");
  await expect(detectedGroups.first()).toBeVisible();
  expect(await detectedGroups.count()).toBeGreaterThan(0);

  // El DNI de la página 0 ("34.567.891", Regex, `tests/fixtures/README.md`)
  // es la entidad de control conocida del contenido fuente que se rasterizó:
  // confirma que el texto reconocido por Tesseract no es solo "algo", sino
  // el contenido real de la página.
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible();

  // "exportar": mismo flujo que `scenario-1-import-edit-export.spec.ts`
  // (valores default del form, sin tocar nada).
  await exportButton.click();
  const exportDialog = page.getByRole("dialog", { name: "Exportar PDF anonimizado" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Exportar" }).click();

  const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
  await expect(downloadLink).toBeVisible({ timeout: 300_000 });

  const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe("anonimizado.pdf");
});
