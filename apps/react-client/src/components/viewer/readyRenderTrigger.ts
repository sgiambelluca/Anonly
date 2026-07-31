/**
 * `readyRenderTrigger.ts` — decide si `PdfViewer` debe re-pedir el render de
 * las páginas montadas al observar que el pipeline llegó a `Ready` por
 * primera vez para el documento activo.
 *
 * Fix de un visor en blanco hasta que el usuario scrollea: el primer
 * `RENDER_REQUESTED` que `PdfViewer` emite (al conocer `pageCount` vía
 * `DOCUMENT_PARSED`, mucho antes de `Ready`) casi siempre llega antes de que
 * `RenderEngine.loadDocument` resuelva (round-trip async al pool/worker) —
 * `handleRenderRequested` lo descarta con un `warn` silencioso, sin cola ni
 * reintento (comportamiento documentado de `Render_Engine.md` §8, no un bug
 * de ese motor). Como nada vuelve a pedir un render hasta que cambia el rango
 * visible, el usuario tenía que scrollear para que un *segundo*
 * `RENDER_REQUESTED` llegara — y para entonces el documento ya estaba
 * cargado (`Orchestrator.md` v1.4.1 garantiza `loadDocument` resuelto antes
 * de `PIPELINE_READY`, tanto con OCR como sin él).
 *
 * Lógica separada de React/DOM a propósito, mismo criterio que
 * `visibleRange.ts`/`zoomRenderScheduler.ts`: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom).
 */

import { PipelineStage } from "@anonly/anonymization-core";

export interface ReadyRenderTriggerParams {
  readonly documentId: string | null;
  readonly stage: PipelineStage;
  readonly mountedPageIndicesCount: number;
  /** `documentId` para el que ya se disparó el re-pedido, o `null` si nunca. */
  readonly triggeredForDocumentId: string | null;
}

/**
 * `true` si corresponde disparar `actions.requestRender` de las páginas
 * montadas: hay un documento activo, su `stage` es `Ready`, el rango montado
 * ya no está vacío, y todavía no se disparó para ESE `documentId` (una sola
 * vez por documento — un `reanalyze` que vuelve a `Ready` sobre el mismo
 * documento, ADR-038 §5, no debe volver a disparar: el visor ya tiene su
 * primer render y las ediciones posteriores llegan por el camino normal de
 * `RENDER_REQUESTED`/mediación de grupos, ADR-044).
 */
export function shouldTriggerReadyRender(params: ReadyRenderTriggerParams): boolean {
  const { documentId, stage, mountedPageIndicesCount, triggeredForDocumentId } = params;
  if (documentId === null) return false;
  if (stage !== PipelineStage.Ready) return false;
  if (mountedPageIndicesCount === 0) return false;
  if (triggeredForDocumentId === documentId) return false;
  return true;
}
