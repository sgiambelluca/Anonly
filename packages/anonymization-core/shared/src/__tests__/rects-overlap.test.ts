/**
 * ADR-127 — el solapamiento 2D, una sola vez.
 *
 * Los dos casos que importan son los que **separaban** a las dos copias que
 * este ADR unifica: el borde exacto y el área cero. `render-engine` no tenía
 * la guarda de área cero, así que para un rectángulo degenerado contestaba
 * distinto que `shared`, y ningún test lo veía porque cada motor corre su
 * propia suite.
 */

import { describe, expect, it } from "vitest";

import { rectsOverlap } from "../rects-overlap.js";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("rectsOverlap", () => {
  it("is true for partially overlapping rectangles", () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
  });

  it("is true when one contains the other", () => {
    expect(rectsOverlap(rect(0, 0, 100, 100), rect(10, 10, 5, 5))).toBe(true);
    expect(rectsOverlap(rect(10, 10, 5, 5), rect(0, 0, 100, 100))).toBe(true);
  });

  it("is false for disjoint rectangles on either axis", () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(20, 0, 10, 10))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(0, 20, 10, 10))).toBe(false);
  });

  it("is false when they only touch on the exact edge", () => {
    // Solapamiento estricto, mismo criterio que `sharesVerticalBand`.
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(0, 10, 10, 10))).toBe(false);
  });

  it("is false when either rectangle has no area — the answer render-engine got wrong", () => {
    expect(rectsOverlap(rect(5, 0, 0, 10), rect(0, 0, 10, 10))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 0))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 0, 0), rect(0, 0, 0, 0))).toBe(false);
  });

  it("is false for negative dimensions", () => {
    expect(rectsOverlap(rect(0, 0, -10, 10), rect(0, 0, 10, 10))).toBe(false);
  });

  it("is symmetric", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
  });
});
