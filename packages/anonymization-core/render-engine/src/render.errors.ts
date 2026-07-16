/**
 * @anonly/render-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/Render_Engine.md §11.
 * `RENDER_PAGE_FAILED` y `RENDER_TIMEOUT` ya existían en `EngineErrorCode`
 * (Contracts.md §4 / shared/src/enums.ts). `RENDER_FAILED` (fatal de batch)
 * se agregó al mismo enum vía ADR-031 §1 — la omisión que bloqueaba la
 * compilación de este archivo queda resuelta.
 *
 * `retryable`: `RenderPageFailedError` y `RenderTimeoutError` → `true`
 * (spec §11: "reintentar 1 vez"). `RenderFailedError` → `false` (spec §11:
 * "no recuperable... abortar batch").
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * Error de renderizado de una página puntual (PDF.js lanza, OOM en canvas,
 * contexto 2D no disponible). Recuperable: `renderPages` reintenta 1 vez y,
 * si persiste, emite `PREVIEW_PAGE_FAILED` y continúa con las demás páginas
 * (spec §11, §13 caso 12).
 */
export class RenderPageFailedError extends EngineError {
  readonly code = EngineErrorCode.RENDER_PAGE_FAILED;
  readonly engineId = EngineId.Render;

  constructor(documentId: string, pageIndex: number, reason: string) {
    super(`Fallo al renderizar la página ${pageIndex}: ${reason}`, true, {
      documentId,
      pageIndex,
      reason,
    });
  }
}

/**
 * Timeout al renderizar una página (default 10s preview / 30s full, fuente
 * única `ctx.config.workerPool.timeouts["render-page"]`, ADR-021 §2).
 * Recuperable: mismo tratamiento que `RenderPageFailedError`.
 */
export class RenderTimeoutError extends EngineError {
  readonly code = EngineErrorCode.RENDER_TIMEOUT;
  readonly engineId = EngineId.Render;

  constructor(documentId: string, pageIndex: number, timeoutMs: number) {
    super(`Timeout al renderizar la página ${pageIndex} (${timeoutMs}ms).`, true, {
      documentId,
      pageIndex,
      timeoutMs,
    });
  }
}

/**
 * Error fatal de un batch completo (`renderPages`) o de `getDocument()` en
 * `loadDocument` (PDF ilegible para pdfjs; excepcional, la etapa 1 ya lo
 * validó — ADR-030 §2). No recuperable: aborta el batch / rechaza la carga.
 */
export class RenderFailedError extends EngineError {
  readonly code = EngineErrorCode.RENDER_FAILED;
  readonly engineId = EngineId.Render;

  constructor(documentId: string, reason: string) {
    super(`Render fallido: ${reason}`, false, { documentId, reason });
  }
}
