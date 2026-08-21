/**
 * `exportValidation.ts` — los valores fijos del export y la construcción de
 * `ExportOptions` (ADR-087 §5, `ui/UX_Guidelines.md` §8.2).
 *
 * **El formulario ya no tiene campos técnicos**, así que tampoco tiene qué
 * validar: `imageFormat`, `jpegQuality`, `dpi`, `title` y `filename` son
 * constantes de este módulo. El criterio del recorte (ADR-087 §5): se
 * pregunta lo que **altera el documento**, no lo que ajusta su codificación.
 * Lo único que queda en el diálogo es el checkbox de la referencia de
 * marcadores, que **suma una página** (ADR-059 §6).
 *
 * Se conservan las constantes de rango de `core/Export_Engine.md` §9 aunque
 * ningún camino de la UI pueda violarlas ahora: son el contrato del motor, y
 * documentan que los valores fijos de abajo caen adentro.
 */

import type { ExportOptions } from "@anonly/anonymization-core";

export const MIN_EXPORT_DPI = 1;
export const MAX_EXPORT_DPI = 600;
export const MIN_JPEG_QUALITY = 0.5;
export const MAX_JPEG_QUALITY = 1;

/**
 * Menor tamaño a fidelidad equivalente en documentos de texto
 * (`Export_Engine.md` §13 caso 6).
 */
export const EXPORT_IMAGE_FORMAT = "jpeg" as const;

/**
 * **`0.92` y no `1.00`**, y no es una concesión: a `1.00` el archivo crece
 * ×3–4 sobre q 0.85 (`Export_Engine.md` §12: ~100–300 KB/página a 0.85), lo
 * que lleva un expediente de 100 páginas de ~20 MB a ~80–120 MB **sin ninguna
 * diferencia visible en texto**. Y no compra fidelidad: el original ya se
 * perdió al rasterizar — el export es 100 % imagen (`Export_Engine.md` §11,
 * con test de CI). La palanca de fidelidad real es el DPI.
 */
export const EXPORT_JPEG_QUALITY = 0.92;

/** Default de `ExportConfig`. */
export const EXPORT_DPI = 150;

export const DEFAULT_EXPORT_FILENAME = "anonimizado.pdf";

export interface ExportFormState {
  /** Lo único que el usuario decide (ADR-087 §5). */
  readonly includeMarkerLegend: boolean;
}

export function buildExportOptions(form: ExportFormState): ExportOptions {
  return {
    imageFormat: EXPORT_IMAGE_FORMAT,
    jpegQuality: EXPORT_JPEG_QUALITY,
    dpi: EXPORT_DPI,
    // Nunca `true`: el export no arrastra metadata del original
    // (`Export_Engine.md` §9). Por eso el campo "Título" del formulario
    // anterior tampoco se echa de menos — lo que protegía ya estaba protegido.
    includeOriginalMetadata: false,
    filename: DEFAULT_EXPORT_FILENAME,
    includeMarkerLegend: form.includeMarkerLegend,
  };
}
