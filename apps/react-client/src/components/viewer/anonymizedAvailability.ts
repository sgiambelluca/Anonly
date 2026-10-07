/**
 * `anonymizedAvailability.ts` — cuándo existe la vista Anonimizado.
 *
 * Antes de `Ready` los `replacements` no existen y el render sale idéntico al
 * original (`core/Render_Engine.md` §13 caso 1), así que `ViewerModeToggle`
 * deshabilita la pestaña y `zoomRenderKinds.ts` no pide ese lado. Un solo
 * predicado para los dos.
 */

import { PipelineStage } from "@anonly/anonymization-core";

/**
 * `Done` entra junto con `Ready`: tras exportar, el documento sigue abierto y
 * el preview sigue siendo válido (mismo criterio que `exportButtonVisibility`).
 */
export function isAnonymizedAvailable(stage: PipelineStage): boolean {
  return stage === PipelineStage.Ready || stage === PipelineStage.Done;
}
