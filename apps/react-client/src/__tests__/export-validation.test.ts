import { describe, expect, it } from "vitest";

import { shouldReopenOnResult } from "../components/export/ExportDialog.js";
import {
  EXPORT_DPI,
  EXPORT_IMAGE_FORMAT,
  EXPORT_JPEG_QUALITY,
  MAX_EXPORT_DPI,
  MAX_JPEG_QUALITY,
  MIN_EXPORT_DPI,
  MIN_JPEG_QUALITY,
  buildExportOptions,
  normalizeExportFilename,
} from "../components/export/exportValidation.js";

// ADR-087 §5: el formulario ya no tiene campos técnicos, así que no hay nada
// que validar — `validateExportForm` se retira con ellos. Lo que sí importa
// afirmar es que los valores fijos que quedan **caen dentro** de las
// restricciones de `core/Export_Engine.md` §9, porque ahora nadie los revisa
// en runtime.

describe("buildExportOptions", () => {
  it("arma las opciones con los valores fijos de ADR-087 §5", () => {
    expect(buildExportOptions({ filename: "anonimizado.pdf", includeMarkerLegend: false })).toEqual(
      {
        imageFormat: "jpeg",
        jpegQuality: 0.92,
        dpi: 150,
        includeOriginalMetadata: false,
        filename: "anonimizado.pdf",
        includeMarkerLegend: false,
      },
    );
  });

  it("propaga el único control que queda", () => {
    expect(
      buildExportOptions({ filename: "anonimizado.pdf", includeMarkerLegend: true })
        .includeMarkerLegend,
    ).toBe(true);
  });

  it("nunca arrastra metadata del original, sea cual sea el input", () => {
    for (const includeMarkerLegend of [true, false]) {
      expect(
        buildExportOptions({ filename: "anonimizado.pdf", includeMarkerLegend })
          .includeOriginalMetadata,
      ).toBe(false);
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

describe("normalizeExportFilename", () => {
  it("conserva un nombre que ya termina en .pdf", () => {
    expect(normalizeExportFilename("pericia-2026.pdf")).toBe("pericia-2026.pdf");
  });

  it("agrega la extensión si falta: un archivo sin extensión no lo abre nada", () => {
    expect(normalizeExportFilename("pericia-2026")).toBe("pericia-2026.pdf");
  });

  it("no duplica la extensión aunque venga en mayúsculas", () => {
    expect(normalizeExportFilename("PERICIA.PDF")).toBe("PERICIA.PDF");
  });

  it("un nombre vacío o de solo espacios cae al default, no es un error", () => {
    // El campo arranca poblado: vaciarlo es "no me importa el nombre", no algo
    // que merezca frenar el export con un mensaje.
    expect(normalizeExportFilename("")).toBe("anonimizado.pdf");
    expect(normalizeExportFilename("   ")).toBe("anonimizado.pdf");
  });

  it("recorta los espacios de los bordes", () => {
    expect(normalizeExportFilename("  pericia.pdf  ")).toBe("pericia.pdf");
  });

  it("el nombre normalizado es el que viaja en las opciones", () => {
    expect(
      buildExportOptions({ filename: "  pericia  ", includeMarkerLegend: false }).filename,
    ).toBe("pericia.pdf");
  });
});

describe("shouldReopenOnResult", () => {
  it("con un resultado vigente, reabrir muestra el resultado y no el formulario", () => {
    // Regresión: al cerrar el diálogo tras exportar, el blobUrl seguía en
    // `pipeline.store` pero la UI no tenía camino de vuelta a él — reabrir
    // mostraba un formulario en blanco y la única salida era re-exportar.
    expect(shouldReopenOnResult({ blobUrl: "blob:x" })).toBe(true);
  });

  it("sin resultado, reabrir muestra el formulario", () => {
    expect(shouldReopenOnResult(null)).toBe(false);
  });
});
