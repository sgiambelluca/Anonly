/**
 * `personGenderVisibility.ts` — condiciones de visibilidad de
 * `PersonGenderSelect` (`ui/Components.md` §3.4b) y de la marca "género sin
 * determinar" del árbol (`ui/Components.md` §3.3, `ui/UX_Guidelines.md`
 * §3.3, ADR-060 §5).
 *
 * Extraído a funciones puras: `apps/react-client` corre sus tests en Node
 * (`vitest.config.ts` raíz, sin jsdom), así que es la única forma de testear
 * esta lógica sin renderizar (mismo criterio que `entityTree.ts` y
 * `../toolbar/closeDocumentButtonVisibility.ts`).
 */

import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";

/** `ui/Components.md` §3.4b: el selector solo se monta sobre grupos `Person`. */
export function isPersonGenderSelectVisible(type: EntityType): boolean {
  return type === EntityType.Person;
}

/**
 * ADR-060 §5: la marca señala un dato faltante, así que solo tiene sentido
 * cuando el token depende de ese dato — `placeholder` es el único modo cuyo
 * label se resuelve por género (`ADR-060 §3`); `mask`/`synthetic`/`redact`
 * no lo usan, y marcarlos ahí sería una señal sin acción posible detrás.
 */
export function isPersonGenderUndeterminedMarkVisible(group: EntityGroup): boolean {
  return (
    group.type === EntityType.Person &&
    group.replacementMode === ReplacementMode.Placeholder &&
    group.personGender === undefined
  );
}
