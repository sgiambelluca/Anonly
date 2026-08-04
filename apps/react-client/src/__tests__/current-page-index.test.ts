import { describe, expect, it } from "vitest";

import { computeCurrentPageIndexFromScroll } from "../components/viewer/currentPageIndex.js";

describe("computeCurrentPageIndexFromScroll", () => {
  it("returns page 0 at the very top of the document", () => {
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 0,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: 20,
      }),
    ).toBe(0);
  });

  it("returns the page whose span contains the center of the viewport", () => {
    // Viewport de 1000px empezando en scrollTop=1600 (borde superior de la
    // página índice 2, 1600..2400): el centro cae en 2100, dentro de esa
    // página.
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 1600,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: 20,
      }),
    ).toBe(2);
  });

  it("changes only once the center crosses into the next page's span", () => {
    // Centro en 799 (scrollTop=799, clientHeight=0): todavía página 0.
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 799,
        clientHeight: 0,
        pageSize: 800,
        pageCount: 20,
      }),
    ).toBe(0);
    // Centro en 800 exacto: ya página 1.
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 800,
        clientHeight: 0,
        pageSize: 800,
        pageCount: 20,
      }),
    ).toBe(1);
  });

  it("handles the last page where the browser clips scrollTop against scrollHeight - clientHeight (edge case of ADR-054 §8)", () => {
    // 10 páginas de 800px = 8000px de scrollHeight. Con un viewport de 600px
    // (menor a una página), el máximo scrollTop que el navegador permite es
    // 8000 - 600 = 7400. El centro del viewport ahí es 7400 + 300 = 7700,
    // que cae dentro de la página índice 9 (7200..8000): la última.
    const pageCount = 10;
    const pageSize = 800;
    const clientHeight = 600;
    const maxScrollTop = pageCount * pageSize - clientHeight;
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: maxScrollTop,
        clientHeight,
        pageSize,
        pageCount,
      }),
    ).toBe(pageCount - 1);
  });

  it("a direct division without the viewport-center offset would under-report the last page — this is exactly the case the center formula fixes", () => {
    // Mismo escenario que el test anterior: dividir scrollTop/pageSize directo
    // (sin el offset de medio viewport) da 7400/800 = 9.25 → floor 9... pero
    // con un viewport más angosto la brecha es más clara: clientHeight=1600
    // (2 páginas de alto), pageCount=10, pageSize=800. scrollHeight=8000,
    // maxScrollTop=8000-1600=6400. scrollTop/pageSize=6400/800=8 (índice 8),
    // pero el centro del viewport (6400+800=7200)/800=9 (índice 9, la última
    // página real, ya que el viewport de 1600px llega hasta el final del
    // documento).
    const pageCount = 10;
    const pageSize = 800;
    const clientHeight = 1600;
    const maxScrollTop = pageCount * pageSize - clientHeight;

    const directDivision = Math.floor(maxScrollTop / pageSize);
    expect(directDivision).toBe(8); // "no da el índice exacto" (ADR-054 §5)

    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: maxScrollTop,
        clientHeight,
        pageSize,
        pageCount,
      }),
    ).toBe(pageCount - 1); // 9: la fórmula por centro sí da la última página real.
  });

  it("clamps to pageCount - 1 even if rounding pushes the computed index one page past the last page", () => {
    // Caso defensivo: un scrollTop mayor al máximo teórico (no debería pasar
    // en el navegador real, pero la función no debe devolver un índice fuera
    // de rango si pasa).
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 100_000,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: 10,
      }),
    ).toBe(9);
  });

  it("clamps to 0 for a defensively negative scrollTop", () => {
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: -500,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: 10,
      }),
    ).toBe(0);
  });

  it("returns 0 when pageCount is 0 or negative (document not parsed yet)", () => {
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 4000,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: 0,
      }),
    ).toBe(0);
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 4000,
        clientHeight: 1000,
        pageSize: 800,
        pageCount: -1,
      }),
    ).toBe(0);
  });

  it("returns 0 when pageSize is 0 or negative (defensive, layout not ready)", () => {
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 4000,
        clientHeight: 1000,
        pageSize: 0,
        pageCount: 10,
      }),
    ).toBe(0);
  });

  it("handles a single-page document", () => {
    expect(
      computeCurrentPageIndexFromScroll({
        scrollTop: 0,
        clientHeight: 800,
        pageSize: 800,
        pageCount: 1,
      }),
    ).toBe(0);
  });
});
