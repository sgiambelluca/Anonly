import { describe, expect, it } from "vitest";

import {
  dialogLayerFor,
  dialogZIndex,
  MAX_DIALOG_LAYER,
} from "../components/common/dialogLayers.js";

describe("dialogLayers", () => {
  it("el primer diálogo conserva el z-index de siempre", () => {
    expect(dialogZIndex(0)).toEqual({ overlay: 40, content: 50 });
  });

  it("el fondo del diálogo anidado queda por encima del contenido del padre", () => {
    for (let layer = 1; layer <= MAX_DIALOG_LAYER; layer += 1) {
      expect(dialogZIndex(layer).overlay).toBeGreaterThan(dialogZIndex(layer - 1).content);
      expect(dialogZIndex(layer).content).toBeGreaterThan(dialogZIndex(layer).overlay);
    }
  });

  it("acota la capa y nunca baja de cero", () => {
    expect(dialogLayerFor(-1)).toBe(0);
    expect(dialogLayerFor(9)).toBe(MAX_DIALOG_LAYER);
    expect(dialogZIndex(9).content).toBeLessThan(95);
  });
});
