import { describe, expect, it } from "vitest";

import {
  buildExportOptions,
  validateExportForm,
  type ExportFormState,
} from "../components/export/exportValidation.js";

function makeForm(overrides: Partial<ExportFormState> = {}): ExportFormState {
  return {
    filename: "anonimizado.pdf",
    imageFormat: "jpeg",
    jpegQuality: 0.85,
    dpi: 150,
    title: "",
    includeMarkerLegend: false,
    ...overrides,
  };
}

describe("validateExportForm", () => {
  it("is valid for the default form", () => {
    expect(validateExportForm(makeForm())).toEqual({ valid: true });
  });

  it("is invalid when filename is empty", () => {
    const result = validateExportForm(makeForm({ filename: "   " }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/nombre/);
  });

  it("is invalid when dpi is 0 or negative", () => {
    expect(validateExportForm(makeForm({ dpi: 0 })).valid).toBe(false);
    expect(validateExportForm(makeForm({ dpi: -150 })).valid).toBe(false);
  });

  it("is invalid when dpi exceeds 600", () => {
    expect(validateExportForm(makeForm({ dpi: 601 })).valid).toBe(false);
  });

  it("is invalid when jpegQuality is out of [0.5, 1] for jpeg format", () => {
    expect(validateExportForm(makeForm({ imageFormat: "jpeg", jpegQuality: 0.4 })).valid).toBe(
      false,
    );
    expect(validateExportForm(makeForm({ imageFormat: "jpeg", jpegQuality: 1.5 })).valid).toBe(
      false,
    );
  });

  it("ignores jpegQuality bounds when format is png", () => {
    expect(validateExportForm(makeForm({ imageFormat: "png", jpegQuality: 0 }))).toEqual({
      valid: true,
    });
  });
});

describe("buildExportOptions", () => {
  it("builds options with includeOriginalMetadata forced to false", () => {
    const options = buildExportOptions(makeForm());
    expect(options).toEqual({
      imageFormat: "jpeg",
      jpegQuality: 0.85,
      dpi: 150,
      includeOriginalMetadata: false,
      filename: "anonimizado.pdf",
      includeMarkerLegend: false,
    });
  });

  it("copies includeMarkerLegend when true", () => {
    const options = buildExportOptions(makeForm({ includeMarkerLegend: true }));
    expect(options?.includeMarkerLegend).toBe(true);
  });

  it("trims filename and omits an empty title", () => {
    const options = buildExportOptions(makeForm({ filename: "  out.pdf  ", title: "   " }));
    expect(options?.filename).toBe("out.pdf");
    expect(options).not.toHaveProperty("title");
  });

  it("includes a trimmed title when provided", () => {
    const options = buildExportOptions(makeForm({ title: "  Informe  " }));
    expect(options?.title).toBe("Informe");
  });

  it("returns null when the form is invalid", () => {
    expect(buildExportOptions(makeForm({ filename: "" }))).toBeNull();
  });
});
