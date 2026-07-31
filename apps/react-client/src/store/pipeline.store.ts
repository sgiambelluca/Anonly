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

export interface PipelineSlice {
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly current: number;
  readonly total: number;
  readonly groupCount: number;
  readonly conflictCount: number;
  readonly modelLoading: { modelId: string; progress: number } | null;
  readonly exportProgress: { current: number; total: number } | null;
  readonly exportResult: { blobUrl: string; sizeBytes: number } | null;
  readonly error: SerializedEngineError | null;
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
  exportProgress: null,
  exportResult: null,
  error: null,
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
