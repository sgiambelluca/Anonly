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
 * **Extendido por `adr/ADR-054-Scroll-Independiente-Por-Panel.md` §8**: el
 * diagnóstico final del bug (tres defectos que se componían: el `min(Set)` de
 * arriba, la falta de un dueño del scroll, y una sincronización por índice de
 * página) llevó a eliminar la sincronización obligatoria entre los dos
 * paneles (`scrollSync.ts`/`computeScrollSyncTarget`, borrados). Con scroll
 * independiente por defecto, el test original de "salto grande" ya no puede
 * seguir asumiendo que el panel "anonimizado" se mueve junto con "original"
 * (esa era justamente la mitad del mecanismo que se retiró) — se ajusta acá
 * para verificar la independencia en vez de una propagación que ya no existe.
 * Los tests nuevos cubren el caso que el spec original no cubría: los DOS
 * paneles visibles a la vez (viewport ≥ 1024px), con la sincronización
 * opcional apagada (default) y prendida.
 */

import { expect, test, type Page } from "@playwright/test";

import { manyNeutralPagesFile } from "./support/fixtures.js";

const PAGE_COUNT = 60;

test.setTimeout(90_000);

/** Extrae el número de página (1-based) de un aria-label `"Página N, <kind>"`. */
function pageNumberFromAriaLabel(label: string | null): number | undefined {
  if (label === null) return undefined;
  const match = /Página (\d+),/.exec(label);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

async function mountedPageNumbers(page: Page, kindLabel: string): Promise<number[]> {
  const labels = await page
    .locator(`[aria-label="${kindLabel}"] [role="img"]`)
    .evaluateAll((elements) => elements.map((el) => el.getAttribute("aria-label")));
  const numbers = labels
    .map((label) => pageNumberFromAriaLabel(label))
    .filter((n): n is number => n !== undefined);
  return numbers.sort((a, b) => a - b);
}

async function importManyPagesDocument(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPageOriginal = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPageOriginal).toBeVisible({ timeout: 30_000 });
}

test("un salto grande de scroll deja el visor en la posición real, no en la página 1", async ({
  page,
}) => {
  await importManyPagesDocument(page);

  const originalContainer = page.locator('[aria-label="PDF original"] > div').first();
  await originalContainer.waitFor({ state: "visible" });

  // Salto grande de golpe en "original": equivalente a un usuario arrastrando
  // la scrollbar hasta el final, o varios wheel events rápidos que el
  // navegador coalesce. Con scroll independiente (ADR-054 §1), "anonimizado"
  // NO recibe ningún salto — no hay scroll-sync por defecto.
  await originalContainer.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight;
  });

  // Deja asentar el IntersectionObserver real del navegador: sus callbacks
  // están coalescidos por rAF (`PageVirtualizer.tsx`), así que un par de
  // frames + un margen chico alcanza para que el rango se estabilice.
  await page.waitForTimeout(500);

  const originalPages = await mountedPageNumbers(page, "PDF original");
  const anonymizedPages = await mountedPageNumbers(page, "PDF anonimizado");

  // Síntoma del bug original: el rango montado de "original" quedaba anclado
  // (parcial o totalmente) en la página 1 en vez de reflejar el salto al
  // final del documento.
  expect(
    originalPages.length,
    `páginas montadas (original): ${originalPages.join(", ")}`,
  ).toBeGreaterThan(0);
  expect(
    Math.min(...originalPages),
    `rango montado (original) tras el salto: [${originalPages.join(", ")}] — no debería incluir la página 1`,
  ).toBeGreaterThan(PAGE_COUNT - 10);

  // Independencia (ADR-054 §1): "anonimizado" no fue tocado, así que se queda
  // exactamente donde montó al abrir el documento — cerca de la página 1.
  expect(
    anonymizedPages.length,
    `páginas montadas (anonimizado): ${anonymizedPages.join(", ")}`,
  ).toBeGreaterThan(0);
  expect(
    Math.min(...anonymizedPages),
    `"anonimizado" no debería haberse movido: [${anonymizedPages.join(", ")}]`,
  ).toBeLessThanOrEqual(3);
});

