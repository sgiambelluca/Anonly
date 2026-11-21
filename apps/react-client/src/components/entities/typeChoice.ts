/**
 * `typeChoice.ts` — el estado de elección de tipo que comparten los cuatro
 * contenedores del `EntityTypePicker` (`Components.md` §13b.7, ADR-229 §2): qué
 * está elegido, el campo de «Nuevo tipo» y si el botón principal se puede
 * apretar.
 *
 * Puro: las transiciones son funciones sobre un valor, y el hook
 * (`useTypeChoice.ts`) solo las guarda en un `useState`.
 */

import type {
  CountryCode,
  EntityTypeId,
  UserEntityTypeDefinition,
} from "@anonly/anonymization-core";

import {
  createNewTypeDefinition,
  evaluateNewType,
  type NewTypeDraft,
  type NewTypeEvaluation,
} from "./newTypeInline.js";

export interface TypeChoiceState {
  readonly value: EntityTypeId | "new";
  /** El campo en línea; `null` = la celda punteada. */
  readonly newType: NewTypeDraft | null;
}

export function initialChoice(value: EntityTypeId): TypeChoiceState {
  return { value, newType: null };
}

/** Elegir un tipo existente cierra el campo de «Nuevo tipo»: la elección es una sola. */
export function chooseType(_state: TypeChoiceState, type: EntityTypeId): TypeChoiceState {
  return { value: type, newType: null };
}

/**
 * Activar (`{ name }`), escribir o descartar (`null`) el tipo nuevo. Descartarlo
 * vuelve a `fallback`, el tipo que estaba elegido al abrir.
 */
export function editNewType(
  state: TypeChoiceState,
  draft: NewTypeDraft | null,
  fallback: EntityTypeId,
): TypeChoiceState {
  if (draft !== null) return { value: "new", newType: draft };
  return { value: state.value === "new" ? fallback : state.value, newType: null };
}

export interface ChoiceResolution {
  /** El tipo con el que se agrega o al que se cambia: el elegido o el id del tipo nuevo. */
  readonly entityType: EntityTypeId;
  /** Presente si hay que crear el tipo antes («Crear y agregar» / «Crear y cambiar»). */
  readonly newType?: UserEntityTypeDefinition;
}

/** Lo que el contenedor necesita para confirmar, o `null` si todavía no se puede. */
export function resolveChoice(
  state: TypeChoiceState,
  existing: ReadonlyArray<UserEntityTypeDefinition>,
  country: CountryCode,
  newId?: () => string,
): ChoiceResolution | null {
  if (state.value !== "new") return { entityType: state.value };
  if (state.newType === null) return null;
  if (!evaluateNewType(state.newType, existing, country).canSubmit) return null;
  const definition = createNewTypeDefinition(state.newType, newId);
  return { entityType: definition.id, newType: definition };
}

export function evaluateChoice(
  state: TypeChoiceState,
  existing: ReadonlyArray<UserEntityTypeDefinition>,
  country: CountryCode,
): NewTypeEvaluation | null {
  return state.value === "new" && state.newType !== null
    ? evaluateNewType(state.newType, existing, country)
    : null;
}
