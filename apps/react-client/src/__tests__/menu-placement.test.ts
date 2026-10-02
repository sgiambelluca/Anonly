import { describe, expect, it } from "vitest";

import { resolveMenuPlacement } from "../components/entities/menuPlacement.js";

// Un área visible de 0 a 600 y un menú de 200 de alto.
const base = { menuHeight: 200, boundaryTop: 0, boundaryBottom: 600 };

describe("resolveMenuPlacement", () => {
  it("abre hacia abajo cuando entra", () => {
    expect(resolveMenuPlacement({ ...base, triggerTop: 100, triggerBottom: 130 })).toBe("bottom");
  });

  it("abre hacia abajo cuando entra justo", () => {
    expect(resolveMenuPlacement({ ...base, triggerTop: 370, triggerBottom: 400 })).toBe("bottom");
  });

  it("abre hacia arriba en las últimas filas, donde abajo no entra", () => {
    expect(resolveMenuPlacement({ ...base, triggerTop: 540, triggerBottom: 570 })).toBe("top");
  });

  it("si no entra en ningún lado, elige el que tiene más lugar", () => {
    const small = { menuHeight: 400, boundaryTop: 0, boundaryBottom: 500 };
    expect(resolveMenuPlacement({ ...small, triggerTop: 300, triggerBottom: 330 })).toBe("top");
    expect(resolveMenuPlacement({ ...small, triggerTop: 100, triggerBottom: 130 })).toBe("bottom");
  });

  it("en el empate, abajo", () => {
    const tie = { menuHeight: 400, boundaryTop: 0, boundaryBottom: 430 };
    expect(resolveMenuPlacement({ ...tie, triggerTop: 200, triggerBottom: 230 })).toBe("bottom");
  });

  it("mide contra el área que recorta, no contra la ventana", () => {
    // La lista termina en 400 aunque la ventana siga: abajo no entra.
    expect(
      resolveMenuPlacement({
        menuHeight: 200,
        boundaryTop: 100,
        boundaryBottom: 400,
        triggerTop: 330,
        triggerBottom: 360,
      }),
    ).toBe("top");
  });
});
