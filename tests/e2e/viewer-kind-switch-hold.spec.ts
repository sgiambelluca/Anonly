/**
 * ADR-213 — cambiar de vista no muestra una imagen a otra escala
 * (`ui/React_Client.md` §7, «ADR-213 (2026-10-07)»).
 *
 * **Qué se mide.** `support/pagePixels.ts` registra, en orden y con su instante, cada
 * `drawImage` del visor sobre el canvas de una página: etiqueta (`Página N, original|
 * anonimizado`), ancho natural de la imagen (`595 × escala de render`) y su `blob:`.
 * Con zoom 130 % la imagen nítida mide `595 × 1,3 ≈ 773`; una de 595 es la del 100 %
 * estirada por CSS, es decir, la borrosa. `support/renderTap.ts` cuenta los
 * `RENDER_REQUESTED` del visor y, para demorar un render a propósito, atrasa los
 * mensajes de los workers desde el test (nada de código de producto solo para tests).
 *
 * **Precondición del defecto.** Antes del zoom se visitan las dos vistas a 100 %: el
 * lado al que se va a conmutar ya tiene una imagen guardada a la escala vieja. Sin eso
 * no habría nada que estirar.
 *
 * Cada test pide que el PRIMER dibujo del lado nuevo ya esté a la escala del zoom
 * (no «que termine ahí»): antes de ADR-213 se dibujaba la de 595 y recién después la de 773.
 */

import type { Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import {
  LINE_DOCUMENT_PAGE_WIDTH,
  lineDocumentFile,
  manyNeutralPagesFile,
} from "./support/fixtures.js";
import {
  drawLogLength,
  drawsSince,
  installPageImageCapture,
  listPageShots,
  type DrawRecord,
} from "./support/pagePixels.js";
import {
  installWorkerMessageDelay,
  pageNow,
  renderRequestCount,
  renderRequestsSince,
  setWorkerMessageDelay,
  startRenderTap,
} from "./support/renderTap.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

test.setTimeout(180_000);

type ViewKind = "original" | "anonimizado";

const OTHER: Readonly<Record<ViewKind, ViewKind>> = {
  original: "anonimizado",
  anonimizado: "original",
};

const ZOOM = 1.3;
const PAGE_COUNT = 8;
const HOLD_LIMIT_MS = 500;

const LINES = [
  "Documento DNI 34.567.891 del actor presentado ayer ante el juzgado",
  "Documento DNI 18.445.212 del demandado citado hoy por el tribunal",
  "Correo juan.perez@example.com para las notificaciones del caso",
] as const;
const DNI_A = "34.567.891";

const label = (pageNumber: number, kind: ViewKind): string => `Página ${pageNumber}, ${kind}`;
const near = (width: number, scale: number): boolean =>
  Math.abs(width - LINE_DOCUMENT_PAGE_WIDTH * scale) <= 1;

// ─── Apertura ──────────────────────────────────────────────────────────────────

async function prepare(page: Page): Promise<void> {
  await installSettingsOverride(page, { nerEnabled: false });
  await installPageImageCapture(page);
  await installWorkerMessageDelay(page);
  await openApp(page, "networkidle");
  await startRenderTap(page);
}

async function openLines(page: Page): Promise<void> {
  await prepare(page);
  const { file } = await lineDocumentFile("kind-switch-hold.pdf", LINES);
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("treeitem", { name: DNI_A })).toBeVisible({ timeout: 15_000 });
}

