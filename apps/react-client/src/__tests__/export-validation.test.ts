import { describe, expect, it } from "vitest";

import {
  EXPORT_DPI,
  EXPORT_IMAGE_FORMAT,
  EXPORT_JPEG_QUALITY,
  MAX_EXPORT_DPI,
  MAX_JPEG_QUALITY,
  MIN_EXPORT_DPI,
  MIN_JPEG_QUALITY,
  buildExportOptions,
} from "../components/export/exportValidation.js";

// ADR-087 §5: el formulario ya no tiene campos técnicos, así que no hay nada
// que validar — `validateExportForm` se retira con ellos. Lo que sí importa
// afirmar es que los valores fijos que quedan **caen dentro** de las
// restricciones de `core/Export_Engine.md` §9, porque ahora nadie los revisa
// en runtime.

describe("buildExportOptions", () => {
  it("arma las opciones con los valores fijos de ADR-087 §5", () => {
    expect(buildExportOptions({ includeMarkerLegend: false })).toEqual({
      imageFormat: "jpeg",
      jpegQuality: 0.92,
      dpi: 150,
      includeOriginalMetadata: false,
      filename: "anonimizado.pdf",
      includeMarkerLegend: false,
    });
  });

  it("propaga el único control que queda", () => {
    expect(buildExportOptions({ includeMarkerLegend: true }).includeMarkerLegend).toBe(true);
  });

  it("nunca arrastra metadata del original, sea cual sea el input", () => {
    for (const includeMarkerLegend of [true, false]) {
      expect(buildExportOptions({ includeMarkerLegend }).includeOriginalMetadata).toBe(false);
    }
  });
});

describe("los valores fijos respetan el contrato del motor", () => {
  it("el DPI cae dentro del rango de Export_Engine.md §9", () => {
    expect(EXPORT_DPI).toBeGreaterThanOrEqual(MIN_EXPORT_DPI);
    expect(EXPORT_DPI).toBeLessThanOrEqual(MAX_EXPORT_DPI);
  });

  it("la calidad JPEG cae dentro del rango de Export_Engine.md §9", () => {
    expect(EXPORT_JPEG_QUALITY).toBeGreaterThanOrEqual(MIN_JPEG_QUALITY);
    expect(EXPORT_JPEG_QUALITY).toBeLessThanOrEqual(MAX_JPEG_QUALITY);
  });

  it("la calidad es 0.92 y no 1.00: a 1.00 el archivo crece ×3-4 sin diferencia visible", () => {
    expect(EXPORT_JPEG_QUALITY).toBe(0.92);
    expect(EXPORT_JPEG_QUALITY).toBeLessThan(MAX_JPEG_QUALITY);
  });

  it("el rango de calidad solo aplica al formato jpeg, que es el que se usa", () => {
    expect(EXPORT_IMAGE_FORMAT).toBe("jpeg");
  });
});
