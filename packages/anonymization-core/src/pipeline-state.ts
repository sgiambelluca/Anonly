/**
 * `PipelineState` por documento (Contracts.md §5/§10, spec del Orchestrator §2).
 * Inmutable hacia afuera: cada mutación produce una copia nueva (Code_Standards §6).
 */

import {
  InvalidInputError,
  PipelineStage,
  type PipelineError,
  type PipelineState,
} from "@anonly/shared";

export type PipelineStatePatch = Partial<
  Pick<PipelineState, "stage" | "progress" | "cancelRequested" | "errors">
>;

export class PipelineStateStore {
  private readonly states = new Map<string, PipelineState>();

  create(documentId: string): PipelineState {
    const now = Date.now();
    const state: PipelineState = {
      documentId,
      stage: PipelineStage.Idle,
      progress: 0,
      startedAt: now,
      updatedAt: now,
      errors: [],
      cancelRequested: false,
    };
    this.states.set(documentId, state);
    return state;
  }

  get(documentId: string): PipelineState | undefined {
    return this.states.get(documentId);
  }

  has(documentId: string): boolean {
    return this.states.has(documentId);
  }

  /** Lanza `InvalidInputError` si `documentId` no existe (contrato público de `getState`). */
  getOrThrow(documentId: string): PipelineState {
    const state = this.states.get(documentId);
    if (state === undefined) {
      throw new InvalidInputError(`No existe estado de pipeline para el documento ${documentId}.`, {
        documentId,
      });
    }
    return state;
  }

  update(documentId: string, patch: PipelineStatePatch): PipelineState {
    const current = this.getOrThrow(documentId);
    const next: PipelineState = { ...current, ...patch, updatedAt: Date.now() };
    this.states.set(documentId, next);
    return next;
  }

  addError(documentId: string, error: PipelineError): PipelineState {
    const current = this.getOrThrow(documentId);
    return this.update(documentId, { errors: [...current.errors, error] });
  }

  delete(documentId: string): void {
    this.states.delete(documentId);
  }

  clear(): void {
    this.states.clear();
  }
}
