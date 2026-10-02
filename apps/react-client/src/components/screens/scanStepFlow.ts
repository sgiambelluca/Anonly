/**
 * `scanStepFlow.ts` — el flujo de cuatro pasos de la pantalla de escaneo
 * (ADR-168 §5, `UX_Guidelines.md` §7.3, `Components.md` §2.10).
 *
 * Es el mapa que le faltaba al usuario: en las pruebas de usuario, "Leyendo…
 * página 3 de 12" seguido de "Escaneando… página 1 de 12" se leía como que el
 * análisis había vuelto a empezar. Con los pasos a la vista, leer y escanear
 * son dos trabajos distintos.
 *
 * **Los cuatro pasos están siempre**, aunque no haya OCR: si el pipeline llega
 * a `Detecting` sin haber pasado por `OCRing`, el paso "Leer" se muestra
 * terminado con *"El PDF ya tenía texto"*. Una UI que agrega o quita pasos
 * según el documento cambia de forma mientras el usuario la mira (UX-10), y
 * ADR-168 §5 descarta explícitamente mostrar tres.
 *
 * Se deriva **solo** de `PipelineStage` (el vigente y los atravesados,
 * `pipeline.store.visitedStages`). No cambia los rótulos ni los contadores de
 * ADR-152, que siguen en la caja de progreso: esto es un mapa encima.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { PipelineStage } from "@anonly/anonymization-core";

export type ScanStepId = "open" | "read" | "scan" | "group";
export type ScanStepStatus = "pending" | "active" | "done";

export interface ScanStep {
  readonly id: ScanStepId;
  readonly status: ScanStepStatus;
  /** Rótulo según el estado: gerundio pendiente/en curso, participio terminado. */
  readonly label: string;
  /** Qué hace el paso (o, para "Leer" salteado, por qué no hizo falta). */
  readonly description: string;
}

interface StepDefinition {
  readonly id: ScanStepId;
  readonly ongoing: string;
  readonly done: string;
  readonly description: string;
}

const STEPS: ReadonlyArray<StepDefinition> = [
  { id: "open", ongoing: "Abriendo", done: "Abierto", description: "Carga el archivo" },
  { id: "read", ongoing: "Leyendo", done: "Leído", description: "Saca el texto de cada página" },
  { id: "scan", ongoing: "Escaneando", done: "Escaneado", description: "Busca datos sensibles" },
  { id: "group", ongoing: "Ordenando", done: "Ordenado", description: "Agrupa lo encontrado" },
];

/** Aclaración del paso "Leer" cuando no hubo OCR (ADR-168 §5). */
export const READ_SKIPPED_DESCRIPTION = "El PDF ya tenía texto";

/** Índice del paso en curso por etapa. `4` = todos terminados. */
const STEP_INDEX_BY_STAGE: Readonly<Partial<Record<PipelineStage, number>>> = {
  [PipelineStage.Idle]: 0,
  [PipelineStage.Importing]: 0,
  [PipelineStage.Extracting]: 0,
  [PipelineStage.OCRing]: 1,
  [PipelineStage.Detecting]: 2,
  [PipelineStage.Grouping]: 3,
  [PipelineStage.Ready]: 4,
  [PipelineStage.Rendering]: 4,
  [PipelineStage.Exporting]: 4,
  [PipelineStage.Done]: 4,
};

/**
 * `Failed`/`Cancelled` no tienen paso propio: se muestra en curso el más
 * avanzado por el que se llegó a pasar. La pantalla de escaneo sale de
 * inmediato en esos casos (ADR-150), así que es solo el último cuadro.
 */
function currentStepIndex(stage: PipelineStage, visited: ReadonlySet<PipelineStage>): number {
  const direct = STEP_INDEX_BY_STAGE[stage];
  if (direct !== undefined) return direct;
  let highest = 0;
  for (const visitedStage of visited) {
    const index = STEP_INDEX_BY_STAGE[visitedStage];
    if (index !== undefined && index < 4 && index > highest) highest = index;
  }
  return highest;
}

export function resolveScanSteps(
  stage: PipelineStage,
  visitedStages: ReadonlySet<PipelineStage>,
): ReadonlyArray<ScanStep> {
  const active = currentStepIndex(stage, visitedStages);
  const readSkipped = active > 1 && !visitedStages.has(PipelineStage.OCRing);

  return STEPS.map((step, index): ScanStep => {
    const status: ScanStepStatus =
      index < active ? "done" : index === active ? "active" : "pending";
    const description =
      step.id === "read" && readSkipped ? READ_SKIPPED_DESCRIPTION : step.description;
    return {
      id: step.id,
      status,
      label: status === "done" ? step.done : step.ongoing,
      description,
    };
  });
}
