import type { Word } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describePageSeparator,
  PAGE_SEPARATOR_PX,
  pageStride,
  wordsBoundingBox,
  zoomFromWheel,
} from "../components/viewer/viewerGestures.js";
import { MAX_ZOOM, MIN_ZOOM } from "../store/viewer.store.js";

// ADR-169 §7/§9: pellizco, separador entre páginas y selección persistente.

describe("zoomFromWheel (pellizco y Ctrl + rueda)", () => {
  it("hacia arriba acerca, hacia abajo aleja", () => {
    expect(zoomFromWheel(1, -10)).toBeGreaterThan(1);
    expect(zoomFromWheel(1, 10)).toBeLessThan(1);
  });

  it("una muesca de rueda no salta medio zoom de golpe", () => {
    const next = zoomFromWheel(1, 1000);
    expect(next).toBeGreaterThan(0.75);
  });

  it("respeta los límites de los botones", () => {
    expect(zoomFromWheel(MAX_ZOOM, -50)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(MIN_ZOOM, 50)).toBe(MIN_ZOOM);
  });

  it("redondea a centésimas", () => {
    const value = zoomFromWheel(1, -3);
    expect(Math.round(value * 100) / 100).toBe(value);
  });
});

describe("separador entre páginas", () => {
  it("el paso incluye el separador", () => {
    expect(pageStride(800)).toBe(800 + PAGE_SEPARATOR_PX);
  });

  it("'Página N de M'", () => {
    expect(describePageSeparator(0, 12)).toBe("Página 1 de 12");
    expect(describePageSeparator(6, 12)).toBe("Página 7 de 12");
  });
});

describe("wordsBoundingBox", () => {
  function word(x: number, y: number, width: number, height: number): Word {
    return { text: "w", bbox: { x, y, width, height }, pageIndex: 0, confidence: 1, source: "ocr" };
  }

  it("envuelve las palabras de la selección", () => {
    expect(wordsBoundingBox([word(10, 20, 30, 10), word(50, 18, 20, 14)])).toEqual({
      x: 10,
      y: 18,
      width: 60,
      height: 14,
    });
  });

  it("sin palabras no hay recuadro", () => {
    expect(wordsBoundingBox([])).toBeNull();
  });
});
