/**
 * Bug 3 (Hito 10, sesión de fixes post-PR13): un salto grande de scroll hace
 * que el visor "vuelva" a la página 1 en vez de quedarse donde el usuario
 * scrolleó.
 *
 * Hipótesis del planificador (a confirmar/descartar acá, NO asumida):
 * `PageVirtualizer.tsx` mantiene `intersectingRef.current` (un `Set<number>`
 * mutado por los callbacks del `IntersectionObserver`, coalescidos por un
 * único `requestAnimationFrame`). `computeVisibleRangeFromIndices`
 * (`visibleRange.ts`) calcula el rango como min/max de TODO ese Set en el
 * momento en que corre el rAF. Un salto grande (scroll real del usuario) podía
 * dejar páginas viejas (bajo índice) en el Set si el navegador reporta las
 * entradas de salida/entrada en callbacks separados, produciendo un rango
 * falsamente ancho aplicado sin chequeo de plausibilidad.
 *
 * Este spec NO asume el mecanismo: solo verifica el síntoma observable (el
 * rango de páginas montado tras el salto corresponde a la posición real de
 * scroll, no a la página 1) en un Chromium real (no jsdom/fakes de
 * `IntersectionObserver` — timing real del navegador, mismo criterio que los
 * "siete bugs reales" que solo aparecieron con Playwright en PR10,
 * `Hito10_Observaciones_Revision.md`).
 *
 * ---
 *
 * **Reescrito por ADR-087 §2: ya no hay dos paneles.** La versión anterior
 * cubría, además del salto, la relación ENTRE los dos paneles del
 * `SideBySideViewer` (independencia con la sincronización apagada, alineación
 * a nivel de píxel con la sincronización prendida — ADR-054 §8). Ese visor se
 * retiró: ahora hay **un solo visor con un toggle** Original/Anonimizado, así
 * que no hay un segundo panel que pueda moverse solo ni desalinearse, y el
 * `ScrollSyncToggle` que esos tests manejaban ya no existe.
 *
 * Qué se conserva y qué lo reemplaza:
 *
 * - El **síntoma original** (salto grande → rango montado real) sigue igual de
 *   vigente: es del virtualizador, no del reparto en paneles. Se mantiene.
 * - El **cruce de bordes de página con la rueda** (scrollTop nunca decrece,
 *   no se vuelve a la página 1) también es del virtualizador. Se mantiene, sin
 *   el `describe` de "viewport ancho" que existía solo para tener los dos
 *   paneles a la vista.
 * - La **alineación entre paneles** no tiene equivalente directo, pero sí
 *   tiene un sucesor con el mismo propósito: que al mirar el mismo documento
 *   de dos maneras no se pierda el lugar donde uno estaba. En el visor único
 *   eso es **conmutar Original ↔ Anonimizado sin perder la posición de
 *   scroll**, y es cobertura nueva de ADR-087 §2.
 */

import { type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { manyNeutralPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

const PAGE_COUNT = 60;

test.setTimeout(90_000);

/** Extrae el número de página (1-based) de un aria-label `"Página N, <kind>"`. */
function pageNumberFromAriaLabel(label: string | null): number | undefined {
  if (label === null) return undefined;
  const match = /Página (\d+),/.exec(label);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

/**
 * Páginas montadas con contenido real. `kindLabel` es el `aria-label` del
 * contenedor del visor (`PdfViewer.tsx#KIND_LABEL`), que cambia con el modo
 * porque el visor es uno solo y muestra un kind por vez.
 */
async function mountedPageNumbers(page: Page, kindLabel: string): Promise<number[]> {
  const labels = await page
    .locator(`[aria-label="${kindLabel}"] [role="img"]`)
    .evaluateAll((elements) => elements.map((el) => el.getAttribute("aria-label")));
  const numbers = labels
    .map((label) => pageNumberFromAriaLabel(label))
    .filter((n): n is number => n !== undefined);
  return numbers.sort((a, b) => a - b);
}

function viewerContainer(page: Page, kindLabel = "Documento original") {
  return page.locator(`[aria-label="${kindLabel}"] > div`).first();
}

async function importManyPagesDocument(page: Page): Promise<void> {
  await openApp(page, "networkidle");
  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPageOriginal = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPageOriginal).toBeVisible({ timeout: 30_000 });
}

test("un salto grande de scroll deja el visor en la posición real, no en la página 1", async ({
  page,
}) => {
  await importManyPagesDocument(page);

  const container = viewerContainer(page);
  await container.waitFor({ state: "visible" });

  // Salto grande de golpe: equivalente a un usuario arrastrando la scrollbar
  // hasta el final, o varios wheel events rápidos que el navegador coalesce.
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight;
  });

  // Deja asentar el IntersectionObserver real del navegador: sus callbacks
  // están coalescidos por rAF (`PageVirtualizer.tsx`), así que un par de
  // frames + un margen chico alcanza para que el rango se estabilice.
  await page.waitForTimeout(500);

  const mounted = await mountedPageNumbers(page, "Documento original");

  // Síntoma del bug original: el rango montado quedaba anclado (parcial o
  // totalmente) en la página 1 en vez de reflejar el salto al final.
  expect(mounted.length, `páginas montadas: ${mounted.join(", ")}`).toBeGreaterThan(0);
  expect(
    Math.min(...mounted),
    `rango montado tras el salto: [${mounted.join(", ")}] — no debería incluir la página 1`,
  ).toBeGreaterThan(PAGE_COUNT - 10);
});