test.describe("viewport ancho (≥ 1024px, dos paneles visibles) — ADR-054 §8", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("sincronización apagada (default): cruzar varios bordes de página con la rueda no decrece scrollTop, ningún panel vuelve a la página 1, y el panel no tocado no se mueve", async ({
    page,
  }) => {
    await importManyPagesDocument(page);

    const originalContainer = page.locator('[aria-label="PDF original"] > div').first();
    const anonymizedContainer = page.locator('[aria-label="PDF anonimizado"] > div').first();
    await originalContainer.waitFor({ state: "visible" });
    await anonymizedContainer.waitFor({ state: "visible" });

    const anonymizedScrollTopBefore = await anonymizedContainer.evaluate((el) => el.scrollTop);
    expect(anonymizedScrollTopBefore).toBe(0);

    const box = await originalContainer.boundingBox();
    if (!box) throw new Error('No se pudo ubicar el contenedor de "original".');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    let previousScrollTop = 0;
    const WHEEL_TICKS = 20;
    const WHEEL_DELTA_Y = 350; // 20 * 350 = 7000px: varias veces el alto de página (800px), cruza sobradamente 3-4 bordes.

    for (let tick = 0; tick < WHEEL_TICKS; tick += 1) {
      await page.mouse.wheel(0, WHEEL_DELTA_Y);
      await page.waitForTimeout(30);

      const currentScrollTop = await originalContainer.evaluate((el) => el.scrollTop);
      expect(
        currentScrollTop,
        `scrollTop de "original" decreció en el tick ${tick}: ${previousScrollTop} → ${currentScrollTop}`,
      ).toBeGreaterThanOrEqual(previousScrollTop);
      previousScrollTop = currentScrollTop;
    }

    await page.waitForTimeout(300);

    const originalPages = await mountedPageNumbers(page, "PDF original");
    expect(
      Math.min(...originalPages),
      `"original" no debería haber vuelto a la página 1: [${originalPages.join(", ")}]`,
    ).toBeGreaterThan(3);

    // Con la sincronización apagada (default), "anonimizado" no fue tocado
    // por el mouse: debe seguir exactamente donde estaba (ADR-054 §1/§8,
    // "con sync apagada, mover un panel no mueve al otro").
    const anonymizedScrollTopAfter = await anonymizedContainer.evaluate((el) => el.scrollTop);
    expect(anonymizedScrollTopAfter).toBe(anonymizedScrollTopBefore);
    const anonymizedPages = await mountedPageNumbers(page, "PDF anonimizado");
    expect(
      Math.min(...anonymizedPages),
      `"anonimizado" no debería haberse movido: [${anonymizedPages.join(", ")}]`,
    ).toBeLessThanOrEqual(3);
  });

  test("sincronización prendida: cruzar varios bordes de página con la rueda no decrece scrollTop en ningún panel, ninguno vuelve a la página 1, y quedan alineados a nivel de píxel", async ({
    page,
  }) => {
    await importManyPagesDocument(page);

    // Prende la sincronización desde el control del visor (ADR-054 §2,
    // `ScrollSyncToggle`), visible en este viewport ancho.
    await page.getByRole("button", { name: "Sincronizar scroll de los paneles" }).click();
    await expect(
      page.getByRole("button", { name: "Desincronizar scroll de los paneles" }),
    ).toBeVisible();

    const originalContainer = page.locator('[aria-label="PDF original"] > div').first();
    const anonymizedContainer = page.locator('[aria-label="PDF anonimizado"] > div').first();
    await originalContainer.waitFor({ state: "visible" });
    await anonymizedContainer.waitFor({ state: "visible" });

    const box = await originalContainer.boundingBox();
    if (!box) throw new Error('No se pudo ubicar el contenedor de "original".');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    let previousOriginal = 0;
    let previousAnonymized = 0;
    const WHEEL_TICKS = 20;
    const WHEEL_DELTA_Y = 350;

    for (let tick = 0; tick < WHEEL_TICKS; tick += 1) {
      await page.mouse.wheel(0, WHEEL_DELTA_Y);
      // La sincronización es imperativa e idempotente, sin temporizador
      // (ADR-054 §3): un margen chico alcanza para que el eco del panel
      // empujado se asiente antes de leer.
      await page.waitForTimeout(30);

      const currentOriginal = await originalContainer.evaluate((el) => el.scrollTop);
      const currentAnonymized = await anonymizedContainer.evaluate((el) => el.scrollTop);

      expect(
        currentOriginal,
        `scrollTop de "original" decreció en el tick ${tick}`,
      ).toBeGreaterThanOrEqual(previousOriginal);
      expect(
        currentAnonymized,
        `scrollTop de "anonimizado" decreció en el tick ${tick}`,
      ).toBeGreaterThanOrEqual(previousAnonymized);

      previousOriginal = currentOriginal;
      previousAnonymized = currentAnonymized;
    }

    await page.waitForTimeout(300);

    const originalPages = await mountedPageNumbers(page, "PDF original");
    const anonymizedPages = await mountedPageNumbers(page, "PDF anonimizado");
    expect(
      Math.min(...originalPages),
      `"original" no debería haber vuelto a la página 1: [${originalPages.join(", ")}]`,
    ).toBeGreaterThan(3);
    expect(
      Math.min(...anonymizedPages),
      `"anonimizado" no debería haber vuelto a la página 1: [${anonymizedPages.join(", ")}]`,
    ).toBeGreaterThan(3);

    // Alineados a nivel de píxel (ADR-054 §3), no solo "en el mismo rango de
    // páginas": la sincronización sincroniza scrollTop contra scrollTop.
    const finalOriginal = await originalContainer.evaluate((el) => el.scrollTop);
    const finalAnonymized = await anonymizedContainer.evaluate((el) => el.scrollTop);
    expect(
      Math.abs(finalOriginal - finalAnonymized),
      `paneles desalineados: original=${finalOriginal}, anonimizado=${finalAnonymized}`,
    ).toBeLessThanOrEqual(1);
  });
});
