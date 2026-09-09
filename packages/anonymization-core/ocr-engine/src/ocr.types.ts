/**
 * @anonly/ocr-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/OCR_Engine.md §6, §9, §10.
 * `OcrConfig` NO se redefine acá: vive en @anonly/shared (Contracts.md §6,
 * ADR-021 §2) y se re-exporta desde index.ts para conveniencia del caller.
 */

import type { BoundingBox, Word } from "@anonly/shared";

/**
 * ADR-143 §1: descriptor liviano — sin imagen — de una página o región a
 * OCR-ear. `OcrEngine.processSession` pide la `ImageData` real recién cuando
 * tiene lugar en la ventana de trabajo (§3), no por adelantado.
 */
export interface OcrPageRequest {
  readonly documentId: string;
  readonly pageIndex: number;
  /** ADR-065: presente si es un recorte, ausente si es la página entera. */
  readonly region?: BoundingBox;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
  /** Bytes RGBA estimados por dimensiones × escala, ANTES de producir. */
  readonly estimatedBytes: number;
}

/**
 * ADR-143 §1/§3: produce la `ImageData` de un descriptor. Nunca cruza un
 * `postMessage` ni entra en `EngineConfig` (`OcrConfig` se serializa hacia
 * los workers; una función no sobrevive eso) — el façade la implementa
 * llamando a `RenderEngine.rasterizePage` host-side.
 */
export type OcrImageProducer = (request: OcrPageRequest, signal: AbortSignal) => Promise<ImageData>;

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
