/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §6 errata): decide qué
 * hace el diálogo con el resultado de `actions.addManualEntity`. Extraída
 * como función pura porque `apps/react-client` corre sus tests en Node sin
 * jsdom (mismo criterio que `mergeValidation.ts`/`personGenderVisibility.ts`).
 *
 * ADR-169 §7 suma el toast de confirmación de las tres vías de agregado:
 * *"Agregaste «X» · Persona N.º 06 · 2 apariciones ocultas"*. El N.º es el que
 * quedó **después** de la renumeración de `finishSession`, así que se lee del
 * grupo tal como está en el store cuando `addManualEntity` resolvió.
 *
 * ADR-174 §4 / `Components.md` §3.4c: el toast de éxito exige DOS
 * condiciones, no una — `heldConflictIds.length === 0` **y** que el valor
 * haya quedado en un grupo. `occurrenceCount > 0` por sí solo no alcanza: lo
 * cuenta el Core **antes** de agrupar (ADR-061 §6 errata), así que un
 * agregado que chocó entero contra una detección de otro tipo también
 * informa `occurrenceCount > 0` sin que exista ningún grupo con el valor.
 */

import type { EntityGroup, EntityType, ManualEntityResult } from "@anonly/anonymization-core";

import { describeEntityNumber, ENTITY_TYPE_SINGULAR } from "./entityTypeLabels.js";

export type ManualEntityFeedback = "added" | "not-found" | "no-op" | "held";

/**
 * @param result `null` = sin documento activo (`no-op`, ADR-061 §6 errata).
 * @param groupFound si el valor agregado quedó en algún grupo del store
 *   (`findAddedGroup(...) !== undefined`) — el llamador ya lo necesita para
 *   armar el toast, así que se lo pasa en vez de que esta función dependa
 *   del store.
 */
export function manualEntityFeedback(
  result: ManualEntityResult | null,
  groupFound: boolean,
): ManualEntityFeedback {
  if (result === null) return "no-op";
  // ADR-174 §4: un choque sin resolver manda por sobre cualquier otra
  // lectura del resultado — ni éxito ni "no se encontró", el diálogo de
  // superposición decide.
  if (result.heldConflictIds.length > 0) return "held";
  if (result.occurrenceCount === 0) return "not-found";
  return groupFound ? "added" : "not-found";
}

/**
 * Comparación "como la búsqueda": sin mayúsculas, sin tildes y con los
 * espacios colapsados — "JOSE PEREZ" es "José Pérez" (`UX_Guidelines.md`
 * §5.4b). Es solo para **encontrar** el grupo que el agregado creó o tocó, no
 * una regla de agrupamiento.
 */
export function foldForLookup(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function groupHasValue(group: EntityGroup, folded: string): boolean {
  if (foldForLookup(group.canonicalValue) === folded) return true;
  if (group.aliases.some((alias) => foldForLookup(alias) === folded)) return true;
  return group.members.some((member) => foldForLookup(member.value) === folded);
}

/**
 * El grupo que quedó con el valor agregado. Primero en el tipo elegido; si no
 * está ahí, en cualquier otro — el dedup por identidad (ADR-038 §3) puede
 * haber sumado las apariciones a un grupo que ya existía con otro tipo.
 */
export function findAddedGroup(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
  value: string,
  entityType: EntityType,
): EntityGroup | undefined {
  const folded = foldForLookup(value);
  const preferred = (groupsByType.get(entityType) ?? []).find((group) =>
    groupHasValue(group, folded),
  );
  if (preferred !== undefined) return preferred;
  for (const groups of groupsByType.values()) {
    const found = groups.find((group) => groupHasValue(group, folded));
    if (found !== undefined) return found;
  }
  return undefined;
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
