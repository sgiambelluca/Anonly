/**
 * `exportButtonVisibility.ts` — visibilidad de `ExportButton` vs. vida de su
 * `ExportDialog` hijo (`ui/Components.md` §2.5, §13.9; bug #7 del Escenario 1
 * E2E, 2026-07-22).
 *
 * El gate de `stage` aplica SOLO al botón/atajo, nunca al diálogo: mientras
 * `ExportDialog` esté abierto, el componente sigue montado aunque `stage`
 * salga de `{Ready, Done}` (p. ej. `Exporting`, durante el export que el
 * propio diálogo disparó) — desmontar destruye el progreso/resultado en
 * vuelo del diálogo antes de poder pintar "Descargar"/"Exportar otro".
 */

import { PipelineStage } from "@anonly/anonymization-core";

/** `Done` es el equivalente operativo de `Ready` para reabrir el diálogo con el resultado (ADR-040). */
export function isExportTriggerVisible(stage: PipelineStage): boolean {
  return stage === PipelineStage.Ready || stage === PipelineStage.Done;
}

/** `false` solo cuando ni el botón debería mostrarse ni hay un diálogo abierto que preservar. */
export function shouldMountExportButton(stage: PipelineStage, dialogOpen: boolean): boolean {
  return isExportTriggerVisible(stage) || dialogOpen;
}
