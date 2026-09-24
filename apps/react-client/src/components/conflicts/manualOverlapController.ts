/**
 * `manualOverlapController.ts` — abre `ManualOverlapDialog` desde fuera de su
 * propio árbol de React (ADR-174 §4, ADR-175 §4, ADR-176 §1,
 * `ui/Components.md` §6.3).
 *
 * Cuatro disparadores no son dueños del diálogo: las tres vías de agregado
 * manual (`addManualEntity.ts`, que no renderiza nada), el ⚠ de una fila
 * (`ConflictBadge`), el "Resolver" del aviso persistente
 * (`ManualOverlapDialogHost`, que tampoco se lo debe a sí mismo) y el
 * "Resolver" del bloqueo de export (`ExportButton`, ADR-176 §1). Un único
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

import { useEntitiesStore } from "../../store/entities.store.js";

import { heldManualConflictIdsForGroup } from "./conflictResolution.js";
import { firstPendingManualOverlapGroupId } from "./manualOverlapWarning.js";

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

/**
 * "Resolver" del aviso persistente (ADR-175 §5) y "Resolver" del bloqueo de
 * export (ADR-176 §1) hacen exactamente lo mismo: abren el diálogo sobre la
 * primera fila, en el orden del árbol, que tenga un choque `heldManual`
 * pendiente. Se extrae acá una sola vez para que ninguno de los dos lo
 * reimplemente (`ui/Components.md` §2.5 "Bloqueo": "igual al aviso de
 * §6.3"). Sin nada pendiente, no hace nada — no debería llamarse en ese
 * caso, pero no rompe si pasa.
 */
export function openFirstPendingManualOverlap(): void {
  const { conflicts, groupsByType, sortOrder } = useEntitiesStore.getState();
  const groupId = firstPendingManualOverlapGroupId({ conflicts, groupsByType, sortOrder });
  if (groupId === null) return;
  const conflictIds = heldManualConflictIdsForGroup(conflicts, groupId);
  if (conflictIds.length === 0) return;
  openManualOverlapDialog(conflictIds);
}
