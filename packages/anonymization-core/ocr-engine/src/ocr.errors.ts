/**
 * @anonly/ocr-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/OCR_Engine.md §11.
 * Los error codes (OCR_PAGE_FAILED, OCR_TIMEOUT, OCR_MODEL_MISSING) ya
 * existen en EngineErrorCode (Contracts.md §4 / shared/src/enums.ts) — no
 * se agregan nuevos acá.
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/** Tesseract lanza error en una página tras maxRetries. No recuperable. */
export class OcrPageFailedError extends EngineError {
  readonly code = EngineErrorCode.OCR_PAGE_FAILED;
  readonly engineId = EngineId.Ocr;

  constructor(documentId: string, pageIndex: number, reason: string) {
    super(`OCR falló en la página ${pageIndex} del documento ${documentId}: ${reason}`, false, {
      documentId,
      pageIndex,
      reason,
    });
  }
}

/** Timeout por página excedido. Recuperable: se reintenta hasta maxRetries["ocr-page"]. */
export class OcrTimeoutError extends EngineError {
  readonly code = EngineErrorCode.OCR_TIMEOUT;
  readonly engineId = EngineId.Ocr;

  constructor(documentId: string, pageIndex: number, timeoutMs: number) {
    super(`Timeout al procesar OCR de la página ${pageIndex} (${timeoutMs}ms).`, true, {
      documentId,
      pageIndex,
      timeoutMs,
    });
  }
}

/** No se pudo cargar/descargar el modelo Tesseract. No recuperable: abortar OCR. */
export class OcrModelMissingError extends EngineError {
  readonly code = EngineErrorCode.OCR_MODEL_MISSING;
  readonly engineId = EngineId.Ocr;

  constructor(languages: ReadonlyArray<string>, reason: string) {
    super(
      `No se pudo cargar el modelo Tesseract para idioma(s) [${languages.join(", ")}]: ${reason}`,
      false,
      { languages, reason },
    );
  }
}
