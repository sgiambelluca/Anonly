import { describe, expect, it } from "vitest";

import { shouldReassignCanvasDimensions } from "../components/viewer/canvasDimensions.js";

describe("shouldReassignCanvasDimensions", () => {
  it("returns false when width and height are both unchanged", () => {
    expect(
      shouldReassignCanvasDimensions({ width: 600, height: 800 }, { width: 600, height: 800 }),
    ).toBe(false);
  });

  it("returns true when width differs", () => {
    expect(
      shouldReassignCanvasDimensions({ width: 600, height: 800 }, { width: 601, height: 800 }),
    ).toBe(true);
  });

  it("returns true when height differs", () => {
    expect(
      shouldReassignCanvasDimensions({ width: 600, height: 800 }, { width: 600, height: 801 }),
    ).toBe(true);
  });

  it("returns true when both width and height differ", () => {
    expect(
      shouldReassignCanvasDimensions({ width: 600, height: 800 }, { width: 300, height: 400 }),
    ).toBe(true);
  });

  it("returns false for the initial 0,0 canvas size compared against itself", () => {
    // Caso borde: un <canvas> recién creado sin atributos width/height tiene
    // 0,0 por defecto (spec HTML). No es el caso que dispara el bug (acá
    // "current" también es 0,0), pero documenta que la función no asume
    // ningún tamaño mínimo — eso lo garantiza el Math.max(1, ...) del caller.
    expect(shouldReassignCanvasDimensions({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(
      false,
    );
  });
});
