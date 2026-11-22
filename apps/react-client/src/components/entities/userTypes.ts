/**
 * `userTypes.ts` — los tipos propios que la interfaz conoce mientras hay un
 * documento abierto (`React_Client.md` §3.9, `Components.md` §13b.6-§13b.7).
 *
 * Son dos listas que se mezclan:
 *
 * - **guardados** (`detection.saved.userTypes`): vienen en la configuración con
 *   la que se creó el Core;
 * - **del documento** (`entities.documentTypes`): los que se crearon con el PDF
 *   abierto (ADR-219 §5).
 *
 * Para la interfaz un tipo es «solo de este documento» si está en la segunda y
 * no en `savedDuringDocument` (§3.9): un tipo que el usuario guardó durante el
 * documento ya es, a todo efecto, uno guardado.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type { UserEntityTypeDefinition, UserEntityTypeId } from "@anonly/anonymization-core";

export const NO_USER_TYPES: ReadonlyArray<UserEntityTypeDefinition> = [];

/** Un tipo propio con la marca que la interfaz necesita. */
export interface KnownUserType {
  readonly definition: UserEntityTypeDefinition;
  /** `true` = «solo en este documento»: es del documento y no se guardó. */
  readonly documentOnly: boolean;
}

/**
 * Todos los tipos propios en el orden en que el panel y el selector los
 * muestran: primero los guardados (en el orden de la configuración) y después
 * los del documento (en el orden de creación). Un tipo en las dos listas sale
 * una sola vez, en el lugar de los guardados.
 */
export function mergeUserTypes(
  saved: ReadonlyArray<UserEntityTypeDefinition>,
  documentTypes: ReadonlyArray<UserEntityTypeDefinition>,
  savedDuringDocument: ReadonlySet<UserEntityTypeId>,
): ReadonlyArray<KnownUserType> {
  const result: KnownUserType[] = saved.map((definition) => ({ definition, documentOnly: false }));
  const seen = new Set(saved.map((definition) => definition.id));
  for (const definition of documentTypes) {
    if (seen.has(definition.id)) continue;
    seen.add(definition.id);
    result.push({ definition, documentOnly: !savedDuringDocument.has(definition.id) });
  }
  return result;
}

export function userTypeDefinitions(
  known: ReadonlyArray<KnownUserType>,
): ReadonlyArray<UserEntityTypeDefinition> {
  return known.map((entry) => entry.definition);
}

export function findUserType(
  userTypes: ReadonlyArray<UserEntityTypeDefinition>,
  id: UserEntityTypeId,
): UserEntityTypeDefinition | undefined {
  return userTypes.find((definition) => definition.id === id);
}

/**
 * Cómo se nombra un tipo propio cuya definición la interfaz no encuentra. No
 * debería pasar (el Core no produce un grupo de un tipo que no definió), pero
 * una etiqueta neutra es mejor que romper el render del panel.
 */
export const UNKNOWN_USER_TYPE_NAME = "Tipo propio";
