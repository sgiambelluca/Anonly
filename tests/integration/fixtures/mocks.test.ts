/**
 * N-1 (revisión B-1, ronda B): `viewportTransformFor` (`mocks.ts`) tomaba el
 * ancho/alto de la página SIN rotar en vez de los del VIEWPORT (ya
 * intercambiados a 90°/270°) — en una página no cuadrada eso da una
 * traslación equivocada a 270°. Mínima aserción directa, sin pasar por
 * `createCore()`: sobre 200×300 pt con `/Rotate 270`, el viewport pasa a
 * 300×200 y la traslación de `transform` tiene que ser `(300, 200)`, no
 * `(200, 300)` (el bug que este test habría dejado pasar).
 */
import { describe, expect, it } from "vitest";

import { createMockPdfPage } from "./mocks.js";

/**
 * `createMockPdfPage` devuelve `Record<string, unknown>` a propósito (mismo
 * shape dinámico que `pdfjs-dist` real) — se lee `getViewport` en runtime, sin
 * el cast de frontera que `Code_Standards.md` §2 reserva solo para librerías
 * externas mockeadas.
 */
function readViewport(
  page: Record<string, unknown>,
  scale: number,
): { readonly width: number; readonly height: number; readonly transform: ReadonlyArray<number> } {
  const getViewport = page.getViewport;
  if (typeof getViewport !== "function") {
    throw new Error("createMockPdfPage no devolvió un getViewport invocable.");
  }
  const viewport: unknown = getViewport({ scale });
  if (typeof viewport !== "object" || viewport === null) {
    throw new Error("getViewport no devolvió un objeto.");
  }
  const { width, height, transform } = viewport as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number" || !Array.isArray(transform)) {
    throw new Error("getViewport devolvió una forma inesperada (width/height/transform).");
  }
  return { width, height, transform: transform as ReadonlyArray<number> };
}

describe("createMockPdfPage — getViewport a 270° sobre una página no cuadrada (N-1)", () => {
  it("intercambia width/height y usa la traslación del VIEWPORT, no la de la página sin rotar", () => {
    const page = createMockPdfPage([], [], [], 270, { width: 200, height: 300 });
    const viewport = readViewport(page, 1);

    // 200×300 sin rotar -> viewport 300×200 a 270°.
    expect(viewport.width).toBe(300);
    expect(viewport.height).toBe(200);
    // `viewportTransformFor(270, viewportWidth, viewportHeight)` =
    // `[0, -1, -1, 0, viewportWidth, viewportHeight]` — la traslación tiene
    // que ser (300, 200), NO (200, 300) (el bug: pasarle el ancho/alto sin
    // rotar daba la traslación de la página, no la del viewport).
    expect(viewport.transform).toEqual([0, -1, -1, 0, 300, 200]);
  });

  it("a escala 2, la matriz completa (incluida la traslación) escala uniformemente", () => {
    const page = createMockPdfPage([], [], [], 270, { width: 200, height: 300 });
    const viewport = readViewport(page, 2);

    expect(viewport.width).toBe(600);
    expect(viewport.height).toBe(400);
    expect(viewport.transform).toEqual([0, -2, -2, 0, 600, 400]);
  });
});
