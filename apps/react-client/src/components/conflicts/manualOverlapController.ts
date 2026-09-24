/**
 * `manualOverlapController.ts` — abre `ManualOverlapDialog` desde fuera de su
 * propio árbol de React (ADR-174 §4, ADR-175 §4, `ui/Components.md` §6.3).
 *
 * Tres disparadores no son dueños del diálogo: las tres vías de agregado
 * manual (`addManualEntity.ts`, que no renderiza nada), el ⚠ de una fila
 * (`ConflictBadge`) y el "Resolver" del aviso persistente
 * (`ManualOverlapDialogHost`, que tampoco se lo debe a sí mismo). Un único
 * `ManualOverlapDialogHost` (montado una vez, junto a `ToastHost`) es el
 * único que renderiza el diálogo — así "está abierto" tiene una sola fuente
 * de verdad, que el aviso persistente de ADR-175 §5 necesita para saber
 * cuándo callarse.
 *
 * Mismo patrón que `toast.ts` y `scrollSyncController` (ADR-054 §3): un
 * módulo imperativo con suscripción, fuera de Zustand porque "qué conflictos
 * están abiertos ahora mismo" no es estado de la aplicación — es un evento
 * efímero con un solo consumidor.
 */

/** `null` = cerrado. Abierto siempre trae al menos un id (ADR-175 §4: todos los de un choque). */
type Listener = (conflictIds: ReadonlyArray<string> | null) => void;

const listeners = new Set<Listener>();

/** Abre (o reemplaza) el diálogo para estos conflictos — todos los de un mismo agregado o fila. */
export function openManualOverlapDialog(conflictIds: ReadonlyArray<string>): void {
  for (const listener of listeners) listener(conflictIds);
}

/** Lo cierra, si estuviera abierto. */
export function closeManualOverlapDialog(): void {
  for (const listener of listeners) listener(null);
}

export function subscribeToManualOverlapDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
