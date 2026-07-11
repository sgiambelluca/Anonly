/**
 * @anonly/ner-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/NER_Engine.md §11.
 * Los error codes (NER_MODEL_MISSING, NER_MODEL_LOAD_FAILED, NER_TIMEOUT,
 * NER_PAGE_FAILED) ya existen en EngineErrorCode (Contracts.md §4 /
 * shared/src/enums.ts) — no se agregan nuevos acá.
 *
 * `retryable` por código (NER_Engine.md §11): NER_MODEL_LOAD_FAILED = true,
 * NER_PAGE_FAILED = true, NER_TIMEOUT = true. NER_MODEL_MISSING = false.
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * El modelo no está cacheado y no se pudo descargar (o, tras un reintento de
 * NerModelLoadFailedError, la descarga sigue fallando — spec §13 caso 8).
 * No recuperable: abortar NER, ofrecer descargar manual o desactivar NER.
 */
export class NerModelMissingError extends EngineError {
  readonly code = EngineErrorCode.NER_MODEL_MISSING;
  readonly engineId = EngineId.Ner;

  constructor(modelId: string, reason: string) {
    super(`No se pudo cargar/descargar el modelo NER "${modelId}": ${reason}`, false, {
      modelId,
      reason,
    });
  }
}

/**
 * El modelo descargado no carga (corrupto, incompatible). Recuperable: el
 * motor re-descarga una vez; si persiste, se escala a NerModelMissingError.
 */
export class NerModelLoadFailedError extends EngineError {
  readonly code = EngineErrorCode.NER_MODEL_LOAD_FAILED;
  readonly engineId = EngineId.Ner;

  constructor(modelId: string, reason: string) {
    super(`El modelo NER "${modelId}" descargado no pudo cargarse: ${reason}`, true, {
      modelId,
      reason,
    });
  }
}

/**
 * Error de inferencia en una página tras agotar los reintentos
 * (ctx.config.workerPool.maxRetries["ner-page"]). Recuperable a nivel
 * pipeline: se descartan las ocurrencias NER de esa página y se continúa con
 * las demás (las ocurrencias de Regex se mantienen). No existe un evento
 * NER_PAGE_FAILED en el bus (a diferencia de OCR_PAGE_FAILED): NER_Engine.md
 * §7 no lo define, así que el fallo se reporta solo vía excepción + log.
 */
export class NerPageFailedError extends EngineError {
  readonly code = EngineErrorCode.NER_PAGE_FAILED;
  readonly engineId = EngineId.Ner;

  constructor(documentId: string, pageIndex: number, reason: string) {
    super(`NER falló en la página ${pageIndex} del documento ${documentId}: ${reason}`, true, {
      documentId,
      pageIndex,
      reason,
    });
  }
}

/** Timeout por página excedido. Recuperable: se reintenta hasta maxRetries["ner-page"]. */
export class NerTimeoutError extends EngineError {
  readonly code = EngineErrorCode.NER_TIMEOUT;
  readonly engineId = EngineId.Ner;

  constructor(documentId: string, pageIndex: number, timeoutMs: number) {
    super(`Timeout al procesar NER de la página ${pageIndex} (${timeoutMs}ms).`, true, {
      documentId,
      pageIndex,
      timeoutMs,
    });
  }
}
