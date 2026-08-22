/**
 * `undoableEdits.ts` — deshacer para las ediciones del árbol que antes no lo
 * tenían (ADR-087, "Fuera del alcance" §6).
 *
 * §3.3 le dio "Deshacer" a los dos barridos de modo y al único caso de fila
 * que destruye texto escrito a mano, por el mismo criterio que se aplica acá:
 * **una acción de un click que cambia muchas filas, o que pisa algo que el
 * usuario escribió, necesita una salida de un click**. Lo que quedó afuera
 * entonces —habilitar/deshabilitar, reclasificar, editar el valor de
 * reemplazo— cumple ese criterio igual: la cascada de un tipo apaga decenas de
 * grupos de una, y `Space` sobre una cabecera hace lo mismo sin siquiera un
 * diálogo de por medio.
 *
 * **Qué NO está acá, y por qué.** Fusionar, dividir y agregar una entidad a
 * mano siguen sin deshacer, y no es una omisión de este módulo:
 *
 * - Deshacer un **agregado manual** necesita borrar el grupo, y no existe
 *   pedido de borrado en `Contracts.md` — `ENTITY_GROUP_REMOVED` lo emite el
 *   Grouping Engine por su cuenta (fusión, `dropOccurrences`), no a pedido de
 *   la UI. Agregarlo es cambio de contrato: ADR primero (R-19).
 * - Deshacer una **fusión** sería dividir de vuelta, y deshacer una **división**
 *   sería fusionar de vuelta, pero ninguna de las dos restituye el estado
 *   anterior: el grupo que reaparece es uno nuevo, con otro `id` y otro
 *   `indexInType` (`Grouping_Engine.md` §13 caso 5 — la fusión conserva el
 *   menor índice y el resultante renumera). El usuario recuperaría las
 *   ocurrencias separadas pero con otro número de token. Un "Deshacer" que
 *   devuelve algo parecido y no lo mismo miente, y eso es peor que no
 *   ofrecerlo.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

export interface EnabledSnapshot {
  readonly groupId: string;
  /** El valor que tenía ANTES del cambio — es lo que restituye el undo. */
  readonly enabled: boolean;
}

interface ToggleCandidate {
  readonly id: string;
  readonly enabled: boolean;
}

/**
 * Los grupos que de verdad cambian de estado. Los que ya estaban en `next` se
 * excluyen: incluirlos inflaría el contador del toast ("12 grupos" cuando el
 * usuario cambió 3) y haría que el undo emitiera escrituras que no deshacen
 * nada.
 */
export function groupsToToggle(
  groups: ReadonlyArray<ToggleCandidate>,
  next: boolean,
): ReadonlyArray<EnabledSnapshot> {
  return groups
    .filter((group) => group.enabled !== next)
    .map((group) => ({ groupId: group.id, enabled: group.enabled }));
}

/**
 * Texto del toast. Dice qué pasa con el documento, no qué campo se tocó:
 * "habilitado"/"deshabilitado" es vocabulario de la estructura de datos, y lo
 * que el usuario decidió es si ese dato se reemplaza o se deja como está.
 */
export function enabledToastText(params: {
  readonly count: number;
  /** Nombre del grupo o del tipo. */
  readonly label: string;
  /** `true` si el cambio fue sobre una cabecera de tipo (afecta a varios). */
  readonly isType: boolean;
  readonly next: boolean;
}): string {
  const { count, label, isType, next } = params;
  const verb = next ? "se anonimiza" : "no se anonimiza";
  const verbPlural = next ? "se anonimizan" : "no se anonimizan";
  if (!isType) return `«${label}» ${verb}`;
  return `${label}: ${count} ${count === 1 ? "grupo" : "grupos"} ${count === 1 ? verb : verbPlural}`;
}
