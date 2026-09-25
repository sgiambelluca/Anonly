/**
 * `manualOverlapWarning.ts` — la regla de cuándo se muestra el aviso
 * persistente *"Quedó un choque sin resolver…"* (ADR-175 §5, `Components.md`
 * §6.3). Función pura y testeable, separada de `ManualOverlapDialogHost.tsx`
 * (ADR-056): la decisión de *si* corresponde mostrarlo no depende de nada del
 * DOM ni de Radix, solo de `entities.conflicts` y de si el diálogo está
 * cerrado.
 *
 * **Ya no es un toast de una vez** (a diferencia de ADR-174 §4): pasa a ser
 * un estado — se muestra **mientras** exista un conflicto `heldManual` sin
 * resolver y el diálogo esté cerrado, también si el choque nació en un
 * re-análisis. Sigue usando la única ranura de toast (UX-10): si otro toast
 * la ocupa, el aviso espera a que se vaya (`ManualOverlapDialogHost` decide
 * eso mirando el toast vigente, no este módulo).
 *
 * "Resolver" reabre el diálogo sobre **la primera fila, en el orden de la
 * lista** (`entityTree.visibleTypeEntries`, el mismo que ve el usuario en el
 * árbol), que tenga un choque pendiente — así el aviso también apunta a un
 * choque que nació en un re-análisis, no solo al que se acaba de agregar.
 */

import type { Conflict, EntityGroup, EntityType } from "@anonly/anonymization-core";

import type { EntitySortOrder } from "../../store/entities.store.js";
import { visibleTypeEntries } from "../entities/entityTree.js";

import { heldManualConflictIdsForGroup, manualOverlapCandidates } from "./conflictResolution.js";

/** Los conflictos `heldManual` sin resolver, en todo el documento. */
export function pendingManualOverlapConflicts(
  conflicts: ReadonlyArray<Conflict>,
): ReadonlyArray<Conflict> {
  return conflicts.filter((conflict) => conflict.heldManual === true && !conflict.resolved);
}

/**
 * ADR-175 §5: mientras haya al menos un choque `heldManual` sin resolver y el
 * diálogo esté cerrado. `dialogOpen` es una sola fuente de verdad (el
 * `conflictIds` de `manualOverlapController.ts` en `ManualOverlapDialogHost`):
 * el diálogo es uno solo en toda la app, se abra desde donde se abra.
 */
export function shouldShowManualOverlapWarning(params: {
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly dialogOpen: boolean;
}): boolean {
  if (params.dialogOpen) return false;
  return pendingManualOverlapConflicts(params.conflicts).length > 0;
}

/**
 * La fila (`groupId`) que "Resolver" tiene que abrir: la primera, en el
 * orden del árbol, que tenga un choque `heldManual` pendiente. `null` sin
 * ninguno pendiente.
 */
export function firstPendingManualOverlapGroupId(params: {
  readonly groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>;
  readonly sortOrder: EntitySortOrder;
  readonly conflicts: ReadonlyArray<Conflict>;
}): string | null {
  const pendingGroupIds = new Set(
    pendingManualOverlapConflicts(params.conflicts).map((conflict) => conflict.groupId),
  );
  if (pendingGroupIds.size === 0) return null;
  for (const [, groups] of visibleTypeEntries(params.groupsByType, params.sortOrder)) {
    for (const group of groups) {
      if (pendingGroupIds.has(group.id)) return group.id;
    }
  }
  return null;
}

/**
 * El valor a nombrar en *"Quedó un choque sin resolver en «X»."*: el de la
 * ocurrencia manual del primer choque pendiente de esa fila. `null` si la
 * fila no tiene uno (no debería llamarse sin antes confirmar con
 * `firstPendingManualOverlapGroupId`) o el conflicto no trae los dos
 * candidatos (`manualOverlapCandidates`).
 */
export function manualOverlapWarningValue(
  conflicts: ReadonlyArray<Conflict>,
  groupId: string,
): string | null {
  const conflict = conflicts.find(
    (candidate) =>
      candidate.groupId === groupId && candidate.heldManual === true && !candidate.resolved,
  );
  if (conflict === undefined) return null;
  return manualOverlapCandidates(conflict)?.manual.value ?? null;
}

/**
 * Todo junto: si corresponde mostrar el aviso, la fila que "Resolver" abre y
 * los conflictos que le pasa. `null` si no corresponde mostrarlo (nada
 * pendiente, o el diálogo ya está abierto).
 */
export interface ManualOverlapWarning {
  readonly value: string;
  readonly conflictIds: ReadonlyArray<string>;
}

export function resolveManualOverlapWarning(params: {
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>;
  readonly sortOrder: EntitySortOrder;
  readonly dialogOpen: boolean;
}): ManualOverlapWarning | null {
  if (!shouldShowManualOverlapWarning(params)) return null;
  const groupId = firstPendingManualOverlapGroupId(params);
  if (groupId === null) return null;
  const value = manualOverlapWarningValue(params.conflicts, groupId);
  if (value === null) return null;
  const conflictIds = heldManualConflictIdsForGroup(params.conflicts, groupId);
  if (conflictIds.length === 0) return null;
  return { value, conflictIds };
}
