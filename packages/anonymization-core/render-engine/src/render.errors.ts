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

/**
 * Discrimina un `EngineError` de este motor por `code`, no por
 * `instanceof <SubclaseConcreta>`.
 *
 * **Por qué existe** (ADR-049 §3, `ai/Code_Standards.md` §7). Los renders
 * corren en un `RenderWorker`, y un error lanzado adentro vuelve al host por
 * `postMessage`, que no transporta prototipos: `EngineError.deserialize()`
 * reconstruye siempre un `DeserializedEngineError` genérico
 * (`Contracts.md` §4). El `instanceof RenderPageFailedError` del host daba
 * `false` para **todo** fallo de render real, con dos consecuencias medidas
 * (`Post_Hito10.8_Pendientes.md` §21): el reintento de §11 nunca corría, y el
 * batch se abortaba por la rama "no recuperable" sin emitir
 * `PREVIEW_PAGE_FAILED` — así que la UI no se enteraba de nada y el visor
 * quedaba gris para siempre (el `warn` del catch va a un logger nulo).
 *
 * Lo único que sobrevive al boundary — y por lo tanto lo único seguro para
 * discriminar — es `code`.
 */
export function isRenderErrorCode<C extends EngineErrorCode>(
  err: unknown,
  code: C,
): err is EngineError & { readonly code: C } {
  return err instanceof EngineError && err.code === code;
}

/**
 * `true` para los dos errores que §11 declara recuperables por página
 * (`RENDER_PAGE_FAILED`, `RENDER_TIMEOUT`), venga el error del host o
 * deserializado de un worker.
 */
export function isRetryablePageError(err: unknown): err is EngineError {
  return (
    isRenderErrorCode(err, EngineErrorCode.RENDER_PAGE_FAILED) ||
    isRenderErrorCode(err, EngineErrorCode.RENDER_TIMEOUT)
  );
}
