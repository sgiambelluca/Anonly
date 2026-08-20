/**
 * `degraded.store.ts` — qué grupos tienen algún reemplazo ilegible, y en qué
 * páginas (ADR-062).
 *
 * El veredicto llega **por página** en `PREVIEW_UPDATED.degraded` y la UI lo
 * necesita **por grupo** (el árbol de entidades marca grupos, no páginas), así
 * que este store hace exactamente esa conversión y nada más.
 *
 * Tres reglas de ADR-062 §2/§3, y las tres son fáciles de romper:
 *
 * 1. **Se reemplaza el veredicto de la página, no se acumula.** Cada
 *    `PREVIEW_UPDATED` trae el veredicto completo de ESA página en ESE render.
 *    Acumular dejaría encendida una marca que el usuario ya arregló.
 * 2. **Ausente ≡ vacío.** Las dos formas significan "esta página, ahora mismo,
 *    no tiene ningún reemplazo degradado". La ausencia nunca significa "no sé".
 * 3. **Los eventos con `kind: "original"` se descartan.** Ese panel se
 *    renderiza sin reemplazos, así que emite el array vacío por construcción y
 *    borraría el veredicto del panel anonimizado.
 *
 * Se guarda por página y no un `Set` plano de `groupId` porque el veredicto
 * llega por página: sin la clave de página no habría forma de reemplazar el de
 * una sola sin perder el de las demás (regla 1).
 */

import type { Annotation } from "@anonly/anonymization-core";
import { create } from "zustand";

export interface DegradedSlice {
  /** `pageIndex` → los `groupId` con algún reemplazo ilegible en esa página. */
  readonly byPage: ReadonlyMap<number, ReadonlySet<string>>;
  /** Reemplaza el veredicto de una página (regla 1). */
  setPageVerdict(pageIndex: number, annotations: ReadonlyArray<Annotation>): void;
  reset(): void;
}

export const useDegradedStore = create<DegradedSlice>((set) => ({
  byPage: new Map(),

  setPageVerdict(pageIndex, annotations) {
    set((state) => {
      const groupIds = new Set(annotations.map((annotation) => annotation.groupId));
      const previous = state.byPage.get(pageIndex);

      // Sin cambios reales ⇒ misma referencia, para no re-renderizar el árbol
      // entero en cada `PREVIEW_UPDATED` (llega uno por página por scroll y
      // por cambio de zoom).
      if (previous !== undefined && previous.size === groupIds.size) {
        let identical = true;
        for (const id of groupIds) {
          if (!previous.has(id)) {
            identical = false;
            break;
          }
        }
        if (identical) return state;
      }
      if (previous === undefined && groupIds.size === 0) return state;

      const next = new Map(state.byPage);
      if (groupIds.size === 0) next.delete(pageIndex);
      else next.set(pageIndex, groupIds);
      return { byPage: next };
    });
  },

  reset() {
    set({ byPage: new Map() });
  },
}));

/**
 * Selector: ¿este grupo tiene algún reemplazo ilegible, en cualquier página?
 *
 * Devuelve un `boolean` (no un objeto ni un array) a propósito: un selector
 * que construye su valor devuelve una referencia nueva por llamada, y zustand
 * compara el snapshot con `Object.is` — eso deja la UI en un loop de render.
 */
export function selectGroupIsDegraded(state: DegradedSlice, groupId: string): boolean {
  for (const groupIds of state.byPage.values()) {
    if (groupIds.has(groupId)) return true;
  }
  return false;
}

/** Las páginas donde este grupo quedó ilegible, en orden — para poder nombrarlas. */
export function selectDegradedPages(state: DegradedSlice, groupId: string): ReadonlyArray<number> {
  const pages: number[] = [];
  for (const [pageIndex, groupIds] of state.byPage) {
    if (groupIds.has(groupId)) pages.push(pageIndex);
  }
  return pages.sort((a, b) => a - b);
}
