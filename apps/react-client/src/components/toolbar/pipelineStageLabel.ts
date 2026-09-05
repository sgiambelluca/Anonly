/**
 * `pipelineStageLabel.ts` — texto descriptivo de `PipelineStatus` por stage
 * (`ui/UX_Guidelines.md` §7.1, `ui/Components.md` §2.3).
 *
 * **Los textos no nombran las etapas del pipeline** (ADR-087 §4): "NER" y
 * "OCR" son cómo está construida la herramienta, no qué está haciendo. Un
 * perito no tiene por qué saber qué es NER para entender que se están buscando
 * nombres. Mismo registro que `ScanScreen`, que muestra estos mismos momentos
 * durante el escaneo inicial.
 *
 * Prioridad de sub-estados sobre el texto por stage (Components.md §2.3):
 * `modelLoading` primero, `exportProgress` después, y recién en "otros casos"
 * el texto descriptivo por `stage`.
 */

import { PipelineStage } from "@anonly/anonymization-core";

export interface PipelineProgressSnapshot {
  readonly stage: PipelineStage;
  /**
   * Fracción 0..1 de la etapa vigente. **Ya no entra en ningún texto**: los
   * porcentajes se retiraron de las etiquetas junto con la jerga (ADR-087 §4)
   * — "Reconociendo texto: página 5 de 10" dice lo mismo que un 65 % y se lee
   * sin traducir. Se conserva en el snapshot porque `PipelineStatus` lo usa
   * para la barra.
   */
  readonly progress: number;
  readonly current: number;
  readonly total: number;
  readonly modelLoading: { readonly modelId: string; readonly progress: number } | null;
  readonly exportProgress: { readonly current: number; readonly total: number } | null;
}

export function getPipelineStageLabel(snapshot: PipelineProgressSnapshot): string {
  const { stage, current, total, modelLoading, exportProgress } = snapshot;

  if (modelLoading !== null) {
    // Sin nombrar "NER" (ADR-087 §4/§7.1): es una etapa del pipeline, no
    // vocabulario del usuario. Mismo registro que `ScanScreen`.
    // Sin porcentaje: el valor llega siempre en 1 (ver `scanProgress.ts`), así
    // que mostrarlo era escribir "100%" al lado de algo que todavía no
    // terminaba.
    return "Preparando el detector de nombres…";
  }
  if (exportProgress !== null) {
    return `Exportando página ${exportProgress.current} de ${exportProgress.total}…`;
  }

  switch (stage) {
    case PipelineStage.Idle:
      return "";
    case PipelineStage.Importing:
      return "Abriendo el documento…";
    case PipelineStage.Extracting:
      return total > 0 ? `Leyendo el texto: página ${current} de ${total}…` : "Leyendo el texto…";
    case PipelineStage.OCRing:
      return total > 0
        ? `Reconociendo texto: página ${current} de ${total}…`
        : "Reconociendo texto de las imágenes…";
    case PipelineStage.Detecting:
      return total > 0
        ? `Buscando datos sensibles: página ${current} de ${total}…`
        : "Buscando datos sensibles…";
    case PipelineStage.Grouping:
      return "Agrupando lo encontrado…";
    case PipelineStage.Ready:
      return "Listo";
    case PipelineStage.Rendering:
      return "Preparando la vista previa…";
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
