/**
 * Escenario 3 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 3):
 * "Cargar PDF protegido → UI pide password → reintenta → success."
 *
 * Fixture (ADR-048 §7 punto 1): `protected.pdf` es el único fixture binario
 * commiteado del repo — pdf-lib no implementa encriptación, así que no es
 * generable en memoria como el resto de `support/fixtures.ts`. Generado con
 * `qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf`, mismo
 * contenido que `text-10p.pdf` (`tests/fixtures/README.md`): 10 páginas, "DNI
 * 34.567.891" en la página 0 (detectado por Regex, sin depender de NER).
 * Password: "test1234" — nunca un dato real (`08_Security_Model.md` §10.2).
 *
 * Este test estuvo en `test.fixme` (PR17) por un bug real de transporte:
 * `PdfPasswordRequiredError` cruzaba el `postMessage` del `PdfWorker` y
 * perdía su identidad de clase (`EngineError.deserialize()` reconstruye
 * siempre un `DeserializedEngineError` genérico, `Contracts.md` §4), así que
 * el `instanceof PdfPasswordRequiredError` de `handleExtractionFailure` daba
 * `false` y el caso caía a `PIPELINE_FAILED` — el banner genérico de pipeline
 * fallido tapaba `PasswordDialog` un instante después de abrirse. Corregido
 * por ADR-049: discriminación por `err.code` (`isEngineErrorCode`, PR 17.2) +
 * `PdfPasswordRequiredError.retryable = false` (PR 17.1) — este test es la
 * evidencia del fix (ADR-049 §7, Validación).
 *
 * No involucra OCR (el documento no tiene páginas `textless`) y no depende de
 * que NER termine: la aserción final usa el grupo del DNI, detectado por
 * Regex, igual que `scenario-1-import-edit-export.spec.ts` — de los
 * escenarios más rápidos.
 */

import { expect, test, type Locator } from "@playwright/test";

import { protectedFile } from "./support/fixtures.js";

// Margen sobre el default (30 s de Playwright) para las dos idas y vueltas
// con PasswordDialog (contraseña incorrecta + reintento) antes de la
// aserción final de detección — mismo criterio que scenario-8 (línea 57).
test.setTimeout(60_000);

/**
 * ADR-050 §6 (cierre del Escenario 3): prueba que el `<canvas>` del preview
 * (`role="img"`, `PageCanvas.tsx`) pintó la página real, no solo que el
 * elemento existe en el DOM — `toBeVisible()` por sí solo no lo distingue
 * del skeleton gris (`SKELETON_FILL = "#e5e7eb"`, `PageCanvas.tsx`) que se
 * pinta mientras no hay `blobUrl` (documento sin cargar en Render, o
 * `RenderFailedError` como el bug pre-ADR-050: "No password given"). Escanea
 * todos los pixeles en vez de comparar contra un snapshot tomado antes
 * (evita una carrera contra el momento exacto en que `PREVIEW_UPDATED`
 * llega — mismo patrón de inspección de bitmap que
 * `scenario-11-zoom.spec.ts`).
 */
async function isSkeletonOnly(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((el) => {
    const canvasEl = el as HTMLCanvasElement;
    const context = canvasEl.getContext("2d");
    if (!context) return true;
    const { data } = context.getImageData(0, 0, canvasEl.width, canvasEl.height);
    // rgb(229, 231, 235) = "#e5e7eb" (SKELETON_FILL, PageCanvas.tsx).
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 229 || data[i + 1] !== 231 || data[i + 2] !== 235) return false;
    }
    return true;
  });
}

test("Escenario 3: cargar PDF protegido → UI pide password → reintenta → success", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await protectedFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // El diálogo se abre (evento PDF_PASSWORD_REQUIRED, cruza el bus-bridge
  // normal — nunca tuvo el bug). Con el bug de ADR-049 vivo, este `expect`
  // podía ganarle la carrera al cierre espurio; las aserciones de abajo
  // (fill/click sobre un diálogo ya cerrado) son la guarda real.
  const passwordDialog = page.getByRole("dialog", { name: "El documento requiere contraseña" });
  await expect(passwordDialog).toBeVisible({ timeout: 30_000 });

  // Núcleo de la regresión (ADR-049): nunca debe aparecer el banner
  // genérico de pipeline fallido (`PipelineStatus` → "Cerrar documento").
  await expect(page.getByRole("button", { name: "Cerrar documento" })).toHaveCount(0);

  const passwordInput = passwordDialog.locator("#pdf-password");
  const continueButton = passwordDialog.getByRole("button", { name: "Continuar" });

  // Contraseña incorrecta primero: el diálogo debe seguir abierto y pedirla
  // de nuevo, nunca fallar el pipeline (`core/Orchestrator.md` §13 caso 3).
  await passwordInput.fill("contraseña-incorrecta");
  await continueButton.click();

  await expect(
    passwordDialog.getByRole("alert").filter({ hasText: "Contraseña incorrecta." }),
  ).toBeVisible();
  await expect(passwordDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar documento" })).toHaveCount(0);

  // Contraseña correcta: el diálogo se cierra y el pipeline avanza.
  await passwordInput.fill("test1234");
  await continueButton.click();

  await expect(passwordDialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Cerrar documento" })).toHaveCount(0);

  // El pipeline llegó más allá de Extracting: el grupo del DNI (Regex,
  // página 0) aparece sin depender de que NER termine.
  const dniGroup = page.getByRole("treeitem", { name: "34.567.891" });
  await expect(dniGroup).toBeVisible({ timeout: 30_000 });

  // Cierre del bug de ADR-050 (Contexto §1): `protected.pdf` no tiene
  // páginas `textless`, así que `runPipelineFrom` invoca
  // `ensureRenderDocumentLoaded` en su rama sin OCR **antes** de `Detecting`
  // (v1.4.1, caso 25) — con el bug vivo (retainedInputs sin reescribir tras
  // el retry) esa llamada fallaba con `RenderFailedError("No password
  // given")` → `failPipeline` → `PIPELINE_FAILED`, y ni el `dniGroup` de
  // arriba llegaba a existir (Detecting nunca corría). Con el fix,
  // `RenderEngine.loadDocument` recibe el password retenido (ADR-050 §4) y,
  // además de que Detecting corre normalmente, la página 1 del visor llega a
  // pintarse de verdad — no solo el skeleton gris inicial.
  const firstPagePreview = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPagePreview).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => isSkeletonOnly(firstPagePreview), { timeout: 30_000 }).toBe(false);
});