async function openManyPages(page: Page): Promise<void> {
  await prepare(page);
  await page.locator('input[type="file"]').setInputFiles(await manyNeutralPagesFile(PAGE_COUNT));
  await expect(page.getByRole("img", { name: "Página 1, original" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("tab", { name: "Anonimizado" })).toBeEnabled({ timeout: 60_000 });
}

async function showView(page: Page, kind: ViewKind): Promise<void> {
  const name = kind === "original" ? "Original" : "Anonimizado";
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/** Espera a que el visor haya dibujado esa página (rótulo completo) a esa escala de render. */
async function waitDrawn(page: Page, pageLabel: string, scale: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await listPageShots(page)).some(
          (shot) => shot.key.startsWith(`${pageLabel}@`) && near(shot.width, scale),
        ),
      { message: `«${pageLabel}» a escala ${scale}`, timeout: 30_000 },
    )
    .toBe(true);
}

async function zoomInThrice(page: Page): Promise<void> {
  const controls = page.getByRole("group", { name: "Zoom del visor" });
  const button = controls.getByRole("button", { name: "Acercar" });
  for (let i = 0; i < 3; i += 1) await button.click();
  await expect(controls.getByText("130%", { exact: true })).toBeVisible();
}

/** Visita las dos vistas a 100 % y termina en `start`: las dos con imagen guardada a esa escala. */
async function visitBothAt100(page: Page, start: ViewKind): Promise<void> {
  await waitDrawn(page, label(1, "original"), 1);
  await showView(page, "anonimizado");
  await waitDrawn(page, label(1, "anonimizado"), 1);
  await showView(page, start);
}

function viewerScroller(page: Page, kind: ViewKind) {
  const aria = kind === "original" ? "Documento original" : "Documento anonimizado";
  return page.locator(`[aria-label="${aria}"] > div`).first();
}

async function scrollToEnd(page: Page, kind: ViewKind): Promise<void> {
  await viewerScroller(page, kind).evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
  });
}

async function scrollToTop(page: Page, kind: ViewKind): Promise<void> {
  await viewerScroller(page, kind).evaluate((element) => {
    element.scrollTop = 0;
  });
}

// ─── Lectura de los dibujos ────────────────────────────────────────────────────

function describeDraws(draws: ReadonlyArray<DrawRecord>, from: number): string {
  return `[${draws.map((draw) => `${draw.width}px @+${Math.round(draw.at - from)}ms`).join(", ")}]`;
}

