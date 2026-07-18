/**
 * `viewer.store.ts` — estado del visor (página actual, zoom, previews) (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.5.
 *
 * Placeholder de Hito 10 PR1 (scaffold): store puramente local, sin conexión
 * al bus todavía (eso es `bus-bridge.ts`, PR5 `core-adapter`). El rango de
 * zoom (0.5..3) está documentado como comentario junto al campo en el spec;
 * `setZoom` lo clampea porque es el único punto de escritura del store.
 */

import { create } from "zustand";

export interface PagePreview {
  readonly original?: string;
  readonly anonymized?: string;
}

export interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface ViewerSlice {
  readonly currentPageIndex: number;
  readonly zoom: number; // 0.5..3
  readonly sideBySide: boolean; // default true
  readonly previewByPage: ReadonlyMap<number, PagePreview>;
  readonly visibleRange: VisibleRange;
  setPage(index: number): void;
  setZoom(z: number): void;
  setPreview(pageIndex: number, kind: "original" | "anonymized", blobUrl: string): void;
  setVisibleRange(start: number, end: number): void;
  reset(): void;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

type ViewerData = Pick<
  ViewerSlice,
  "currentPageIndex" | "zoom" | "sideBySide" | "previewByPage" | "visibleRange"
>;

const initialState: ViewerData = {
  currentPageIndex: 0,
  zoom: 1,
  sideBySide: true,
  previewByPage: new Map(),
  visibleRange: { start: 0, end: 0 },
};

export const useViewerStore = create<ViewerSlice>((set) => ({
  ...initialState,
  setPage(index) {
    set({ currentPageIndex: index });
  },
  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },
  setPreview(pageIndex, kind, blobUrl) {
    set((state) => {
      const next = new Map(state.previewByPage);
      const entry = next.get(pageIndex) ?? {};
      next.set(pageIndex, { ...entry, [kind]: blobUrl });
      return { previewByPage: next };
    });
  },
  setVisibleRange(start, end) {
    set({ visibleRange: { start, end } });
  },
  reset() {
    set(initialState);
  },
}));
