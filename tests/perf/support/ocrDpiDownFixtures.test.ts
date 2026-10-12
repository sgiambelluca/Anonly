import { describe, expect, it } from "vitest";

import { buildSyntheticSource, fixtureCacheKey, rasterizeOptions } from "./ocrDpiDownFixtures.js";
import { scannedFixtureHash } from "./scannedFixtureCache.js";

describe("fixtures a DPI nativo variable (M-E1, M-E2)", () => {
  it("a 300 dpi la clave y las opciones son las de la campaña de DPI descendente", async () => {
    const { truth } = await buildSyntheticSource("S10");
    expect(fixtureCacheKey(truth)).toBe("ocr-dpi-down-s10-fs10-300dpi");
    expect(fixtureCacheKey(truth, 300)).toBe(fixtureCacheKey(truth));
    expect(rasterizeOptions(truth)).toEqual({ scale: 300 / 72 });
    expect(rasterizeOptions(truth, 300)).toEqual(rasterizeOptions(truth));
  });

  it("el DPI nativo forma parte de la clave y del hash del fixture", async () => {
    const source = await buildSyntheticSource("S10");
    const keys = [300, 200, 150].map((dpi) => fixtureCacheKey(source.truth, dpi));
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toBe("ocr-dpi-down-s10-fs10-200dpi");
    const hashes = [300, 200, 150].map((dpi) =>
      scannedFixtureHash(source.bytes, rasterizeOptions(source.truth, dpi)),
    );
    expect(new Set(hashes).size).toBe(3);
  });

  it("SD: la receta de fotocopia es la misma a cualquier DPI nativo, en píxeles del raster de ese DPI", async () => {
    // Hallazgo de M-E2: la receta fija el desenfoque (1 px) y el ruido (σ 6) en PÍXELES, no en milímetros.
    // A 200 y 150 dpi el mismo 1 px es físicamente más grande (0,127 y 0,169 mm contra 0,085 mm a 300
    // dpi) y el tamaño del glifo en píxeles es menor: la degradación relativa al texto crece al bajar el
    // DPI. Este test fija que no se escala; si cambia, es una decisión del planificador.
    const { truth } = await buildSyntheticSource("SD1");
    const options = [300, 200, 150].map((dpi) => rasterizeOptions(truth, dpi));
    for (const option of options) {
      expect(option.degradation).toEqual({
        recipe: "photocopy-v2",
        seed: 190_001,
        blurSigmaPx: 1,
        blackLevel: 40,
        whiteLevel: 235,
        noiseSigma: 6,
      });
    }
    expect(options.map((option) => option.scale)).toEqual([300 / 72, 200 / 72, 150 / 72]);
    expect(fixtureCacheKey(truth, 200)).toBe("ocr-dpi-down-sd1-fs10-photocopy-v2-s190001-200dpi");
  });

  it("las cinco variantes de SD difieren solo en la semilla del ruido", async () => {
    const seeds: number[] = [];
    for (const id of ["SD1", "SD2", "SD3", "SD4", "SD5"] as const) {
      const { truth } = await buildSyntheticSource(id);
      const degradation = rasterizeOptions(truth, 150).degradation;
      expect(degradation?.blurSigmaPx).toBe(1);
      seeds.push(degradation?.seed ?? -1);
    }
    expect(new Set(seeds).size).toBe(5);
  });
});