/** Espera al menos un dibujo de `pageLabel` posterior a `mark` y devuelve los que haya. */
async function firstDrawsSince(
  page: Page,
  mark: number,
  pageLabel: string,
): Promise<ReadonlyArray<DrawRecord>> {
  await expect
    .poll(async () => (await drawsSince(page, mark, pageLabel)).length, {
      message: `algún dibujo de «${pageLabel}» después del cambio`,
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  return drawsSince(page, mark, pageLabel);
}

/** El primer dibujo, y todos los que hubo, están a la escala del zoom: ninguno a la vieja. */
async function expectNeverOldScale(
  page: Page,
  mark: number,
  clickAt: number,
  pageLabel: string,
): Promise<void> {
  const first = await firstDrawsSince(page, mark, pageLabel);
  const detail = `dibujos de «${pageLabel}» tras el cambio de vista: ${describeDraws(first, clickAt)}`;
  test.info().annotations.push({ type: "dibujos", description: detail });
  expect(near(first[0]?.width ?? 0, ZOOM), detail).toBe(true);
  // Y lo que llegue después, hasta asentarse, tampoco baja la escala.
  await expect
    .poll(
      async () => {
        const all = await drawsSince(page, mark, pageLabel);
        return all.every((draw) => near(draw.width, ZOOM));
      },
      { message: detail, timeout: 5_000 },
    )
    .toBe(true);
}

/** Conmuta a `target` y comprueba que el primer dibujo ya está a la escala del zoom. */
async function switchAndExpectCurrent(page: Page, target: ViewKind): Promise<void> {
  const mark = await drawLogLength(page);
  const clickAt = await pageNow(page);
  await showView(page, target);
  await expectNeverOldScale(page, mark, clickAt, label(1, target));
}

// ─── Acciones de edición ───────────────────────────────────────────────────────

const enableCheckbox = (page: Page, dni: string) =>
  page.getByRole("treeitem", { name: dni }).getByRole("checkbox", { name: `Habilitar ${dni}` });

async function chooseEntityMode(page: Page, dni: string): Promise<void> {
  await page
    .getByRole("treeitem", { name: dni })
    .getByRole("button", { name: /^Modo de reemplazo de / })
    .click();
  await page
    .getByRole("group", { name: "Modo de reemplazo" })
    .getByRole("button", { name: /^Tapar con negro/ })
    .click();
}

async function addManual(page: Page, term: string): Promise<void> {
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

async function undo(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Entidades" }).click();
  await page.keyboard.press("Control+z");
}

async function reanalyze(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Configuración" }).click();
  const settings = page.getByRole("dialog", { name: "Configuración" });
  await expect(settings).toBeVisible();
  // «Idiomas del documento» es el ajuste que dispara `reanalyze` (ADR-038 §7).
  await settings.getByRole("checkbox", { name: "Inglés" }).click();
  await settings.getByRole("button", { name: "Guardar" }).click();
  const confirm = page.getByRole("dialog", { name: "Reanalizar documento" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reanalizar" }).click();
  await expect(confirm).toHaveCount(0, { timeout: 120_000 });
}

/** La vista a la que hay que conmutar: la que NO está seleccionada ahora. */
async function viewToSwitchTo(page: Page): Promise<ViewKind> {
  const anonymizedSelected = await page
    .getByRole("tab", { name: "Anonimizado" })
    .getAttribute("aria-selected");
  return anonymizedSelected === "true" ? "original" : "anonimizado";
}

// ─── 1. Después de un zoom, conmutar no dibuja nunca a la escala vieja ─────────

for (const start of ["original", "anonimizado"] as const) {
  test(`zoom en ${start} y paso a ${OTHER[start]}: el primer dibujo del lado nuevo ya es nítido`, async ({
    page,
  }) => {
    await openLines(page);
    await visitBothAt100(page, start);
    await zoomInThrice(page);
    await waitDrawn(page, label(1, start), ZOOM);
    await switchAndExpectCurrent(page, OTHER[start]);
  });
}

const EDITS: ReadonlyArray<{
  readonly name: string;
  readonly start: ViewKind;
  readonly run: (page: Page) => Promise<void>;
}> = [
  {
    name: "desactivar una entidad",
    start: "original",
    run: (page) => enableCheckbox(page, DNI_A).click(),
  },
  {
    name: "cambiar el modo de una entidad",
    start: "original",
    run: (page) => chooseEntityMode(page, DNI_A),
  },
  {
    name: "agregar una entidad a mano",
    start: "original",
    run: (page) => addManual(page, "tribunal"),
  },
  {
    name: "deshacer una edición",
    start: "original",
    run: async (page) => {
      await enableCheckbox(page, DNI_A).click();
      await undo(page);
    },
  },
  {
    name: "desactivar una entidad mirando Anonimizado",
    start: "anonimizado",
    run: (page) => enableCheckbox(page, DNI_A).click(),
  },
  { name: "reanalizar", start: "anonimizado", run: reanalyze },
  { name: "reanalizar mirando Original", start: "original", run: reanalyze },
];

for (const edit of EDITS) {
  test(`130 % en ${edit.start}, ${edit.name}, y conmutar: el primer dibujo del lado nuevo ya es nítido`, async ({
    page,
  }) => {
    await openLines(page);
    await visitBothAt100(page, edit.start);
    await zoomInThrice(page);
    await waitDrawn(page, label(1, edit.start), ZOOM);
    await edit.run(page);
    await switchAndExpectCurrent(page, await viewToSwitchTo(page));
  });
}

// ─── 2. Conmutar de inmediato tras un zoom, antes de que llegue el otro lado ───

test("conmutar de inmediato tras un zoom mantiene la imagen anterior y después aparece la nítida, sin dibujo a escala vieja", async ({
  page,
}) => {
  await openLines(page);
  await visitBothAt100(page, "original");
  // Los renders llegan 60 ms más tarde: el lado nuevo no está al conmutar, pero llega antes del tope.
  await setWorkerMessageDelay(page, 60);
  await zoomInThrice(page);

  const mark = await drawLogLength(page);
  const clickAt = await pageNow(page);
  await showView(page, "anonimizado");
  const draws = await firstDrawsSince(page, mark, label(1, "anonimizado"));
  const detail = `dibujos de «Página 1, anonimizado»: ${describeDraws(draws, clickAt)}`;
  test.info().annotations.push({ type: "dibujos", description: detail });

  expect(near(draws[0]?.width ?? 0, ZOOM), detail).toBe(true);
  // No se repintó al instante: la imagen anterior siguió en pantalla hasta que llegó la nítida.
  expect((draws[0]?.at ?? 0) - clickAt, detail).toBeGreaterThan(80);
  expect((draws[0]?.at ?? 0) - clickAt, detail).toBeLessThan(HOLD_LIMIT_MS + 400);
  await expectNeverOldScale(page, mark, clickAt, label(1, "anonimizado"));
});

// ─── 3. Una página a la que se llegó por scroll mirando un solo lado ───────────

test("una página a la que se llegó por scroll mirando solo Original no se ve borrosa al conmutar", async ({
  page,
}) => {
  await openManyPages(page);

  // Anonimizado de la última página, guardada a 100 %.
  await scrollToEnd(page, "original");
  await waitDrawn(page, label(PAGE_COUNT, "original"), 1);
  await showView(page, "anonimizado");
  await waitDrawn(page, label(PAGE_COUNT, "anonimizado"), 1);
  await showView(page, "original");

  // Se vuelve arriba (la última página se desmonta, su imagen sigue en el store) y se hace zoom.
  await scrollToTop(page, "original");
  await expect(page.getByRole("img", { name: label(PAGE_COUNT, "original") })).toHaveCount(0);
  await zoomInThrice(page);
  await waitDrawn(page, label(1, "original"), ZOOM);

  // Se llega a la última página por scroll, mirando solo Original: el zoom no la pidió.
  await scrollToEnd(page, "original");
  await waitDrawn(page, label(PAGE_COUNT, "original"), ZOOM);

  const mark = await drawLogLength(page);
  const clickAt = await pageNow(page);
  await showView(page, "anonimizado");
  await expectNeverOldScale(page, mark, clickAt, label(PAGE_COUNT, "anonimizado"));
});

// ─── 4. El tope de 500 ms ──────────────────────────────────────────────────────

test("con el lado nuevo demorado más que el tope, el visor termina mostrando el lado pedido", async ({
  page,
}) => {
  await openLines(page);
  await visitBothAt100(page, "original");
  // El lado nuevo tarda mucho más que el tope.
  await setWorkerMessageDelay(page, 1500);
  await zoomInThrice(page);
  const originalSources = new Set(
    (await drawsSince(page, 0, label(1, "original"))).map((draw) => draw.src),
  );

  const mark = await drawLogLength(page);
  const clickAt = await pageNow(page);
  await showView(page, "anonimizado");
  const draws = await firstDrawsSince(page, mark, label(1, "anonimizado"));
  const detail = `dibujos de «Página 1, anonimizado»: ${describeDraws(draws, clickAt)}`;
  test.info().annotations.push({ type: "dibujos", description: detail });

  // Hasta el tope no se tocó nada (se mantuvo la imagen anterior); vencido, se pintó lo que
  // había del lado pedido, que es una imagen suya (no la del otro lado).
  const first = draws[0];
  expect((first?.at ?? 0) - clickAt, detail).toBeGreaterThanOrEqual(HOLD_LIMIT_MS - 100);
  expect((first?.at ?? 0) - clickAt, detail).toBeLessThan(1400);
  expect(originalSources.has(first?.src ?? ""), detail).toBe(false);

  // Y cuando llega la nítida, se cambia.
  await expect
    .poll(
      async () =>
        (await drawsSince(page, mark, label(1, "anonimizado"))).some((draw) =>
          near(draw.width, ZOOM),
        ),
      { message: detail, timeout: 15_000 },
    )
    .toBe(true);
  await expect(page.getByRole("img", { name: label(1, "anonimizado") })).toBeVisible();
});

// ─── 5. Qué pide el visor ──────────────────────────────────────────────────────

test("un scroll pide solo el lado que se mira", async ({ page }) => {
  await openManyPages(page);

  // Mirando Original.
  const originalMark = await renderRequestCount(page);
  await scrollToEnd(page, "original");
  await waitDrawn(page, label(PAGE_COUNT, "original"), 1);
  const whileOriginal = await renderRequestsSince(page, originalMark);
  expect(whileOriginal.length, "el scroll tiene que pedir las páginas nuevas").toBeGreaterThan(0);
  expect(
    whileOriginal.filter((request) => request.kind !== "original"),
    "mirando Original, ningún pedido es del lado anonimizado",
  ).toEqual([]);

  // Mirando Anonimizado.
  await showView(page, "anonimizado");
  await waitDrawn(page, label(PAGE_COUNT, "anonimizado"), 1);
  const anonymizedMark = await renderRequestCount(page);
  await scrollToTop(page, "anonimizado");
  await waitDrawn(page, label(1, "anonimizado"), 1);
  const whileAnonymized = await renderRequestsSince(page, anonymizedMark);
  expect(whileAnonymized.length, "el scroll tiene que pedir las páginas nuevas").toBeGreaterThan(0);
  expect(
    whileAnonymized.filter((request) => request.kind !== "anonymized"),
    "mirando Anonimizado, ningún pedido es del lado original",
  ).toEqual([]);
});

for (const viewing of ["original", "anonimizado"] as const) {
  test(`un zoom pide los dos lados, primero ${viewing}, con las mismas páginas y la misma escala`, async ({
    page,
  }) => {
    await openLines(page);
    await visitBothAt100(page, viewing);
    const mark = await renderRequestCount(page);
    await zoomInThrice(page);

    const kindOf = (name: ViewKind): "original" | "anonymized" =>
      name === "original" ? "original" : "anonymized";
    const pairsNow = async (): Promise<{ pairs: number; seen: string }> => {
      const zoomed = (await renderRequestsSince(page, mark)).filter(
        (request) => request.mode === "preview" && Math.abs((request.scale ?? 0) - ZOOM) < 1e-9,
      );
      const pairs = zoomed.filter((request, index) => {
        const next = zoomed[index + 1];
        return (
          request.kind === kindOf(viewing) &&
          next?.kind === kindOf(OTHER[viewing]) &&
          next.pageIndices.join(",") === request.pageIndices.join(",")
        );
      });
      return {
        pairs: pairs.length,
        seen: zoomed.map((request) => `${request.kind}@${request.scale}`).join(", "),
      };
    };
    try {
      await expect
        .poll(async () => (await pairsNow()).pairs, { timeout: 10_000 })
        .toBeGreaterThan(0);
    } catch (error) {
      throw new Error(`pedidos de preview a ${ZOOM}: [${(await pairsNow()).seen}]`, {
        cause: error,
      });
    }
  });
}

// ─── 6. Durante la espera, la capa de selección está inerte ────────────────────

interface OverlayProbe {
  readonly pointerEvents: string;
  readonly highlights: number;
}

/**
 * Conmuta con un click DOM y espera dos cuadros: React ya pintó la vista nueva, y la
 * espera de ADR-213 (500 ms) sigue en curso. Un click de Playwright no alcanza: con sus
 * viajes de ida y vuelta se acerca al tope.
 */
async function switchTabAfterTwoFrames(page: Page, tabName: string): Promise<void> {
  await page.evaluate(async (name) => {
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (element) => element.textContent?.trim() === name,
    );
    tab?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, tabName);
}

async function readOverlay(page: Page, pageLabel: string): Promise<OverlayProbe> {
  return page.evaluate((target) => {
    const canvas = document.querySelector<HTMLElement>(`[role="img"][aria-label="${target}"]`);
    const overlay = canvas?.parentElement?.parentElement?.querySelector<HTMLElement>(
      ":scope > div.select-none",
    );
    if (!overlay) return { pointerEvents: "sin capa", highlights: -1 };
    return {
      pointerEvents: getComputedStyle(overlay).pointerEvents,
      highlights: overlay.querySelectorAll('[class*="bg-warning/30"]').length,
    };
  }, pageLabel);
}

test("mientras la página espera la imagen del lado nuevo, su capa de selección está inerte y sin resaltado", async ({
  page,
}) => {
  await openLines(page);
  await visitBothAt100(page, "anonimizado");

  // Un resultado activo de la lupa: en la vista Anonimizado se ve resaltado.
  const search = page.getByRole("searchbox", { name: "Buscar en el documento" });
  await search.fill("tribunal");
  await expect
    .poll(async () => (await readOverlay(page, label(1, "anonimizado"))).highlights, {
      message: "el resaltado de la lupa tiene que verse en Anonimizado",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // Con el lado nuevo demorado, conmutar a Original deja la página esperando.
  await setWorkerMessageDelay(page, 1500);
  await zoomInThrice(page);
  await switchTabAfterTwoFrames(page, "Original");
  const waiting = await readOverlay(page, label(1, "original"));
  expect(waiting, "la capa de la página que espera").toEqual({
    pointerEvents: "none",
    highlights: 0,
  });

  // Cuando la espera termina (llegó la imagen o venció el tope), la capa vuelve a ser la de siempre.
  await expect
    .poll(async () => (await readOverlay(page, label(1, "original"))).pointerEvents, {
      message: "la capa tiene que volver a admitir selección",
      timeout: 15_000,
    })
    .not.toBe("none");
  await expect
    .poll(async () => (await readOverlay(page, label(1, "original"))).highlights, {
      message: "el resaltado de la lupa vuelve",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});
