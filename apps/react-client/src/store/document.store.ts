/**
 * `document.store.ts` — estado del documento activo (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.1.
 *
 * Placeholder de Hito 10 PR1 (scaffold): el store es puramente local y
 * arranca en su estado inicial (sin documento). La mutación real por eventos
 * del bus (`bus-bridge.ts`) llega en PR5 (`core-adapter`) — este PR no la
 * implementa (ver docs/roadmap/MVP.md, Hito 10, orden de PRs).
 */

import type { DocumentSourceKind } from "@anonly/anonymization-core";
import { create } from "zustand";

export interface DocumentSlice {
  readonly id: string | null;
  readonly name: string | null;
  readonly pageCount: number;
  readonly sourceKind: DocumentSourceKind | null;
  setPage(id: string, name: string, pageCount: number, sourceKind: DocumentSourceKind): void;
  reset(): void;
}

type DocumentData = Pick<DocumentSlice, "id" | "name" | "pageCount" | "sourceKind">;

const initialState: DocumentData = {
  id: null,
  name: null,
  pageCount: 0,
  sourceKind: null,
};

export const useDocumentStore = create<DocumentSlice>((set) => ({
  ...initialState,
  setPage(id, name, pageCount, sourceKind) {
    set({ id, name, pageCount, sourceKind });
  },
  reset() {
    set(initialState);
  },
}));
