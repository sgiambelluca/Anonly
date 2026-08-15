import { describe, expect, it } from "vitest";

import {
  isOriginalPanel,
  pageRectToScreenRect,
  pointerSelectionToPageRect,
} from "../components/viewer/wordSelectionRect.js";

const BASE = { displayWidth: 400, displayHeight: 800, pageWidth: 200, pageHeight: 400 };

describe("pointerSelectionToPageRect", () => {
  it("scales a drag rect from screen space to page space (2x here)", () => {
    const rect = pointerSelectionToPageRect({
      ...BASE,
      startX: 10,
      startY: 20,
      endX: 50,
      endY: 60,
    });
    expect(rect).toEqual({ x: 5, y: 10, width: 20, height: 20 });
  });

  it("normalizes a drag drawn from bottom-right to top-left", () => {
    const rect = pointerSelectionToPageRect({
      ...BASE,
      startX: 50,
      startY: 60,
      endX: 10,
      endY: 20,
    });
    expect(rect).toEqual({ x: 5, y: 10, width: 20, height: 20 });
  });

  it("expands a click (no drag) into a minimum-size square instead of a zero-area rect", () => {
    const rect = pointerSelectionToPageRect({
      ...BASE,
      startX: 100,
      startY: 200,
      endX: 100,
      endY: 200,
    });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    // Centrado en el punto de click, en coordenadas de página (2x).
    expect(rect.x + rect.width / 2).toBeCloseTo(50);
    expect(rect.y + rect.height / 2).toBeCloseTo(100);
  });

  it("treats a sub-pixel jitter as a click, not a drag", () => {
    const rect = pointerSelectionToPageRect({
      ...BASE,
      startX: 100,
      startY: 200,
      endX: 101,
      endY: 201,
    });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe("isOriginalPanel", () => {
  it("gates the hit-test and DocumentSearchBox to the original panel only (ADR-061 §3/§8)", () => {
    expect(isOriginalPanel("original")).toBe(true);
    expect(isOriginalPanel("anonymized")).toBe(false);
  });
});

describe("pageRectToScreenRect", () => {
  it("is the inverse of pointerSelectionToPageRect's scaling (same 2x fixture)", () => {
    const displaySize = { displayWidth: 400, displayHeight: 800 };
    const pageSize = { pageWidth: 200, pageHeight: 400 };
    const screenRect = pageRectToScreenRect(
      { x: 5, y: 10, width: 20, height: 20 },
      displaySize,
      pageSize,
    );
    expect(screenRect).toEqual({ left: 10, top: 20, width: 40, height: 40 });
  });
});
