/**
 * @anonly/ocr-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/OCR_Engine.md §6, §9, §10.
 * `OcrConfig` NO se redefine acá: vive en @anonly/shared (Contracts.md §6,
 * ADR-021 §2) y se re-exporta desde index.ts para conveniencia del caller.
 */

import type { BoundingBox, EncodedPageImage, Word } from "@anonly/shared";

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
 * ADR-143 §1/§3: produce la imagen de un descriptor. Nunca cruza un
 * `postMessage` ni entra en `EngineConfig` (`OcrConfig` se serializa hacia
 * los workers; una función no sobrevive eso) — el façade la implementa
 * llamando a `RenderEngine.rasterizePage` host-side.
 *
 * ADR-158 §2: devuelve `EncodedPageImage` (PNG), no `ImageData` cruda —
 * `RenderEngine.rasterizePage` ya la entrega codificada, y tesseract.js no
 * acepta píxeles crudos en ningún formato.
 */
export type OcrImageProducer = (
  request: OcrPageRequest,
  signal: AbortSignal,
) => Promise<EncodedPageImage>;

export interface OcrPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  // ADR-158 §2: imagen CODIFICADA (PNG), no píxeles crudos. Se CLONA, no se
  // transfiere — el reintento reusa el buffer (ADR-079/ADR-158 §5). El motor
  // la decodifica una sola vez, en el worker (worker/kernel.ts#kernelRecognize).
  readonly image: EncodedPageImage;
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
