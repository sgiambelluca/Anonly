import { describe, expect, it } from "vitest";

import { resolveMenuLayout, resolveMenuPlacement } from "../components/entities/menuPlacement.js";

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

describe("resolveMenuLayout", () => {
  it("mantiene el espacio exacto hacia abajo sin desplazar el panel", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 100,
        triggerBottom: 130,
        menuHeight: 200,
        gap: 4,
        boundaryTop: 0,
        boundaryBottom: 334,
      }),
    ).toEqual({ placement: "bottom", top: 34, maxHeight: 200 });
  });

  it("desplaza lo mínimo un panel que abre abajo dentro de límites recortados", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 250,
        triggerBottom: 280,
        menuHeight: 243,
        gap: 4,
        boundaryTop: 100,
        boundaryBottom: 500,
      }),
    ).toEqual({ placement: "bottom", top: 7, maxHeight: 243 });
  });

  it("desplaza un panel hacia arriba hasta el borde superior cuando ningún lado basta", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 250,
        triggerBottom: 280,
        menuHeight: 300,
        gap: 4,
        boundaryTop: 0,
        boundaryBottom: 500,
      }),
    ).toEqual({ placement: "top", top: -250, maxHeight: 300 });
  });

  it("conserva el desempate hacia abajo y desplaza solo lo necesario", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 200,
        triggerBottom: 230,
        menuHeight: 400,
        gap: 4,
        boundaryTop: 0,
        boundaryBottom: 430,
      }),
    ).toEqual({ placement: "bottom", top: -170, maxHeight: 400 });
  });

  it("limita al alto total disponible y empieza en su borde cuando el menú es mayor", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 40,
        triggerBottom: 60,
        menuHeight: 200,
        gap: 4,
        boundaryTop: 10,
        boundaryBottom: 110,
      }),
    ).toEqual({ placement: "bottom", top: -30, maxHeight: 100 });
  });

  it("tolera un área degenerada sin producir un alto negativo", () => {
    expect(
      resolveMenuLayout({
        triggerTop: 100,
        triggerBottom: 130,
        menuHeight: 200,
        gap: 4,
        boundaryTop: 90,
        boundaryBottom: 90,
      }),
    ).toEqual({ placement: "top", top: -10, maxHeight: 0 });
  });
});
