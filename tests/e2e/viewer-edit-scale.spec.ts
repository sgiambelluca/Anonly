/**
 * Frente 5 de Confianza 1.0.x — lo que el visor muestra no queda a una escala distinta
 * de la del zoom después de una edición (`ui/React_Client.md` §7, ADR-189).
 *
 * **Qué se mide.** `support/pagePixels.ts` registra, por cada `drawImage` del visor, el
 * ancho natural de la imagen dibujada (`595 × escala` de render). El último dibujo de
 * `«Página 1, anonimizado»` es lo que el usuario ve. Con zoom 130 % tiene que medir
 * `595 × 1,3 ≈ 773`; 595 es la imagen del 100 % estirada por CSS (borrosa).
 *
 * **Por qué el 130 % y no solo el 100 %.** A 100 % la escala por defecto del motor
 * coincide con la del zoom y ningún defecto de escala se ve. Cada test hace zoom, edita
 * y mide SIN volver a tocar zoom ni scroll: el zoom es lo que nadie vuelve a hacer
 * después de una edición.
 *
 * **Los caminos.** Los renders que nacen de una edición los dispara el Orchestrator
 * (preview mediado, ADR-044) sin escala: el motor los dibuja a la «escala vigente» de
 * ese lado (ADR-189 §1/§2), que es la del último `RENDER_REQUESTED` de preview de ESE
 * lado. Dos casos la dejaban vieja:
 *
 * 1. Se hace zoom mirando Original y se edita: la escala vigente del lado anonimizado
 *    es la de antes del zoom, así que la imagen anonimizada que se cachea sale a 100 %.
 *    Al pasar a Anonimizado el visor tiene que pedirla a la escala del zoom
 *    (`kindChangeRender.ts`).
 * 2. Un `reanalyze` desde Configuración pedía el render sin escala: dibujaba a 100 % y
 *    la recordaba como vigente (`reanalyzeRenderRequest.ts`).
 */

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { LINE_DOCUMENT_PAGE_WIDTH, lineDocumentFile } from "./support/fixtures.js";
import {
  drawLogLength,
  drawsSince,
  installPageImageCapture,
  lastDrawnWidth,
  listPageShots,
} from "./support/pagePixels.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(180_000);

type ViewKind = "original" | "anonimizado";

const LABEL: Readonly<Record<ViewKind, string>> = {
  original: "Página 1, original",
  anonimizado: "Página 1, anonimizado",
};

const LINES = [
  "Documento DNI 34.567.891 del actor presentado ayer ante el juzgado",
  "Documento DNI 18.445.212 del demandado citado hoy por el tribunal",
  "Correo juan.perez@example.com para las notificaciones del caso",
] as const;

const DNI_A = "34.567.891";
const DNI_B = "18.445.212";
const ZOOM = 1.3;

