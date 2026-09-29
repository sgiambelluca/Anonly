/**
 * `unreadableInk.store.ts` — qué páginas tienen contenido que el OCR no pudo
 * leer, pese a tener tinta (ADR-190 §2/§4).
 *
 * El veredicto llega **por página** en `OCR_PAGE_FINISHED.unreadableInk`
 * (`Contracts.md`, `core/OCR_Engine.md` §2) y este store guarda exactamente
 * eso: qué páginas están marcadas ahora mismo. Mismo criterio que
 * `degraded.store.ts` (ADR-062), con dos reglas que se heredan igual:
 *
 * 1. **Se reemplaza el veredicto de la página, no se acumula.** Un
 *    `reanalyze` de OCR vuelve a emitir `OCR_PAGE_FINISHED` para las páginas
 *    que reprocesa; la marca de una página que ahora sí se leyó tiene que
 *    poder apagarse.
 * 2. **Ausente ≡ `false`.** `unreadableInk` es `true` o no viene — nunca "no
 *    sé" — así que la ausencia siempre se traduce a "sacar la marca", nunca a
 *    "no tocar nada".
 *
 * `reset()` la limpia por completo — la llama `actions.closeDocument()`
 * (`core-adapter/actions.ts`), mismo punto que resetea `degraded.store`: la
 * marca es del documento abierto, no sobrevive a cerrarlo.
 */

import { create } from "zustand";

export interface UnreadableInkSlice {
  /** Páginas con `unreadableInk: true` en su último `OCR_PAGE_FINISHED`. */
  readonly pages: ReadonlySet<number>;
  /** Reemplaza el veredicto de una página (regla 1). */
  setPageVerdict(pageIndex: number, unreadableInk: boolean): void;
  reset(): void;
}

export const useUnreadableInkStore = create<UnreadableInkSlice>((set) => ({
  pages: new Set(),

  setPageVerdict(pageIndex, unreadableInk) {
    set((state) => {
      const has = state.pages.has(pageIndex);
      // Sin cambio real ⇒ misma referencia, mismo criterio que
      // `degraded.store.setPageVerdict`: evita re-renderizar todo lo que
      // observa `pages` en cada `OCR_PAGE_FINISHED` (uno por página).
      if (has === unreadableInk) return state;

      const next = new Set(state.pages);
      if (unreadableInk) next.add(pageIndex);
      else next.delete(pageIndex);
      return { pages: next };
    });
  },

  reset() {
    set({ pages: new Set() });
  },
}));

/** Selector: ¿esta página tiene contenido que el OCR no pudo leer, ahora mismo? */
export function selectPageHasUnreadableInk(state: UnreadableInkSlice, pageIndex: number): boolean {
  return state.pages.has(pageIndex);
}
