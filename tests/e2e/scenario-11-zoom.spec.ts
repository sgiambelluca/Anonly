/**
 * Escenario 11 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 11):
 * "Cambiar el zoom (`ZoomControls`, ADR-037) → verificar `PREVIEW_UPDATED`
 * con la nueva escala y reemplazo del bitmap CSS transitorio por el bitmap
 * nítido re-renderizado."
 *
 * `ZoomControls`/`PdfViewer` no exponen ningún evento del bus al DOM
 * directamente, así que este spec verifica el contrato observable en dos
 * capas (`docs/adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5,
 * `apps/react-client/src/components/viewer/zoomRenderScheduler.ts`):
 *
 * 1. **Escalado inmediato** (síncrono, sin debounce): el tamaño intrínseco
 *    del `<canvas>` (`width`/`height`, `PageCanvas.tsx`) sigue a `zoom` en el
 *    mismo render, antes de que corra ningún re-render real — se verifica
 *    comparando la altura del canvas antes/después contra el % de zoom que
 *    la propia UI reporta (`ZoomControls`, sin duplicar la fórmula interna de
 *    `pageLayout.ts` en el test).
 * 2. **Re-render real, debounced**: el bitmap dibujado *dentro* del canvas
 *    (`image.src = blobUrl` en el efecto de `PageCanvas`) no se reemplaza
 *    hasta que pasan `ZOOM_RERENDER_DEBOUNCE_MS` (150 ms) sin nuevos cambios
 *    de zoom — antes de eso, el mismo efecto ya redibujó el bitmap viejo
 *    estirado sobre el canvas recién redimensionado (el "bitmap CSS
 *    transitorio" del enunciado). Se verifica comparando el contenido del
 *    canvas (`toDataURL()`) tomado apenas después del cambio de zoom contra
 *    el mismo canvas tras esperar más que el debounce: tienen que diferir —
 *    si no, `PREVIEW_UPDATED` nunca reemplazó el transitorio por el
 *    re-render real a la escala nueva.
 *
 * No hace falta llegar a `Ready`: el montaje del visor (y por lo tanto el
 * primer `RENDER_REQUESTED`) depende solo de `DOCUMENT_PARSED`, igual que
 * `viewer-scroll-jump.spec.ts`.
 */

import { expect, test, type Locator } from "@playwright/test";

import { manyNeutralPagesFile } from "./support/fixtures.js";

test.setTimeout(90_000);

async function canvasDataUrl(canvas: Locator): Promise<string> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
}

async function canvasHeight(canvas: Locator): Promise<number> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).height);
}

test("cambiar el zoom re-escala de inmediato y reemplaza el bitmap transitorio", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await manyNeutralPagesFile(3);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPage = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPage).toBeVisible({ timeout: 30_000 });
  // El `role="img"` ES el propio `<canvas>` (`PageCanvas.tsx`).
  const canvas = firstPage;

  // Deja asentar el primer render real a zoom 100% antes de tocar el zoom.
  await page.waitForTimeout(500);
  const initialHeight = await canvasHeight(canvas);

  const zoomControls = page.getByRole("group", { name: "Zoom del visor" });
  const zoomLabel = zoomControls.getByText(/^\d+%$/);
  await expect(zoomLabel).toHaveText("100%");

  // Tres clicks de +10% (`ZOOM_STEP`, `ZoomControls.tsx`) → 130%, todos
  // dentro de la misma ventana de debounce (cada click reinicia el timer).
  const zoomIn = zoomControls.getByRole("button", { name: "Acercar" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomLabel).toHaveText("130%");

  // 1. Escalado inmediato: la altura intrínseca del canvas ya creció ~30%,
  // sin esperar el debounce. Margen de ±2 % sobre el 30 % esperado para
  // absorber el redondeo a entero de `PageCanvas.tsx` (`Math.round`).
  await expect
    .poll(() => canvasHeight(canvas), { timeout: 2_000 })
    .toBeGreaterThan(initialHeight * 1.28);
  const newHeight = await canvasHeight(canvas);
  expect(newHeight).toBeLessThan(initialHeight * 1.32);

  // Bitmap transitorio: el canvas ya redimensionado todavía muestra lo que
  // el efecto pudo dibujar mientras el debounce no terminó (el bitmap viejo
  // reescalado, o un frame en blanco recién redimensionado).
  const transitionalBitmap = await canvasDataUrl(canvas);

  // Espera más que `ZOOM_RERENDER_DEBOUNCE_MS` (150 ms) + margen para que
  // `RENDER_REQUESTED`/`PREVIEW_UPDATED` completen un ciclo real a través del
  // `RenderWorker` (transporte real desde PR13, ADR-043).
  await page.waitForTimeout(800);
  const rerenderedBitmap = await canvasDataUrl(canvas);

  expect(
    rerenderedBitmap,
    "el bitmap nítido re-renderizado (post-debounce) debería reemplazar al transitorio",
  ).not.toBe(transitionalBitmap);

  // El visor sigue mostrando la página (sin quedar en un estado roto).
  await expect(firstPage).toBeVisible();
});
