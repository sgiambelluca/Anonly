/**
 * `needsReviewRow.ts` — cómputo puro para las dos reglas de fila que
 * `NeedsReviewBadge` trae sobre `EntityGroupItem` (`ui/Components.md` §3.4d,
 * ADR-094 §4).
 *
 * Extraído a funciones puras por el mismo motivo que `entityTree.ts` y
 * `personGenderVisibility.ts`: `apps/react-client` corre sus tests en Node
 * (`vitest.config.ts` raíz, sin jsdom), así que es la única forma de testear
 * esta lógica sin renderizar.
 */

import type { EntityGroup } from "@anonly/anonymization-core";

/**
 * `ui/Components.md` §3.4d: la fila sugerida no se atenúa. `EntityGroupItem`
 * atenuaba todo grupo deshabilitado — pero un grupo sugerido está
 * deshabilitado por diseño (ADR-094 §1) y atenuarlo lo haría ver como una
 * sugerencia que el usuario ya descartó, justo lo contrario de lo que la
 * marca busca. La atenuación pasa a aplicar solo cuando el grupo está
 * deshabilitado **y no** es una sugerencia pendiente.
 */
export function isRowDimmed(group: EntityGroup): boolean {
  return !group.enabled && !group.needsReview;
}

/**
 * `ui/Components.md` §3.4d: el `aria-label` de la fila suma ", a revisar" a
 * la enumeración que ya arma, para que un lector de pantalla lo diga sin
 * depender de pasar el mouse por el tooltip del badge.
 */
export function buildTreeItemAriaLabel(group: EntityGroup): string {
  const base = `${group.canonicalValue}, ${group.members.length} ocurrencias, ${
    group.enabled ? "habilitado" : "deshabilitado"
  }`;
  return group.needsReview ? `${base}, a revisar` : base;
}
