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
 * momento en que corre el rAF. Un salto grande (scroll real del usuario, o el
 * scroll-sync programático entre los dos `PdfViewer` de `SideBySideViewer`)
 * podría dejar páginas viejas (bajo índice) en el Set si el navegador reporta
 * las entradas de salida/entrada en callbacks separados, produciendo un rango
 * falsamente ancho aplicado sin chequeo de plausibilidad.
 *
 * Este spec NO asume el mecanismo: solo verifica el síntoma observable (el
 * rango de páginas montado tras el salto corresponde a la posición real de
 * scroll, no a la página 1) en un Chromium real (no jsdom/fakes de
 * `IntersectionObserver` — timing real del navegador, mismo criterio que los
 * "siete bugs reales" que solo aparecieron con Playwright en PR10,
 * `Hito10_Observaciones_Revision.md`).
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

test("un salto grande de scroll deja el visor en la posición real, no en la página 1", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  // Espera a que el visor monte la página 1 (no hace falta esperar a Ready:
  // el montaje de páginas depende solo de conocer pageCount, vía
  // DOCUMENT_PARSED, mucho antes de Detecting/Grouping/Ready).
  const firstPageOriginal = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPageOriginal).toBeVisible({ timeout: 30_000 });

  const originalContainer = page.locator('[aria-label="PDF original"] > div').first();
  await originalContainer.waitFor({ state: "visible" });

  // Salto grande de golpe: scrollea el panel "original" directo al fondo
  // (equivalente a un usuario arrastrando la scrollbar hasta el final, o
  // varios wheel events rápidos que el navegador coalesce). El panel
  // "anonimizado" recibe el mismo salto por el scroll-sync programático
  // (`scrollSync.ts`), que es la otra vía sospechada por la hipótesis.
  await originalContainer.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight;
  });

  // Deja asentar el IntersectionObserver real del navegador: sus callbacks
  // están coalescidos por rAF (`PageVirtualizer.tsx`), así que un par de
  // frames + un margen chico alcanza para que el rango se estabilice.
  await page.waitForTimeout(500);

  const originalPages = await mountedPageNumbers(page, "PDF original");
  const anonymizedPages = await mountedPageNumbers(page, "PDF anonimizado");

  // Síntoma del bug: el rango montado queda anclado (parcial o totalmente) en
  // la página 1 en vez de reflejar el salto al final del documento. Ambas
  // aserciones fallan de forma clara y legible si el bug está presente.
  expect(
    originalPages.length,
    `páginas montadas (original): ${originalPages.join(", ")}`,
  ).toBeGreaterThan(0);
  expect(
    Math.min(...originalPages),
    `rango montado (original) tras el salto: [${originalPages.join(", ")}] — no debería incluir la página 1`,
  ).toBeGreaterThan(PAGE_COUNT - 10);

  expect(
    anonymizedPages.length,
    `páginas montadas (anonimizado): ${anonymizedPages.join(", ")}`,
  ).toBeGreaterThan(0);
  expect(
    Math.min(...anonymizedPages),
    `rango montado (anonimizado, scroll-sync) tras el salto: [${anonymizedPages.join(", ")}] — no debería incluir la página 1`,
  ).toBeGreaterThan(PAGE_COUNT - 10);
});
