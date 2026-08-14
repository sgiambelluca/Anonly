/**
 * `personGenderVisibility.ts` — condición de visibilidad de
 * `PersonGenderToggle` (`ui/Components.md` §3.4b, ADR-071 §1).
 *
 * Extraído a función pura: `apps/react-client` corre sus tests en Node
 * (`vitest.config.ts` raíz, sin jsdom), así que es la única forma de testear
 * esta lógica sin renderizar (mismo criterio que `entityTree.ts` y
 * `../toolbar/closeDocumentButtonVisibility.ts`).
 */

import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";

/**
 * ADR-071 §1: el control se muestra donde el token **usa** el género —
 * `placeholder` resuelve su label por género (ADR-060 §3) y `synthetic`
 * filtra el pool de nombres de pila (ADR-071 §5)—. En `mask` y `redact` sería
 * una palanca sin nada del otro lado: sus valores no pueden depender de
 * `personGender`.
 *
 * Reemplaza a las dos funciones previas (`isPersonGenderSelectVisible`, que
 * solo miraba el tipo, y `isPersonGenderUndeterminedMarkVisible`, que
 * gobernaba un badge separado): con la marca fusionada en el estado neutro
 * del propio control (ADR-071 §4), hay una sola cosa que mostrar u ocultar.
 *
 * **Leer `group.replacementMode` es correcto y suficiente**: el motor le
 * escribe encima el resultado de `resolveMode()` en cada mutación, así que
 * ese campo siempre lleva el modo **efectivo**, ya resuelto contra las reglas
 * de grupo/tipo/globales. La UI no replica esa escalera de prioridades, así
 * que no puede desincronizarse de ella.
 */
export function isPersonGenderToggleVisible(group: EntityGroup): boolean {
  return (
    group.type === EntityType.Person &&
    (group.replacementMode === ReplacementMode.Placeholder ||
      group.replacementMode === ReplacementMode.Synthetic)
  );
}
