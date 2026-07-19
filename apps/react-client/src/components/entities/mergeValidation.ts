/**
 * `mergeValidation.ts` — validación pura para `MergeDialog`
 * (`ui/Components.md` §3.6: "autocomplete para elegir targetGroupId (filtrado
 * por mismo EntityType)"; `ui/UX_Guidelines.md` §3.2: "selecciona 2+ grupos
 * del mismo tipo").
 *
 * El Grouping Engine no emite ningún error de vuelta a la UI si el request es
 * inválido (`core/Grouping_Engine.md` §11 solo cubre `GROUPING_INVALID_PATCH`/
 * `GROUPING_GROUP_NOT_FOUND` para `applyGroupUpdate`; `applyGroupMerge` no
 * tiene errores documentados propios) — por eso esta validación de UI existe:
 * evita que el usuario dispare un `GROUP_MERGE_REQUESTED` sin efecto visible.
 */

import type { EntityGroup } from "@anonly/anonymization-core";

export interface MergeValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Grupos candidatos a fusión: mismo `type` que `sourceGroup`, excluyéndolo. */
export function mergeTargetOptions(
  sourceGroup: EntityGroup,
  groupsOfSameType: ReadonlyArray<EntityGroup>,
): ReadonlyArray<EntityGroup> {
  return groupsOfSameType.filter((group) => group.id !== sourceGroup.id);
}

export function validateMerge(
  sourceGroup: EntityGroup | undefined,
  targetGroup: EntityGroup | undefined,
): MergeValidationResult {
  if (sourceGroup === undefined) {
    return { valid: false, reason: "Grupo de origen no encontrado." };
  }
  if (targetGroup === undefined) {
    return { valid: false, reason: "Seleccioná un grupo destino." };
  }
  if (sourceGroup.id === targetGroup.id) {
    return { valid: false, reason: "El grupo destino debe ser distinto del origen." };
  }
  if (sourceGroup.type !== targetGroup.type) {
    return { valid: false, reason: "Solo se pueden fusionar grupos del mismo tipo." };
  }
  return { valid: true };
}
