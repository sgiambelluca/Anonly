import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

export class PdfPasswordRequiredError extends EngineError {
  readonly code = EngineErrorCode.PDF_PASSWORD_REQUIRED;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string) {
    super("PDF protegido requiere contraseña.", false, { documentId });
  }
}

export class PdfInvalidError extends EngineError {
  readonly code = EngineErrorCode.PDF_INVALID;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string, reason: string) {
    super(`PDF inválido: ${reason}`, false, { documentId, reason });
  }
}

export class PdfCorruptedError extends EngineError {
  readonly code = EngineErrorCode.PDF_CORRUPTED;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string, reason: string, pageIndex?: number) {
    super(`PDF corrupto: ${reason}`, false, { documentId, reason, pageIndex });
  }
}

/**
 * ADR-140: página con `/Rotate` (heredado o propio) distinto de 0 que
 * produce al menos una palabra nativa — `parsePage` mezcla el marco de
 * `viewport` (que ya aplicó la rotación) con el de `item.transform` (que no),
 * y el error medido va de 130 a 268 pt en una página de 200×300, a veces
 * fuera de la página. `details` se limita a `documentId`/`pageIndex`/
 * `rotation`: nada de texto de la página, nombre de archivo real ni
 * contraseña (ADR-140 §1).
 */
export class PdfPageRotatedError extends EngineError {
  readonly code = EngineErrorCode.PDF_PAGE_ROTATED;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string, pageIndex: number, rotation: number) {
    super(
      `Página ${pageIndex} declara /Rotate ${rotation} y tiene texto nativo: no soportado en esta versión.`,
      false,
      { documentId, pageIndex, rotation },
    );
  }
}

export class PdfTimeoutError extends EngineError {
  readonly code = EngineErrorCode.PDF_TIMEOUT;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string, pageIndex: number, timeoutMs: number) {
    super(`Timeout al parsear página ${pageIndex} (${timeoutMs}ms).`, true, {
      documentId,
      pageIndex,
      timeoutMs,
    });
  }
}
