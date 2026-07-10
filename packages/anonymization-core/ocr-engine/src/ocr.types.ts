/**
 * @anonly/ocr-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/OCR_Engine.md §6, §9, §10.
 * `OcrConfig` NO se redefine acá: vive en @anonly/shared (Contracts.md §6,
 * ADR-021 §2) y se re-exporta desde index.ts para conveniencia del caller.
 */

import type { Word } from "@anonly/shared";

export interface OcrPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  /** Rasterización de la página. Zero-copy transfer real: Hito 9 (ADR-021 §1). */
  readonly imageData: ImageData;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

export interface OcrPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  /** Ordenadas por bbox.y asc, luego bbox.x asc (OCR_Engine.md §10). */
  readonly words: ReadonlyArray<Word>;
  /** Promedio de confidence de las palabras de la página, en [0,1]. */
  readonly confidence: number;
  readonly durationMs: number;
}
