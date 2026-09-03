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

/*
 * ─── Fusión de varios grupos a la vez ──────────────────────────────────────
 *
 * `UX_Guidelines.md` §3.2 pide "2+ grupos del mismo tipo" desde siempre; el
 * diálogo resolvía uno solo, así que juntar cuatro grupos de una persona mal
 * separada eran tres pasadas por el mismo modal.
 *
 * El Core no cambia: `GroupMergeRequested` sigue siendo 1→1
 * (`Contracts.md` §886) y la UI emite N-1 requests. Es seguro porque
 * `applyGroupMerge` corre **síncrono** —no hay `await` en su cuerpo, el
 * `Promise` que devuelve ya está resuelto cuando `bus.emit` retorna—, así que
 * los pasos no se interleavean, y porque el grupo que sobrevive es el
 * **target**, que conserva su `id` (`Grouping_Engine.md`, "Algoritmos clave" >
 * `indexInType`: "tras fusionar A en B: B conserva min(A.index, B.index); A se
 * elimina"). El primer destino elegido es el sobreviviente de todos los pasos,
 * y como cada paso se queda con el menor índice de los dos, el resultado
 * conserva el menor de todos — la promesa que el diálogo ya hacía.
 */

/** Un paso de fusión: exactamente un `GROUP_MERGE_REQUESTED`. */
export interface MergeStep {
  readonly sourceGroupId: string;
  readonly targetGroupId: string;
}

/**
 * Los pasos que hay que emitir para dejar `sourceGroupId` y `targetGroupIds`
 * en un solo grupo. El sobreviviente es `targetGroupIds[0]`: todo lo demás se
 * fusiona contra él, en el orden en que el usuario los eligió.
 */
export function mergePlan(
  sourceGroupId: string,
  targetGroupIds: ReadonlyArray<string>,
): ReadonlyArray<MergeStep> {
  const survivor = targetGroupIds[0];
  if (survivor === undefined) return [];
  // El dedup es defensivo: el diálogo ya no ofrece un grupo elegido en otra
  // fila, pero un paso repetido sería un `GROUP_NOT_FOUND` en la segunda
  // vuelta (el grupo ya no existe) y ensuciaría el log por nada.
  const seen = new Set<string>([survivor, sourceGroupId]);
  const steps: MergeStep[] = [{ sourceGroupId, targetGroupId: survivor }];
  for (const id of targetGroupIds.slice(1)) {
    if (seen.has(id)) continue;
    seen.add(id);
    steps.push({ sourceGroupId: id, targetGroupId: survivor });
  }
  return steps;
}

/**
 * Grupos que una fila de destino puede ofrecer: los del mismo tipo, menos el
 * origen y menos los que ya eligió **otra** fila (`exclude`). La propia
 * selección de la fila nunca se filtra, o el `Select` se quedaría sin su valor.
 */
export function availableTargetOptions(
  sourceGroup: EntityGroup,
  groupsOfSameType: ReadonlyArray<EntityGroup>,
  exclude: ReadonlyArray<string>,
  keep?: string,
): ReadonlyArray<EntityGroup> {
  const excluded = new Set(exclude);
  return mergeTargetOptions(sourceGroup, groupsOfSameType).filter(
    (group) => group.id === keep || !excluded.has(group.id),
  );
}

/** `validateMerge` para N destinos: vale si vale cada paso y no hay repetidos. */
export function validateMultiMerge(
  sourceGroup: EntityGroup | undefined,
  targetGroups: ReadonlyArray<EntityGroup | undefined>,
): MergeValidationResult {
  if (sourceGroup === undefined) {
    return { valid: false, reason: "Grupo de origen no encontrado." };
  }
  if (targetGroups.length === 0) {
    return { valid: false, reason: "Seleccioná un grupo destino." };
  }
  const seen = new Set<string>();
  for (const target of targetGroups) {
    const step = validateMerge(sourceGroup, target);
    if (!step.valid) return step;
    // `validateMerge` ya garantizó que no es undefined.
    const id = target?.id ?? "";
    if (seen.has(id)) {
      return { valid: false, reason: "Hay un grupo destino elegido dos veces." };
    }
    seen.add(id);
  }
  return { valid: true };
}
