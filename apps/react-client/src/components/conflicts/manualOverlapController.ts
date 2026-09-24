/**
 * `manualOverlapController.ts` — abre `ManualOverlapDialog` desde fuera de su
 * propio árbol de React (ADR-174 §4, `ui/Components.md` §6.3).
 *
 * Dos disparadores no son dueños del diálogo: las tres vías de agregado
 * manual (`addManualEntity.ts`, que no renderiza nada) y el "Resolver" del
 * toast de advertencia persistente (`ToastHost`, que tampoco). `ManualOverlapDialogHost`
 * (montado una sola vez, junto a `ToastHost`) es el único consumidor.
 *
 * Mismo patrón que `toast.ts` y `scrollSyncController` (ADR-054 §3): un
 * módulo imperativo con suscripción, fuera de Zustand porque "qué conflicto
 * está abierto ahora mismo" no es estado de la aplicación — es un evento
 * efímero con un solo consumidor.
 */

type Listener = (conflictId: string | null) => void;

const listeners = new Set<Listener>();

/** Abre (o reemplaza) el diálogo para este conflicto. */
export function openManualOverlapDialog(conflictId: string): void {
  for (const listener of listeners) listener(conflictId);
}

/** Lo cierra, si estuviera abierto. */
export function closeManualOverlapDialog(): void {
  for (const listener of listeners) listener(null);
}

export function subscribeToManualOverlapDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
