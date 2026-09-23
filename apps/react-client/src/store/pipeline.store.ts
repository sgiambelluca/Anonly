/**
 * `pipeline.store.ts` — estado del pipeline (stage, progreso, errores) (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.4.
 *
 * Placeholder de Hito 10 PR1 (scaffold): store puramente local, arranca en
 * `PipelineStage.Idle` y permanece ahí — sin conexión al bus todavía (eso es
 * `bus-bridge.ts`, PR5 `core-adapter`).
 */

import { PipelineStage, type SerializedEngineError } from "@anonly/anonymization-core";
import { create } from "zustand";

import type { FailedJobs } from "../components/toolbar/incompleteAnalysisNotice.js";

export interface PipelineSlice {
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly current: number;
  readonly total: number;
  readonly groupCount: number;
  readonly conflictCount: number;
  readonly modelLoading: { modelId: string; progress: number } | null;
  /**
   * `pageIndex` del último `OCR_PAGE_FINISHED` (ADR-152 §3): la pantalla de
   * escaneo lo usa para mostrar "página X de Y" durante `OCRing`, numerado
   * sobre `document.store.pageCount` y no sobre el tamaño del trabajo de OCR
   * (`current`/`total` de esta misma store). `null` hasta que termine la
   * primera página.
   */
  readonly lastOcrPageIndex: number | null;
  readonly exportProgress: { current: number; total: number } | null;
  readonly exportResult: { blobUrl: string; sizeBytes: number } | null;
  readonly error: SerializedEngineError | null;
  /**
   * Jobs que fallaron sin tumbar el pipeline, por tipo. Un worker caído
   * rechaza su job pero el pipeline sigue y llega a `Ready`, así que sin esto
   * la UI no tiene forma de distinguir "terminó" de "terminó a medias" —ver
   * `components/toolbar/degradationNotice.ts` para el caso real que lo
   * motivó—. Vacío es el caso sano.
   */
  readonly failedJobs: FailedJobs;
  /**
   * ADR-168 §4: la última etapa observada antes de `Failed`, o `null` si el
   * pipeline no falló. `Importing`/`Extracting` = fallo de importación: la UI
   * cierra el documento y vuelve a `LoadScreen` con el error en la `DropZone`
   * (`components/screens/importFailure.ts`). La registra el bridge al recibir
   * `PIPELINE_FAILED`, con el `stage` que este store tenía en ese momento.
   */
  readonly failedAtStage: PipelineStage | null;
  /**
   * ADR-168 §5: las etapas que el pipeline atravesó en el documento vigente.
   * Alimenta `ScanSteps` (`scanStepFlow.ts`): sin esto no hay forma de saber si
   * el paso "Leer" se salteó porque el PDF ya tenía texto. Se vacía en cada
   * `DOCUMENT_IMPORTED`.
   */
  readonly visitedStages: ReadonlySet<PipelineStage>;
  setState(patch: Partial<PipelineSlice>): void;
  reset(): void;
}

type PipelineData = Omit<PipelineSlice, "setState" | "reset">;

const initialState: PipelineData = {
  stage: PipelineStage.Idle,
  progress: 0,
  current: 0,
  total: 0,
  groupCount: 0,
  conflictCount: 0,
  modelLoading: null,
  lastOcrPageIndex: null,
  exportProgress: null,
  exportResult: null,
  error: null,
  failedJobs: {},
  failedAtStage: null,
  visitedStages: new Set(),
};

export const usePipelineStore = create<PipelineSlice>((set) => ({
  ...initialState,
  setState(patch) {
    set(patch);
  },
  reset() {
    set(initialState);
  },
}));
