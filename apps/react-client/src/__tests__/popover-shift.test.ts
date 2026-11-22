import { describe, expect, it } from "vitest";

import { shiftIntoWindow } from "../components/viewer/popoverShift.js";

describe("shiftIntoWindow", () => {
  it("un globo que ya entra no se mueve", () => {
    expect(shiftIntoWindow(100, 460, 800)).toBe(0);
  });

  it("un globo que se sale por la derecha se corre hacia la izquierda, con margen", () => {
    expect(shiftIntoWindow(600, 960, 800)).toBe(-168);
  });

  it("un globo que se sale por la izquierda se corre hacia la derecha", () => {
    expect(shiftIntoWindow(-20, 340, 800)).toBe(28);
  });

  it("si no entra en ningún lado, gana el borde izquierdo", () => {
    expect(shiftIntoWindow(10, 410, 300)).toBe(-2);
  });
});
