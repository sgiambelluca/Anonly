/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §6 errata; ADR-175
 * §3): decide qué hace el diálogo con el resultado de
 * `actions.addManualEntity`. Extraída como función pura porque
 * `apps/react-client` corre sus tests en Node sin jsdom (mismo criterio que
 * `mergeValidation.ts`/`personGenderVisibility.ts`).
 *
 * ADR-169 §7 suma el toast de confirmación de las tres vías de agregado:
 * *"Agregaste «X» · Persona N.º 06 · 2 apariciones ocultas"*. El N.º es el que
 * quedó **después** de la renumeración de `finishSession`, así que se lee del
 * grupo tal como está en el store cuando `addManualEntity` resolvió.
 *
 * **ADR-175 §3 reemplaza la lectura de ADR-174 §4/errata**: el Core dice
 * dónde cayó el agregado (`heldConflictIds`, `groupIds`) y la UI deja de
 * buscar el grupo por su cuenta — `findAddedGroup`/`foldForLookup` (que
 * comparaban texto a mano, U-3) se retiran. El orden es:
 *
 * 1. `heldConflictIds` no vacío → `"held"` (choque, ningún grupo se nombra).
 * 2. si no, `groupIds` no vacío → `"added"`.
 * 3. si no, `occurrenceCount === 0` → `"not-found"`.
 * 4. el resto rompe el invariante del Core (`occurrenceCount > 0` sin
 *    `heldConflictIds` ni `groupIds`) → `"error"`: nunca se dice "no se
 *    encontró" sobre algo que el Core sí encontró.
 */

import type { EntityGroup, EntityType, ManualEntityResult } from "@anonly/anonymization-core";

import { findGroupById } from "./entityTree.js";
import { describeEntityNumber, ENTITY_TYPE_SINGULAR } from "./entityTypeLabels.js";

export type ManualEntityFeedback = "added" | "not-found" | "no-op" | "held" | "error";

/** @param result `null` = sin documento activo (`"no-op"`, ADR-061 §6 errata). */
export function manualEntityFeedback(result: ManualEntityResult | null): ManualEntityFeedback {
  if (result === null) return "no-op";
  // ADR-174 §4 / ADR-175 §3: un choque sin resolver manda por sobre
  // cualquier otra lectura del resultado — ni éxito ni "no se encontró", el
  // diálogo de superposición decide.
  if (result.heldConflictIds.length > 0) return "held";
  if (result.groupIds.length > 0) return "added";
  if (result.occurrenceCount === 0) return "not-found";
  // Invariante de ADR-175 §3: `occurrenceCount > 0` ⇒ `heldConflictIds` o
  // `groupIds` no vacío. Llegar acá significa que el Core lo rompió.
  return "error";
}

/**
 * ADR-175 §3: el grupo a nombrar en el toast de éxito — el primero de
 * `groupIds` del tipo pedido, o el primero de todos si ninguno es de ese
 * tipo. `groupIds` ya viene en el orden que decidió el Core; esta función
 * solo resuelve cada id contra el store (`findGroupById`, `entityTree.ts`) y
 * aplica esa preferencia.
 */
export function resolveAddedGroup(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
  groupIds: ReadonlyArray<string>,
  entityType: EntityType,
): EntityGroup | undefined {
  const groups = groupIds
    .map((groupId) => findGroupById(groupsByType, groupId))
    .filter((group): group is EntityGroup => group !== undefined);
  return groups.find((group) => group.type === entityType) ?? groups[0];
}

export interface ManualAddToastText {
  readonly title: string;
  readonly description: string;
}

/**
 * El texto del toast. El número de apariciones es `occurrenceCount`
 * (apariciones del valor en el documento, ADR-061 §6): todas quedan cubiertas
 * por el grupo, sea nuevo o existente.
 */
export function describeManualAdd(params: {
  readonly value: string;
  readonly entityType: EntityType;
  readonly occurrenceCount: number;
  readonly group: EntityGroup | undefined;
}): ManualAddToastText {
  const { value, entityType, occurrenceCount, group } = params;
  const who =
    group !== undefined
      ? describeEntityNumber(group.type, group.indexInType)
      : ENTITY_TYPE_SINGULAR[entityType];
  const count =
    occurrenceCount === 1 ? "1 aparición oculta" : `${occurrenceCount} apariciones ocultas`;
  return { title: `Agregaste «${value}»`, description: `${who} · ${count}` };
}
