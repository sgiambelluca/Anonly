/**
 * `viewer.store.ts` — estado del visor (página actual, zoom, previews)
 * (Zustand).
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.5.
 *
 * ADR-087 §2: hay **un solo visor** con un toggle `Original | Anonimizado`,
 * así que `currentPageIndex` y `visibleRange` vuelven a ser escalares. El
 * reparto por `ViewerKind` que introdujo ADR-054 §1 existía porque los dos
 * paneles del lado a lado scrolleaban independiente; sin lado a lado no hay
 * dos rangos que llevar. Se retira con ellos toda la sincronización de scroll
 * (ADR-054 §3): `scrollSyncController.ts` y `settings.scrollSyncEnabled`.
 *
 * **`previewByPage` sigue siendo por `kind`**, y ahí no cambia nada: las dos
 * vistas tienen imágenes distintas para la misma página, y conmutar el toggle
 * tiene que poder pintar la que ya está cacheada sin esperar un render nuevo.
 *
 * `mode` es la posición del toggle, y es lo que determina el `kind` de
 * `RENDER_REQUESTED` (ADR-056 sigue vigente: se renderiza un solo lado, el que
 * se está mirando). `"anonymized"` es inalcanzable mientras el pipeline no
 * llegue a `Ready` — ese gate lo aplica `ViewerModeToggle`, no el store: acá
 * no vive el `stage`.
 */

import { create } from "zustand";

/** `"original" | "anonymized"` — qué muestra el visor (ADR-087 §2). */
export type ViewerKind = "original" | "anonymized";

export interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface ViewerSlice {
  readonly currentPageIndex: number;
  readonly visibleRange: VisibleRange;
  readonly zoom: number; // 0.5..3
  /** Posición del toggle Original/Anonimizado (ADR-087 §2). */
  readonly mode: ViewerKind;
  readonly previewByPage: Readonly<Record<ViewerKind, ReadonlyMap<number, string>>>;
  /**
   * ADR-084 §1: la consulta del `DocumentSearchBox`. Sube al store —en vez de
   * quedar en el `useState` del propio buscador— para que "Ver ocurrencias"
   * del panel de entidades pueda escribirla desde el otro extremo del árbol.
   *
   * El resto del estado del buscador (matches, `activeIndex`, el tipo del
   * "Agregar como…") sigue siendo local: es trabajo interno suyo.
   */
  readonly searchQuery: string;
  setPage(index: number): void;
  setSearchQuery(query: string): void;
  setZoom(z: number): void;
  setMode(mode: ViewerKind): void;
  setPreview(pageIndex: number, kind: ViewerKind, blobUrl: string): void;
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
  "currentPageIndex" | "zoom" | "mode" | "previewByPage" | "visibleRange" | "searchQuery"
>;

const initialState: ViewerData = {
  currentPageIndex: 0,
  zoom: 1,
  // `original` de arranque: es la única vista disponible hasta `Ready`
  // (UX-3b), así que cualquier otro default sería inalcanzable.
  mode: "original",
  previewByPage: { original: new Map(), anonymized: new Map() },
  searchQuery: "",
  visibleRange: { start: 0, end: 0 },
};

export const useViewerStore = create<ViewerSlice>((set) => ({
  ...initialState,
  setSearchQuery(query) {
    set({ searchQuery: query });
  },
  setPage(index) {
    set({ currentPageIndex: index });
  },
  setZoom(z) {
    set({ zoom: clampZoom(z) });
  },
  setMode(mode) {
    set({ mode });
  },
  setPreview(pageIndex, kind, blobUrl) {
    set((state) => {
      const next = new Map(state.previewByPage[kind]);
      next.set(pageIndex, blobUrl);
      return { previewByPage: { ...state.previewByPage, [kind]: next } };
    });
  },
  setVisibleRange(start, end) {
    set({ visibleRange: { start, end } });
  },
  reset() {
    set(initialState);
  },
}));
