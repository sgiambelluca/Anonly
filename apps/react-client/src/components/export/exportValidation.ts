/**
 * `exportValidation.ts` — validación pura + construcción de `ExportOptions`
 * para `ExportDialog` (`ui/UX_Guidelines.md` §8.2, `core/Export_Engine.md`
 * §9 "Restricciones": `dpi > 0 y ≤ 600`, `jpegQuality ∈ [0.5, 1]` si
 * `imageFormat === "jpeg"`, `includeOriginalMetadata` siempre `false`).
 */

import type { ExportOptions } from "@anonly/anonymization-core";

export interface ExportFormState {
  readonly filename: string;
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;
  readonly dpi: number;
  /** Cadena vacía = sin título (campo opcional de `ExportOptions`). */
  readonly title: string;
  readonly includeMarkerLegend: boolean;
}

export interface ExportValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export const MIN_EXPORT_DPI = 1;
export const MAX_EXPORT_DPI = 600;
export const MIN_JPEG_QUALITY = 0.5;
export const MAX_JPEG_QUALITY = 1;

export function validateExportForm(form: ExportFormState): ExportValidationResult {
  if (form.filename.trim() === "") {
    return { valid: false, reason: "El nombre de archivo es obligatorio." };
  }
  if (!Number.isFinite(form.dpi) || form.dpi < MIN_EXPORT_DPI || form.dpi > MAX_EXPORT_DPI) {
    return {
      valid: false,
      reason: `El DPI debe estar entre ${MIN_EXPORT_DPI} y ${MAX_EXPORT_DPI}.`,
    };
  }
  if (
    form.imageFormat === "jpeg" &&
    (!Number.isFinite(form.jpegQuality) ||
      form.jpegQuality < MIN_JPEG_QUALITY ||
      form.jpegQuality > MAX_JPEG_QUALITY)
  ) {
    return {
      valid: false,
      reason: `La calidad JPEG debe estar entre ${MIN_JPEG_QUALITY} y ${MAX_JPEG_QUALITY}.`,
    };
  }
  return { valid: true };
}

/**
 * `null` si `form` no pasa `validateExportForm` — el llamador debe validar
 * antes de construir las opciones definitivas para `actions.requestExport`.
 */
export function buildExportOptions(form: ExportFormState): ExportOptions | null {
  if (!validateExportForm(form).valid) return null;
  const trimmedTitle = form.title.trim();
  return {
    imageFormat: form.imageFormat,
    jpegQuality: form.jpegQuality,
    dpi: form.dpi,
    includeOriginalMetadata: false,
    filename: form.filename.trim(),
    includeMarkerLegend: form.includeMarkerLegend,
    ...(trimmedTitle !== "" ? { title: trimmedTitle } : {}),
  };
}
