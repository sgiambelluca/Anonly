/**
 * @anonly/export-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/Export_Engine.md §11.
 * Los 3 error codes (`EXPORT_FAILED`, `EXPORT_NO_ENABLED_GROUPS`, `EXPORT_TIMEOUT`)
 * ya existen en `EngineErrorCode` (Contracts.md §4 / shared/src/enums.ts;
 * verificados sin problemas por la auditoría ADR-032).
 *
 * `retryable`: `ExportFailedError` y `ExportTimeoutError` → `true` (spec §11:
 * "reintentar 1 vez"). `ExportNoEnabledGroupsError` → `false`.
 *
 * `ExportNoEnabledGroupsError` no la lanza `export()` (ADR-032 §3: con 0
 * grupos enabled, el motor loguea `ctx.logger.warn` y continúa). La clase es
 * el tipo de la validación **pre-export** del Orchestrator (Hito 9/10), donde
 * el usuario confirma si continuar. Se define acá porque el checklist §15.3
 * la exige y el error code ya está publicado en Contracts.md §11.
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * Error fatal durante el ensamblado (embedJpg/embedPng/addPage/drawImage) o
 * la serialización (`PDFDocument.save()`) del PDF final. Recuperable:
 * `export()` reintenta 1 vez la operación que falló; si persiste, se lanza
 * este error y se emite `EXPORT_FAILED` (spec §11, §12: "Export reintenta el
 * ensamblado solo si pdf-lib falla (raro)").
 */
export class ExportFailedError extends EngineError {
  readonly code = EngineErrorCode.EXPORT_FAILED;
  readonly engineId = EngineId.Export;

  constructor(documentId: string, reason: string, details?: Record<string, unknown>) {
    super(`Export fallido: ${reason}`, true, { documentId, reason, ...details });
  }
}

/**
 * Ningún grupo `enabled` en el input. No la lanza `export()` (ver nota de
 * cabecera). Es el tipo de la validación pre-export del Orchestrator.
 */
export class ExportNoEnabledGroupsError extends EngineError {
  readonly code = EngineErrorCode.EXPORT_NO_ENABLED_GROUPS;
  readonly engineId = EngineId.Export;

  constructor(documentId: string) {
    super("Ningún grupo habilitado para exportar.", false, { documentId });
  }
}

/**
 * Timeout al procesar una página (render full vía `renderPageProvider`).
 * Default 30s por página (spec §11: "timeout (default 30 s por página)"),
 * fuente única `ctx.config.workerPool.timeouts["export-page"]` (mismo patrón
 * que render-engine, ADR-021 §2). Recuperable: mismo tratamiento que
 * `ExportFailedError`.
 */
export class ExportTimeoutError extends EngineError {
  readonly code = EngineErrorCode.EXPORT_TIMEOUT;
  readonly engineId = EngineId.Export;

  constructor(documentId: string, pageIndex: number, timeoutMs: number) {
    super(`Timeout al exportar la página ${pageIndex} (${timeoutMs}ms).`, true, {
      documentId,
      pageIndex,
      timeoutMs,
    });
  }
}
