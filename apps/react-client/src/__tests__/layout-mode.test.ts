import { describe, expect, it } from "vitest";

import {
  LAYOUT_MIN_SUPPORTED_PX,
  LAYOUT_WIDE_MIN_PX,
  resolveLayoutMode,
} from "../components/screens/layoutMode.js";

describe("resolveLayoutMode", () => {
  it("de 1024 para arriba, barra lateral y visor conviven", () => {
    expect(resolveLayoutMode(LAYOUT_WIDE_MIN_PX)).toBe("wide");
    expect(resolveLayoutMode(1280)).toBe("wide");
    expect(resolveLayoutMode(2560)).toBe("wide");
  });

  it("entre 640 y 1023, la barra lateral pasa a cajón", () => {
    // Este rango es el que la regresión de §19 arruinaba y el que más valía
    // recuperar: una ventana en media pantalla de un laptop, donde el layout
    // andaba casi bien y lo único que lo rompía era el `min-w` que no cede.
    expect(resolveLayoutMode(LAYOUT_MIN_SUPPORTED_PX)).toBe("drawer");
    expect(resolveLayoutMode(768)).toBe("drawer");
    expect(resolveLayoutMode(LAYOUT_WIDE_MIN_PX - 1)).toBe("drawer");
  });

  it("por debajo de 640, aviso: no entra una fila del árbol ni con el visor a pantalla completa", () => {
    expect(resolveLayoutMode(LAYOUT_MIN_SUPPORTED_PX - 1)).toBe("too-narrow");
    expect(resolveLayoutMode(375)).toBe("too-narrow");
  });

  describe("bordes", () => {
    it("los dos umbrales son inclusivos hacia arriba", () => {
      // Un off-by-one acá es invisible en pantalla y deja el layout roto justo
      // en el ancho de un dispositivo común.
      expect(resolveLayoutMode(1023)).toBe("drawer");
      expect(resolveLayoutMode(1024)).toBe("wide");
      expect(resolveLayoutMode(639)).toBe("too-narrow");
      expect(resolveLayoutMode(640)).toBe("drawer");
    });

    it("un ancho absurdo no rompe la resolución", () => {
      expect(resolveLayoutMode(0)).toBe("too-narrow");
      expect(resolveLayoutMode(-100)).toBe("too-narrow");
    });
  });
});