async function showView(page: Page, kind: ViewKind): Promise<void> {
  const name = kind === "original" ? "Original" : "Anonimizado";
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

async function waitForScale(page: Page, kind: ViewKind, scale: number): Promise<void> {
  const expected = LINE_DOCUMENT_PAGE_WIDTH * scale;
  await expect
    .poll(
      async () =>
        (await listPageShots(page)).some(
          (shot) => shot.key.startsWith(`${LABEL[kind]}@`) && Math.abs(shot.width - expected) <= 1,
        ),
      { message: `imagen ${kind} a escala ${scale}`, timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Abre el documento, deja a la vista `start` y le hace zoom (3 × «Acercar» = 130 %).
 * `visitOther`: si antes se miró la otra vista a 100 % (la otra vista queda con una imagen
 * cacheada a la escala vieja, que es el caso más común).
 */
async function openAt130(page: Page, start: ViewKind, visitOther: boolean): Promise<void> {
  await installSettingsOverride(page, { nerEnabled: false });
  await installPageImageCapture(page);
  await openApp(page, "networkidle");
  const { file } = await lineDocumentFile("edit-scale.pdf", LINES);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("treeitem", { name: DNI_A })).toBeVisible({ timeout: 15_000 });
  await waitForScale(page, "original", 1);
  if (visitOther) {
    await showView(page, "anonimizado");
    await waitForScale(page, "anonimizado", 1);
    await showView(page, start);
  }
  await zoomIn(page, 3);
  await waitForScale(page, start, ZOOM);
}

async function zoomIn(page: Page, times: number): Promise<void> {
  const controls = page.getByRole("group", { name: "Zoom del visor" });
  const button = controls.getByRole("button", { name: "Acercar" });
  for (let i = 0; i < times; i += 1) await button.click();
}

/**
 * Corre `action` y espera a que la imagen que el visor muestra para `view` sea la de la
 * escala del zoom. Falla (con el ancho observado) si queda en otra, y también si la
 * acción no produjo ningún dibujo nuevo (la edición no llegó a la pantalla).
 */
async function expectShownAtZoom(
  page: Page,
  view: ViewKind,
  what: string,
  action: () => Promise<void>,
): Promise<void> {
  const mark = await drawLogLength(page);
  await action();
  const expected = LINE_DOCUMENT_PAGE_WIDTH * ZOOM;
  let observed: number | null = null;
  let drawCount = 0;
  try {
    await expect
      .poll(
        async () => {
          drawCount = (await drawsSince(page, mark, LABEL[view])).length;
          observed = await lastDrawnWidth(page, LABEL[view]);
          // Hubo al menos un dibujo posterior a la acción (la edición llegó a la pantalla) y
          // lo que se ve mide lo que corresponde al zoom.
          return drawCount > 0 && observed !== null && Math.abs(observed - expected) <= 1;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${what}: la imagen ${view} debería medir ${expected} px de ancho y mide ${observed} (${drawCount} dibujos nuevos)`,
      { cause: error },
    );
  }
}

const enableCheckbox = (page: Page, dni: string) =>
  page.getByRole("treeitem", { name: dni }).getByRole("checkbox", { name: `Habilitar ${dni}` });

async function chooseMode(
  page: Page,
  trigger: ReturnType<Page["getByRole"]>,
  mode: RegExp,
): Promise<void> {
  await trigger.click();
  await page
    .getByRole("group", { name: "Modo de reemplazo" })
    .getByRole("button", { name: mode })
    .click();
}

const BLACK_BOX = /^Tapar con negro/;
const PARTIAL = /^Ocultar parcialmente/;

const entityModeButton = (page: Page, dni: string) =>
  page.getByRole("treeitem", { name: dni }).getByRole("button", { name: /^Modo de reemplazo de / });

async function addManualFromSearch(page: Page, term: string): Promise<void> {
  const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
  await search.fill(term);
  const add = page.getByRole("button", { name: "Agregar", exact: true });
  await expect(add).toBeEnabled({ timeout: 15_000 });
  await add.click();
  const popover = page.getByRole("dialog", { name: "Agregar la búsqueda como entidad" });
  await popover.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(popover).toHaveCount(0);
  await search.fill("");
  const close = page.getByRole("button", { name: "Cerrar resultados" });
  if (await close.isVisible()) await close.click();
}

test("130 % en Anonimizado: desactivar y activar una entidad o un tipo, cambiar modos y deshacer no bajan la escala", async ({
  page,
}) => {
  await openAt130(page, "anonimizado", true);

  await expectShownAtZoom(page, "anonimizado", "entidad: desactivar", () =>
    enableCheckbox(page, DNI_A).click(),
  );
  await expectShownAtZoom(page, "anonimizado", "entidad: activar", () =>
    enableCheckbox(page, DNI_A).click(),
  );

  const typeBox = page.getByRole("checkbox", { name: /^Habilitar todos los grupos de / }).first();
  await expectShownAtZoom(page, "anonimizado", "tipo: desactivar", () => typeBox.click());
  await expectShownAtZoom(page, "anonimizado", "tipo: activar", () => typeBox.click());

  // Primero el documento entero (sin ajustes propios no pide confirmación) y después
  // una entidad, a un modo distinto del del documento.
  await expectShownAtZoom(page, "anonimizado", "modo de todo el documento", () =>
    chooseMode(
      page,
      page.getByRole("button", { name: /^Modo de reemplazo de todo el documento/ }),
      BLACK_BOX,
    ),
  );
  await expectShownAtZoom(page, "anonimizado", "modo de una entidad", () =>
    chooseMode(page, entityModeButton(page, DNI_A), PARTIAL),
  );

  await page.getByRole("heading", { name: "Entidades" }).click();
  await expectShownAtZoom(page, "anonimizado", "deshacer (Ctrl+Z)", () =>
    page.keyboard.press("Control+z"),
  );
});

test("130 % en Anonimizado: hacer zoom y editar enseguida, sin esperar el re-render del zoom", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await installPageImageCapture(page);
  await openApp(page, "networkidle");
  const { file } = await lineDocumentFile("edit-scale-race.pdf", LINES);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("treeitem", { name: DNI_B })).toBeVisible({ timeout: 15_000 });
  await waitForScale(page, "original", 1);
  await showView(page, "anonimizado");
  await waitForScale(page, "anonimizado", 1);

  await expectShownAtZoom(page, "anonimizado", "zoom + edición inmediata", async () => {
    await zoomIn(page, 3);
    await enableCheckbox(page, DNI_B).click();
  });
});

for (const visitOther of [true, false]) {
  const seen = visitOther ? "con Anonimizado ya vista a 100 %" : "sin haber visto Anonimizado";

  test(`130 % en Original ${seen}: desactivar una entidad y pasar a Anonimizado`, async ({
    page,
  }) => {
    await openAt130(page, "original", visitOther);
    await expectShownAtZoom(page, "anonimizado", "entidad + cambio de vista", async () => {
      await enableCheckbox(page, DNI_A).click();
      await showView(page, "anonimizado");
    });
  });
}

test("130 % en Original: cambiar el modo de una entidad y pasar a Anonimizado", async ({
  page,
}) => {
  await openAt130(page, "original", true);
  await expectShownAtZoom(page, "anonimizado", "modo + cambio de vista", async () => {
    await chooseMode(page, entityModeButton(page, DNI_A), BLACK_BOX);
    await showView(page, "anonimizado");
  });
});

test("130 % en Original: agregar una entidad a mano, pasar a Anonimizado y deshacer", async ({
  page,
}) => {
  await openAt130(page, "original", true);
  await expectShownAtZoom(page, "anonimizado", "alta manual + cambio de vista", async () => {
    await addManualFromSearch(page, "tribunal");
    await showView(page, "anonimizado");
  });
  await page.getByRole("heading", { name: "Entidades" }).click();
  await expectShownAtZoom(page, "anonimizado", "deshacer el alta (Ctrl+Z)", () =>
    page.keyboard.press("Control+z"),
  );
});

test("130 % en Anonimizado: un reanalyze desde Configuración no baja la escala", async ({
  page,
}) => {
  await openAt130(page, "anonimizado", true);
  await expectShownAtZoom(page, "anonimizado", "reanalyze", async () => {
    await page.getByRole("button", { name: "Configuración" }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Configuración" });
    await expect(settingsDialog).toBeVisible();
    // «Idiomas del documento» es el ajuste que dispara `reanalyze` (ADR-038 §7).
    await settingsDialog.getByRole("checkbox", { name: "Inglés" }).click();
    await settingsDialog.getByRole("button", { name: "Guardar" }).click();
    const confirm = page.getByRole("dialog", { name: "Reanalizar documento" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Reanalizar" }).click();
    await expect(confirm).toHaveCount(0, { timeout: 120_000 });
  });
});
