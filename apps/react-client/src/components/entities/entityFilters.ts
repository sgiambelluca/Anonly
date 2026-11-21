/**
 * `entityFilters.ts` — los filtros del panel de entidades (`React_Client.md`
 * §3.10, ADR-224 §3, ADR-226 §3, ADR-229 §5).
 *
 * - **Combinación**: dentro de un mismo conjunto alcanza con cumplir una
 *   opción; entre conjuntos hay que cumplir todos. Con el buscador de la lista
 *   se combinan igual (el buscador se aplica aparte, en `entityTree.ts`).
 * - **«Para revisar»**: «disabled» = el grupo está desactivado; «conflict» = el
 *   grupo tuvo algún conflicto, **resuelto o no** (los de detección nacen
 *   resueltos, ADR-222 §3); «manual» = un miembro es de un agregado a mano o el
 *   reemplazo lo escribió el usuario.
 * - **«Tus formatos»** lista solo formatos del usuario que detectaron algo en el
 *   documento (ADR-226 §3); si no hay ninguno, la sección no se muestra.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  DetectionSource,
  getCatalog,
  ReplacementMode,
  type Conflict,
  type EntityGroup,
} from "@anonly/anonymization-core";

import type { DetectionState } from "../../store/detectionState.js";
import type { EntityFilters, ReviewFilter } from "../../store/entities.store.js";

import { REPLACEMENT_MODE_ORDER } from "./replacementModeOptions.js";

export function hasActiveFilters(filters: EntityFilters): boolean {
  return filters.formatIds.size > 0 || filters.modes.size > 0 || filters.review.size > 0;
}

/** Cuántas opciones hay marcadas: es el número que lleva el botón «Filtros». */
export function activeFilterCount(filters: EntityFilters): number {
  return filters.formatIds.size + filters.modes.size + filters.review.size;
}

/** Los ids de grupo que tuvieron algún conflicto, resuelto o no. */
export function groupIdsWithConflict(conflicts: ReadonlyArray<Conflict>): ReadonlySet<string> {
  return new Set(conflicts.map((conflict) => conflict.groupId));
}

export function isManualGroup(group: EntityGroup): boolean {
  return (
    group.replacementValueUserSet ||
    group.members.some((member) => member.source === DetectionSource.Manual)
  );
}

function matchesReview(
  group: EntityGroup,
  review: ReadonlySet<ReviewFilter>,
  withConflict: ReadonlySet<string>,
): boolean {
  if (review.size === 0) return true;
  return (
    (review.has("disabled") && !group.enabled) ||
    (review.has("conflict") && withConflict.has(group.id)) ||
    (review.has("manual") && isManualGroup(group))
  );
}

export function groupMatchesFilters(
  group: EntityGroup,
  filters: EntityFilters,
  withConflict: ReadonlySet<string>,
): boolean {
  if (
    filters.formatIds.size > 0 &&
    (group.formatId === undefined || !filters.formatIds.has(group.formatId))
  ) {
    return false;
  }
  if (filters.modes.size > 0 && !filters.modes.has(group.replacementMode)) return false;
  return matchesReview(group, filters.review, withConflict);
}

export function applyEntityFilters(
  groups: ReadonlyArray<EntityGroup>,
  filters: EntityFilters,
  withConflict: ReadonlySet<string>,
): ReadonlyArray<EntityGroup> {
  if (!hasActiveFilters(filters)) return groups;
  return groups.filter((group) => groupMatchesFilters(group, filters, withConflict));
}

/** Una opción de «Tus formatos»: un formato del usuario y cuántas entidades detectó. */
export interface FormatFilterOption {
  readonly formatId: string;
  readonly name: string;
  readonly count: number;
}

/**
 * Las opciones de «Tus formatos»: los formatos del usuario que tienen al menos
 * un grupo en el documento, en el orden de su primer grupo. `nameOf` devuelve el
 * nombre de un formato del usuario, o `undefined` si el id no es de uno (ADR-226
 * §1: los del catálogo no se pueden filtrar).
 */
export function formatFilterOptions(
  groups: ReadonlyArray<EntityGroup>,
  nameOf: (formatId: string) => string | undefined,
): ReadonlyArray<FormatFilterOption> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    if (group.formatId === undefined) continue;
    counts.set(group.formatId, (counts.get(group.formatId) ?? 0) + 1);
  }
  const options: FormatFilterOption[] = [];
  for (const [formatId, count] of counts) {
    const name = nameOf(formatId);
    if (name !== undefined) options.push({ formatId, name, count });
  }
  return options;
}

/** Cuántos grupos hay en cada modo de reemplazo (los números de «Modo de reemplazo»). */
export function modeCounts(
  groups: ReadonlyArray<EntityGroup>,
): Readonly<Record<ReplacementMode, number>> {
  const counts: Record<ReplacementMode, number> = {
    [ReplacementMode.Placeholder]: 0,
    [ReplacementMode.Mask]: 0,
    [ReplacementMode.Synthetic]: 0,
    [ReplacementMode.Redact]: 0,
  };
  for (const group of groups) counts[group.replacementMode] += 1;
  return counts;
}

/** La muestra de cómo queda cada modo (ADR-229 §5); `"bar"` se dibuja como un bloque negro. */
export const MODE_FILTER_SAMPLE: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "[TIPO 01]",
  [ReplacementMode.Mask]: "XX.XXX.XXX",
  [ReplacementMode.Synthetic]: "Marta Quiroga",
  [ReplacementMode.Redact]: "bar",
};

export const MODE_FILTER_ORDER: ReadonlyArray<ReplacementMode> = REPLACEMENT_MODE_ORDER;

/** Las tres opciones de «Para revisar», cada una con la línea que dice qué es. */
export const REVIEW_FILTER_OPTIONS: ReadonlyArray<{
  readonly value: ReviewFilter;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "disabled",
    label: "Desactivadas",
    description: "Quedan a la vista en el documento exportado.",
  },
  {
    value: "conflict",
    label: "Con conflicto",
    description: "Tuvieron un conflicto, resuelto o no.",
  },
  {
    value: "manual",
    label: "Agregadas o editadas a mano",
    description: "Las marcaste vos o escribiste su reemplazo.",
  },
];

/** Alterna una opción de un conjunto sin mutarlo. */
export function toggleInSet<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** El resumen de la lista con filtros: «Mostrando 2 de 10». */
export function describeFilteredCount(shown: number, total: number): string {
  return `Mostrando ${shown} de ${total}`;
}

export const NO_FILTER_RESULTS_TEXT = "Ninguna entidad cumple los filtros";

/**
 * El nombre de un formato **del usuario** (ADR-226 §1): propio o copia editada
 * (`userFormats`), o —desde la 1.1.1— uno traído de otro país (`catalogRefs`).
 * `undefined` si el id no es de uno: los formatos base no se pueden filtrar.
 */
export function userFormatNameOf(state: DetectionState): (formatId: string) => string | undefined {
  return (formatId) => {
    const own = state.userFormats.find((format) => format.id === formatId);
    if (own !== undefined) return own.name;
    const ref = state.catalogRefs.find((candidate) => candidate.id === formatId);
    if (ref === undefined) return undefined;
    return getCatalog(ref.country).find((info) => info.id === ref.catalogFormatId)?.name;
  };
}
