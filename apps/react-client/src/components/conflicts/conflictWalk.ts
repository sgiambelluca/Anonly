/**
 * El recorrido de "Resolver": los conflictos pendientes del documento, uno
 * detrás del otro en el mismo `ConflictDialog`, con un contador "5/9" junto
 * al título. Evita volver al globo de Exportar y tocar "Resolver" una vez
 * por conflicto.
 *
 * La cola se arma **una vez**, al tocar "Resolver"
 * (`exportBlockReason.pendingConflictIdsInTreeOrder`), y no se recalcula: el
 * total del contador no cambia mientras el usuario avanza. Lo que sí se mira
 * al avanzar es si cada conflicto que sigue todavía está pendiente — resolver
 * uno puede cerrar otros (dos conflictos de la misma fila, un deshacer) — y
 * los que ya no lo están se saltean.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type { Conflict } from "@anonly/anonymization-core";

export interface ConflictWalk {
  /** Los conflictos pendientes al empezar, en el orden del árbol. */
  readonly ids: ReadonlyArray<string>;
  /** Cuál se está mostrando. Siempre un índice válido de `ids`. */
  readonly index: number;
}

/** `null` si no hay nada que recorrer. */
export function startConflictWalk(ids: ReadonlyArray<string>): ConflictWalk | null {
  return ids.length === 0 ? null : { ids, index: 0 };
}

export function currentConflictId(walk: ConflictWalk): string {
  // `index` es válido por construcción; el `??` es para el tipo.
  return walk.ids[walk.index] ?? "";
}

/**
 * El paso siguiente después de aplicar el conflicto actual: el próximo de la
 * cola que siga pendiente, o `null` si no queda ninguno (el recorrido
 * terminó). Nunca vuelve atrás.
 */
export function advanceConflictWalk(
  walk: ConflictWalk,
  conflicts: ReadonlyArray<Conflict>,
): ConflictWalk | null {
  const pending = new Set<string>();
  for (const conflict of conflicts) {
    if (!conflict.resolved && conflict.heldManual !== true) pending.add(conflict.id);
  }
  for (let index = walk.index + 1; index < walk.ids.length; index += 1) {
    const id = walk.ids[index];
    if (id !== undefined && pending.has(id)) return { ids: walk.ids, index };
  }
  return null;
}

/** "5/9": la posición en la cola sobre el total que había al empezar. */
export function conflictWalkProgress(walk: ConflictWalk): string {
  return `${walk.index + 1}/${walk.ids.length}`;
}
