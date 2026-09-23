/**
 * `needsReviewBadgeCopy.ts` — visibilidad y copy de `NeedsReviewBadge`
 * (`ui/Components.md` §3.4d, ADR-094 §4), extraídos a funciones puras por el
 * mismo motivo que `personGenderVisibility.ts` y `needsReviewRow.ts`:
 * `apps/react-client` corre sus tests en Node sin jsdom, así que es la única
 * forma de testear esta lógica — incluida la regla que más fácil se rompe,
 * "el copy no muestra ningún número" — sin renderizar.
 */

import type { EntityGroup } from "@anonly/anonymization-core";

/** `ui/Components.md` §3.4d: "Si `group.needsReview` es `false`, no renderiza nada." */
export function isNeedsReviewBadgeVisible(group: EntityGroup): boolean {
  return group.needsReview;
}

/**
 * Copy exacto de `ui/Components.md` §3.4d. **Nunca** menciona la confianza
 * ni ningún número (ADR-094 §4: "el usuario no tiene que ver '0,59'") — es
 * la regla que más fácil se pierde cuando alguien "mejora" el mensaje, y por
 * eso vive como constante nombrada en vez de un literal en el JSX.
 */
export const NEEDS_REVIEW_TOOLTIP =
  "El detector no está seguro de que esto sea un dato personal. Revisalo.";

/**
 * ADR-169 §3: los tres avisos abren el mismo `Tooltip` —título + frase—. El
 * título nombra el aviso (ya no hay dos "!" iguales); la frase es la de
 * siempre para "Sugerida" (`NEEDS_REVIEW_TOOLTIP`, sin números).
 */
export const WARNING_TOOLTIP = {
  review: { title: "Sugerida.", text: NEEDS_REVIEW_TOOLTIP },
  conflict: {
    title: "Conflicto.",
    text: "Hay dos lecturas posibles de este dato. Hacé clic para decidir cuál vale.",
  },
  tightSpace: {
    title: "Espacio justo.",
    text: "El reemplazo no entra en el lugar del original y se achicó. Hacé clic para ver opciones.",
  },
} as const;

/** `ui/Components.md` §3.4d: `aria-label` del badge, con el `canonicalValue` del grupo. */
export function buildNeedsReviewAriaLabel(canonicalValue: string): string {
  return `Revisar ${canonicalValue}: el detector no está seguro de que sea un dato personal`;
}
