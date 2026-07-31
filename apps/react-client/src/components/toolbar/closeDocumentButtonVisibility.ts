/**
 * `closeDocumentButtonVisibility.ts` — visibilidad de `CloseDocumentButton` vs.
 * vida de su `ConfirmDialog` hijo (ADR-051 §1/§4, `ui/Components.md` §2.8,
 * §13 regla 9).
 *
 * El trigger (botón) requiere DOS condiciones simultáneas (ADR-051 §1,
 * `Components.md` §12: la fila del mapeo lee tanto `pipeline.stage` como
 * `document`): hay un documento activo (`document.store.id !== null`) y el
 * pipeline no está corriendo (`stage ∈ {Ready, Done, Failed, Cancelled}`).
 * Durante una corrida el control correcto es `CancelButton` (§2.4), no este —
 * cerrar a mitad de pipeline es "cancelar + liberar" (`Orchestrator.md` §13
 * caso 11), y dos botones para lo mismo solo multiplican caminos.
 *
 * Regla 9 de `Components.md` §13 (mismo patrón que `exportButtonVisibility.ts`,
 * bug #7 del Escenario 1 E2E): el gate de `stage`/`document` aplica SOLO al
 * botón, nunca al `ConfirmDialog`. Mientras el diálogo esté abierto, el
 * componente sigue montado aunque el trigger deje de cumplirse — un
 * `PIPELINE_STAGE_CHANGED` por debajo (el pipeline es asíncrono) no puede
 * desmontar una confirmación en vuelo.
 */

import { PipelineStage } from "@anonly/anonymization-core";

const VISIBLE_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Ready,
  PipelineStage.Done,
  PipelineStage.Failed,
  PipelineStage.Cancelled,
]);

/** ADR-051 §1: documento activo + pipeline detenido (no corriendo). */
export function isCloseDocumentTriggerVisible(
  stage: PipelineStage,
  hasActiveDocument: boolean,
): boolean {
  return hasActiveDocument && VISIBLE_STAGES.has(stage);
}

/** `false` solo cuando ni el botón debería mostrarse ni hay un diálogo abierto que preservar. */
export function shouldMountCloseDocumentButton(
  stage: PipelineStage,
  hasActiveDocument: boolean,
  dialogOpen: boolean,
): boolean {
  return isCloseDocumentTriggerVisible(stage, hasActiveDocument) || dialogOpen;
}
