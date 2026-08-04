/**
 * `viewer.store.ts` — estado del visor (página actual por panel, zoom,
 * previews) (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.5.
 *
 * ADR-054 §1: `currentPageIndex` y `visibleRange` dejan de ser globales y
 * pasan a existir **por panel** (`ViewerKind`). Los dos `PdfViewer` scrollean
 * independiente, así que cada uno tiene su propia página actual y su propio
 * rango visible — nada los sincroniza a través de este store. La
 * sincronización opcional de scroll (ADR-054 §3) vive fuera de Zustand, en
 * `components/viewer/scrollSyncController.ts`: acá solo llega
 * `currentPageIndex`, que cambia una vez por página, nunca el `scrollTop`
 * crudo (eso re-renderizaría los dos paneles en cada cuadro de scroll).
 *
 * `previewByPage` también es por panel, por el mismo motivo: un Map único
 * compartido entre los dos `kind` hace que cualquier `PREVIEW_UPDATED` de
 * un panel cambie la referencia que el otro panel también lee, y ese otro
 * `PdfViewer` (con paneles independientes desde ADR-054, cada uno scrollea
 * y pide renders por su cuenta) se re-renderiza entero sin necesidad —
 * `PageCanvas` está memoizado así que no repinta nada, pero la
 * reconciliación de todas sus páginas es trabajo real desperdiciado en
 * documentos largos. Un Map por `kind` hace que actualizar "original" no
 * toque la referencia de "anonymized".
 */

import { create } from "zustand";

/** `"original" | "anonymized"` — un panel del visor lado a lado (ADR-054 §1). */
export type ViewerKind = "original" | "anonymized";

export interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface ViewerSlice {
  readonly currentPageIndex: Readonly<Record<ViewerKind, number>>;
  readonly visibleRange: Readonly<Record<ViewerKind, VisibleRange>>;
  readonly zoom: number; // 0.5..3 — global: los dos paneles comparten escala
  readonly sideBySide: boolean; // default true — declarado, sin setter ni consumidor (ambigüedad abierta, ADR-054 §7: no reutilizado para el control de sincronización)
  readonly previewByPage: Readonly<Record<ViewerKind, ReadonlyMap<number, string>>>;
  setPage(kind: ViewerKind, index: number): void;
  setZoom(z: number): void;
  setPreview(pageIndex: number, kind: ViewerKind, blobUrl: string): void;
  setVisibleRange(kind: ViewerKind, start: number, end: number): void;
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
  currentPageIndex: { original: 0, anonymized: 0 },
  zoom: 1,
  sideBySide: true,
  previewByPage: { original: new Map(), anonymized: new Map() },
  visibleRange: {
    original: { start: 0, end: 0 },
    anonymized: { start: 0, end: 0 },
  },
};

export const useViewerStore = create<ViewerSlice>((set) => ({
  ...initialState,
  setPage(kind, index) {
    set((state) => ({ currentPageIndex: { ...state.currentPageIndex, [kind]: index } }));
  },
  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },
  setPreview(pageIndex, kind, blobUrl) {
    set((state) => {
      const next = new Map(state.previewByPage[kind]);
      next.set(pageIndex, blobUrl);
      return { previewByPage: { ...state.previewByPage, [kind]: next } };
    });
  },
  setVisibleRange(kind, start, end) {
    set((state) => ({ visibleRange: { ...state.visibleRange, [kind]: { start, end } } }));
  },
  reset() {
    set(initialState);
  },
}));
