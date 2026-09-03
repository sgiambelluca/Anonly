/**
 * `entityTree.ts` — cómputo puro para el árbol de `EntitiesPanel`
 * (`ui/Components.md` §3.1-§3.3, `ui/UX_Guidelines.md` §3).
 *
 * Separado de los componentes React a propósito: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que la única forma
 * de testear esta lógica es extraerla de cualquier código que dependa del DOM
 * (mismo criterio que `components/viewer/visibleRange.ts`).
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";

/** Búsqueda de `ui/UX_Guidelines.md` §3.2: filtra por `canonicalValue` o `aliases`, case-insensitive. */
export function filterGroups(
  groups: ReadonlyArray<EntityGroup>,
  query: string,
): ReadonlyArray<EntityGroup> {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return groups;
  return groups.filter((group) => groupMatchesQuery(group, normalized));
}

function groupMatchesQuery(group: EntityGroup, normalizedQuery: string): boolean {
  if (group.canonicalValue.toLowerCase().includes(normalizedQuery)) return true;
  return group.aliases.some((alias) => alias.toLowerCase().includes(normalizedQuery));
}

export type CascadeCheckboxState = boolean | "indeterminate";

/**
 * Estado tri-valuado del checkbox de cabecera de `EntityTypeGroup`
 * (`ui/Components.md` §3.2: "Checkbox cabecera → ... para todos los grupos del
 * tipo"; `ui/Components.md` §8.4 documenta el wrapper `Checkbox` con soporte
 * `indeterminate`).
 */
export function cascadeCheckboxState(groups: ReadonlyArray<EntityGroup>): CascadeCheckboxState {
  if (groups.length === 0) return false;
  const enabledCount = groups.filter((group) => group.enabled).length;
  if (enabledCount === 0) return false;
  if (enabledCount === groups.length) return true;
  return "indeterminate";
}

/**
 * Entradas de `groupsByType` con al menos un grupo, preservando el orden fijo
 * del `Map` (`entities.store.ts`: `ENTITY_TYPE_ORDER`, `ui/Components.md` §3.1).
 * Los tipos sin grupos no se muestran en el árbol.
 */
export function visibleTypeEntries(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): ReadonlyArray<readonly [EntityType, ReadonlyArray<EntityGroup>]> {
  return Array.from(groupsByType.entries())
    .filter(([, groups]) => groups.length > 0)
    .map(([type, groups]) => [type, sortByDocumentOrder(groups)] as const);
}

/*
 * El store acumula por orden de LLEGADA (`entities.store.ts#addGroup`:
 * `[...bucket, group]`), y eso coincidía con el orden del documento **por
 * accidente**, porque todo el pipeline corría en serie. ADR-101 paralelizó el
 * despacho de OCR y el accidente se terminó: las entidades empezaron a
 * aparecer en la lista en el orden en que el motor las encontró, con sus
 * números salteados.
 *
 * `indexInType` es la fuente correcta: ADR-028 lo renumera canónicamente por
 * **primera aparición documental** antes de `GROUPING_FINISHED`, justamente
 * porque el orden de llegada de `ENTITY_FOUND` ya se declaraba
 * no-determinístico. O sea que el dato siempre estuvo bien y lo único que
 * faltaba era que la lista lo respetara.
 *
 * Desempate por `id` para que el orden sea estable mientras el pipeline
 * todavía corre y hay grupos con índice provisional.
 */
function sortByDocumentOrder(groups: ReadonlyArray<EntityGroup>): ReadonlyArray<EntityGroup> {
  return [...groups].sort((a, b) => a.indexInType - b.indexInType || a.id.localeCompare(b.id));
}

/** Busca un `EntityGroup` por `id` en cualquier bucket de tipo. `undefined` si no existe. */
export function findGroupById(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
  groupId: string,
): EntityGroup | undefined {
  for (const groups of groupsByType.values()) {
    const found = groups.find((group) => group.id === groupId);
    if (found) return found;
  }
  return undefined;
}

/** `true` si hay al menos un grupo en cualquier tipo (`App.tsx` decide con esto si monta `EntitiesPanel`). */
export function hasAnyGroup(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): boolean {
  for (const groups of groupsByType.values()) {
    if (groups.length > 0) return true;
  }
  return false;
}
