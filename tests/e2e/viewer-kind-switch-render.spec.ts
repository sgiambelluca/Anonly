/**
 * Frente 5 de Confianza 1.0.x — al cambiar de vista, el visor pide el render de la
 * otra vista a la escala del zoom vigente (`ui/React_Client.md` §7, «Precisión del
 * 2026-10-07»; `PdfViewer`, `kindChangeRender.ts`).
 *
 * **El defecto.** El visor renderiza solo la vista que se mira. Si el usuario hace
 * zoom en Original y pasa a Anonimizado, esa vista ya tenía una imagen cacheada del
 * 100 %: sin un pedido nuevo se pintaba esa imagen vieja, estirada por CSS (pixelada),
 * hasta el próximo zoom o scroll. El reintento de `previewRetry.ts` no lo cubre: pide
 * solo las páginas SIN imagen.
 *
 * **Cómo se observa, sin rodeos.** `support/pagePixels.ts` copia la imagen
 * decodificada que el visor entrega a `drawImage` y la indexa por
 * `«aria-label»@«ancho natural»`. Una página renderizada a escala `s` mide
 * `595 × s` píxeles de ancho. Entonces, que la vista de destino dibuje una imagen de
 * `595 × 1,3` píxeles de ancho es exactamente que el render a la escala del zoom
 * llegó y se pintó. Los tests NO tocan zoom ni scroll después de conmutar la vista:
 * solo esperan (`expect.poll`) a que aparezca esa imagen.
 *
 * **Precondición del defecto.** Antes del zoom se visitan las dos vistas a 100 %,
 * para que el destino ya tenga una imagen cacheada a la escala vieja. Si no la
 * tuviera, el reintento (páginas sin imagen) pediría la escala nueva y el test no
 * distinguiría el arreglo.
 */

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { LINE_DOCUMENT_PAGE_WIDTH, lineDocumentFile } from "./support/fixtures.js";
import { installPageImageCapture, listPageShots } from "./support/pagePixels.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(120_000);

type ViewKind = "original" | "anonimizado";

const ZOOMED_SCALE = 1.3;

const LINES = [
  "Declara Zoe ante el tribunal sobre la pericia contable presentada ayer",
  "Nombre Marina Suarez en el expediente del juzgado civil numero doce",
] as const;

/** Abre la app con un documento sintético de una página y espera a `Ready`. */
async function openDocument(page: Page): Promise<void> {
  await installSettingsOverride(page, { nerEnabled: false });
  await installPageImageCapture(page);
  await openApp(page, "networkidle");
  const { file } = await lineDocumentFile("kind-switch.pdf", LINES);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });
}

async function showView(page: Page, kind: ViewKind): Promise<void> {
  const name = kind === "original" ? "Original" : "Anonimizado";
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/** Anchos naturales (px) de las imágenes que el visor dibujó para la página 1 de esa vista. */
async function drawnWidths(page: Page, kind: ViewKind): Promise<ReadonlyArray<number>> {
  const prefix = `Página 1, ${kind}@`;
  return (await listPageShots(page))
    .filter((shot) => shot.key.startsWith(prefix))
    .map((shot) => shot.width)
    .sort((a, b) => a - b);
}

/** Espera la imagen de la página 1 de esa vista a esa escala de render y devuelve su ancho. */
async function waitForScale(page: Page, kind: ViewKind, scale: number): Promise<number> {
  const expected = LINE_DOCUMENT_PAGE_WIDTH * scale;
  try {
    await expect
      .poll(
        async () =>
          (await drawnWidths(page, kind)).some((width) => Math.abs(width - expected) <= 1),
        { timeout: 30_000 },
      )
      .toBe(true);
  } catch (error) {
    const seen = (await drawnWidths(page, kind)).join(", ");
    throw new Error(
      `la imagen ${kind} a escala ${scale} (${expected} px de ancho) no se dibujó; anchos dibujados: [${seen}]`,
      { cause: error },
    );
  }
  const match = (await drawnWidths(page, kind)).find((width) => Math.abs(width - expected) <= 1);
  if (match === undefined) throw new Error(`sin imagen ${kind} a escala ${scale}`);
  return match;
}

/** Visita las dos vistas a 100 % y termina en `start`, con las dos imágenes cacheadas. */
async function visitBothViewsAt100(page: Page, start: ViewKind): Promise<void> {
  await waitForScale(page, "original", 1);
  await showView(page, "anonimizado");
  await waitForScale(page, "anonimizado", 1);
  await showView(page, start);
}

async function zoomTo130(page: Page): Promise<void> {
  const zoomControls = page.getByRole("group", { name: "Zoom del visor" });
  const zoomIn = zoomControls.getByRole("button", { name: "Acercar" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomControls.getByText("130%", { exact: true })).toBeVisible();
}

test("zoom en Original y paso a Anonimizado: la otra vista llega a la escala del zoom sin tocar nada más", async ({
  page,
}) => {
  await openDocument(page);
  await visitBothViewsAt100(page, "original");

  await zoomTo130(page);
  const originalWidth = await waitForScale(page, "original", ZOOMED_SCALE);

  // Desde acá, ni zoom ni scroll: solo el cambio de vista.
  await showView(page, "anonimizado");
  const anonymizedWidth = await waitForScale(page, "anonimizado", ZOOMED_SCALE);

  expect(anonymizedWidth).toBeGreaterThan(LINE_DOCUMENT_PAGE_WIDTH);
  expect(anonymizedWidth).toBe(originalWidth);
});

test("zoom en Anonimizado y paso a Original: la otra vista llega a la escala del zoom sin tocar nada más", async ({
  page,
}) => {
  await openDocument(page);
  await visitBothViewsAt100(page, "anonimizado");

  await zoomTo130(page);
  const anonymizedWidth = await waitForScale(page, "anonimizado", ZOOMED_SCALE);

  // Desde acá, ni zoom ni scroll: solo el cambio de vista.
  await showView(page, "original");
  const originalWidth = await waitForScale(page, "original", ZOOMED_SCALE);

  expect(originalWidth).toBeGreaterThan(LINE_DOCUMENT_PAGE_WIDTH);
  expect(originalWidth).toBe(anonymizedWidth);
});
