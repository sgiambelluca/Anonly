/**
 * Contraste de los campos de texto en tema oscuro.
 *
 * Existe por un defecto real: el buscador de entidades no declaraba fondo
 * propio y `color-scheme` no estaba declarado, así que en oscuro quedaba con
 * el blanco por defecto del navegador y el texto claro encima — blanco sobre
 * blanco, no se leía lo que se escribía. Lo encontró el humano usando el
 * instalador en Windows 11, no un test.
 *
 * Se afirma sobre **estilos computados**, no sobre clases: lo que rompe no es
 * que falte una clase sino que el resultado final sea ilegible, y eso puede
 * pasar por el default del navegador, por un `color-scheme` ausente o por una
 * regla que pisa a otra.
 */

import { expect, openApp, test } from "./support/electronApp.js";
import { textTenPagesFile } from "./support/fixtures.js";

test.setTimeout(240_000);

test("en tema oscuro, ningún campo de texto queda ilegible", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("anonly:settings", JSON.stringify({ theme: "dark" }));
  });
  await openApp(page);

  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    "dark",
  );

  // Los campos de búsqueda solo existen con un documento abierto.
  await page.locator('input[type="file"]').setInputFiles(await textTenPagesFile());
  await page.getByRole("button", { name: "Exportar" }).waitFor({ timeout: 180_000 });

  const ilegibles = await page.evaluate(() => {
    function canales(color: string): [number, number, number] {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (m === null) return [0, 0, 0];
      const [r = 0, g = 0, b = 0] = m[1]!.split(",").map((n) => Number.parseFloat(n));
      return [r, g, b];
    }
    function luminancia(color: string): number {
      const lineal = canales(color).map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lineal[0]! + 0.7152 * lineal[1]! + 0.0722 * lineal[2]!;
    }
    /** Sube por los ancestros hasta encontrar un fondo que no sea transparente. */
    function fondoEfectivo(el: Element): string {
      let actual: Element | null = el;
      while (actual !== null) {
        const bg = getComputedStyle(actual).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        actual = actual.parentElement;
      }
      return "rgb(255, 255, 255)";
    }

    return [...document.querySelectorAll("input, textarea")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const estilo = getComputedStyle(el);
        const l1 = luminancia(estilo.color);
        const l2 = luminancia(fondoEfectivo(el));
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return {
          campo: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.tagName,
          texto: estilo.color,
          fondo: fondoEfectivo(el),
          ratio: Math.round(ratio * 100) / 100,
        };
      })
      .filter((r) => r.ratio < 4.5);
  });

  expect(ilegibles, `campos por debajo de 4.5:1 en oscuro: ${JSON.stringify(ilegibles)}`).toEqual(
    [],
  );
});
