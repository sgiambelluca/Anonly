import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

export class PdfPasswordRequiredError extends EngineError {
  readonly code = EngineErrorCode.PDF_PASSWORD_REQUIRED;
  readonly engineId = EngineId.Pdf;

  constructor(documentId: string) {
    super("PDF protegido requiere contraseña.", true, { documentId });
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
