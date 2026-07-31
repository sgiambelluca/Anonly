/**
 * `pipelineStageLabel.ts` — texto descriptivo de `PipelineStatus` por stage
 * (`ui/UX_Guidelines.md` §7.1, `ui/Components.md` §2.3).
 *
 * Prioridad de sub-estados sobre el texto por stage (Components.md §2.3):
 * `modelLoading` primero, `exportProgress` después, y recién en "otros casos"
 * el texto descriptivo por `stage`.
 */

import { PipelineStage } from "@anonly/anonymization-core";

export interface PipelineProgressSnapshot {
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly current: number;
  readonly total: number;
  readonly modelLoading: { readonly modelId: string; readonly progress: number } | null;
  readonly exportProgress: { readonly current: number; readonly total: number } | null;
}

export function getPipelineStageLabel(snapshot: PipelineProgressSnapshot): string {
  const { stage, current, total, progress, modelLoading, exportProgress } = snapshot;

  if (modelLoading !== null) {
    return `Cargando modelo NER… ${Math.round(modelLoading.progress * 100)}%`;
  }
  if (exportProgress !== null) {
    return `Exportando página ${exportProgress.current} de ${exportProgress.total}…`;
  }

  switch (stage) {
    case PipelineStage.Idle:
      return "";
    case PipelineStage.Importing:
      return "Importando documento…";
    case PipelineStage.Extracting:
      return total > 0 ? `Extrayendo página ${current} de ${total}…` : "Extrayendo documento…";
    case PipelineStage.OCRing:
      return total > 0
        ? `OCR página ${current} de ${total}… ${Math.round(progress * 100)}%`
        : "Reconociendo texto (OCR)…";
    case PipelineStage.Detecting:
      return total > 0 ? `Analizando página ${current} de ${total}…` : "Detectando entidades…";
    case PipelineStage.Grouping:
      return "Agrupando entidades…";
    case PipelineStage.Ready:
      return "Listo";
    case PipelineStage.Rendering:
      return "Renderizando vista previa…";
    case PipelineStage.Exporting:
      return "Exportando…";
    case PipelineStage.Done:
      return "Exportado";
    case PipelineStage.Cancelled:
      return "Cancelado";
    case PipelineStage.Failed:
      return "Error";
    default:
      return "";
  }
}