test("cruzar varios bordes de página con la rueda no decrece scrollTop ni vuelve a la página 1", async ({
  page,
}) => {
  await importManyPagesDocument(page);

  const container = viewerContainer(page);
  await container.waitFor({ state: "visible" });

  const box = await container.boundingBox();
  if (!box) throw new Error("No se pudo ubicar el contenedor del visor.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  let previousScrollTop = 0;
  const WHEEL_TICKS = 20;
  const WHEEL_DELTA_Y = 350; // 20 * 350 = 7000px: varias veces el alto de página (800px), cruza sobradamente 3-4 bordes.

  for (let tick = 0; tick < WHEEL_TICKS; tick += 1) {
    await page.mouse.wheel(0, WHEEL_DELTA_Y);
    await page.waitForTimeout(30);

    const currentScrollTop = await container.evaluate((el) => el.scrollTop);
    expect(
      currentScrollTop,
      `scrollTop decreció en el tick ${tick}: ${previousScrollTop} → ${currentScrollTop}`,
    ).toBeGreaterThanOrEqual(previousScrollTop);
    previousScrollTop = currentScrollTop;
  }

  await page.waitForTimeout(300);

  const mounted = await mountedPageNumbers(page, "Documento original");
  expect(
    Math.min(...mounted),
    `el visor no debería haber vuelto a la página 1: [${mounted.join(", ")}]`,
  ).toBeGreaterThan(3);
});

/**
 * Sucesor de los dos tests de sincronización entre paneles (ADR-054 §8), que
 * se fueron con el `SideBySideViewer`. El propósito que sí sobrevive: mirar el
 * mismo documento de dos maneras sin perder el lugar donde uno estaba.
 *
 * Corre con **NER apagado** (`nerEnabled: false`) porque necesita llegar a
 * `Ready` —el toggle está deshabilitado hasta entonces (`ViewerModeToggle.tsx`,
 * `isAnonymizedAvailable`)— y el análisis NER de 60 páginas no aporta nada a
 * lo que este test mira. Es el mismo recurso que usa `scenario-8`.
 */
test("conmutar Original ↔ Anonimizado conserva la posición de scroll", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await importManyPagesDocument(page);

  const original = viewerContainer(page, "Documento original");
  await original.waitFor({ state: "visible" });

  const anonymizedTab = page.getByRole("tab", { name: "Anonimizado" });
  await expect(anonymizedTab).toBeEnabled({ timeout: 60_000 });

  // Una posición cualquiera que no sea el principio ni el final: si el toggle
  // reseteara el scroll, el destino natural sería 0, y arrancar en 0 no lo
  // distinguiría de "conservó la posición".
  await original.evaluate((el) => {
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 3);
  });
  await page.waitForTimeout(400);
  const scrollBefore = await original.evaluate((el) => el.scrollTop);
  expect(scrollBefore, "el scroll de partida no debería ser 0").toBeGreaterThan(0);

  await anonymizedTab.click();

  const anonymized = viewerContainer(page, "Documento anonimizado");
  await anonymized.waitFor({ state: "visible" });
  await page.waitForTimeout(400);

  const scrollAfter = await anonymized.evaluate((el) => el.scrollTop);
  expect(
    Math.abs(scrollAfter - scrollBefore),
    `conmutar a "Anonimizado" movió el visor: ${scrollBefore} → ${scrollAfter}`,
  ).toBeLessThanOrEqual(1);

  // Y de vuelta: la ida podría conservarse por accidente si el contenedor no
  // se remonta, pero la vuelta pasa por el mismo camino y vale afirmarla.
  await page.getByRole("tab", { name: "Original" }).click();
  await original.waitFor({ state: "visible" });
  await page.waitForTimeout(400);

  const scrollBack = await original.evaluate((el) => el.scrollTop);
  expect(
    Math.abs(scrollBack - scrollBefore),
    `volver a "Original" movió el visor: ${scrollBefore} → ${scrollBack}`,
  ).toBeLessThanOrEqual(1);
});
