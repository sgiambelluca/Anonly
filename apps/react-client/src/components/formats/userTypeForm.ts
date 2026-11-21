/**
 * `userTypeForm.ts` — la lógica del formulario de `UserTypeDialog`
 * (`Components.md` §13b.3, ADR-227 §4): armar la definición desde los campos,
 * validarla en vivo con `validateUserEntityType` y decidir qué muestra la ranura
 * de alto fijo.
 *
 * Puro: el componente solo dibuja. El texto de cada falla sale de la tabla de
 * `formatTexts.ts` (`UX_Guidelines.md` §11b.16).
 */

import {
  userTypeLabel,
  validateUserEntityType,
  type CountryCode,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

import { userTypeIssueText } from "./formatTexts.js";

export type UserTypeScope = "saved" | "document";
export type UserTypeMode = "create" | "edit";

export interface UserTypeFields {
  readonly name: string;
  readonly level1: string;
  readonly level2: string;
}

export function fieldsOf(definition: UserEntityTypeDefinition | undefined): UserTypeFields {
  return {
    name: definition?.name ?? "",
    level1: definition?.shortLabels?.level1 ?? "",
    level2: definition?.shortLabels?.level2 ?? "",
  };
}

/** La definición con los campos del formulario: sin versión corta vacía (= automática). */
export function buildUserTypeDefinition(
  id: UserEntityTypeId,
  fields: UserTypeFields,
): UserEntityTypeDefinition {
  const level1 = fields.level1.trim();
  const level2 = fields.level2.trim();
  return {
    id,
    name: fields.name.trim(),
    ...(level1 !== "" || level2 !== ""
      ? {
          shortLabels: {
            ...(level1 !== "" ? { level1 } : {}),
            ...(level2 !== "" ? { level2 } : {}),
          },
        }
      : {}),
  };
}

/** Las primeras `count` letras o dígitos de una etiqueta, sin espacios (ADR-219 §2). */
function automaticShort(label: string, count: number): string {
  return Array.from(label.replace(/[^\p{L}\p{N}]/gu, ""))
    .slice(0, count)
    .join("");
}

export interface ReplacementLadder {
  /** Nivel 0: la etiqueta completa. */
  readonly level0: string;
  /** Nivel 1: lo escrito a mano, o las primeras 4 letras o dígitos. */
  readonly level1: string;
  /** Nivel 2: lo escrito a mano, o las primeras 3. */
  readonly level2: string;
}

/**
 * La caja «Cómo se reemplaza»: los tres largos de la escalera de ADR-057 para
 * el nombre y las versiones cortas escritas. Sin nombre, vacía.
 */
export function replacementLadder(fields: UserTypeFields): ReplacementLadder {
  const level0 = userTypeLabel(fields.name);
  return {
    level0,
    level1: fields.level1.trim().toUpperCase() || automaticShort(level0, 4),
    level2: fields.level2.trim().toUpperCase() || automaticShort(level0, 3),
  };
}

/** Lo que muestra la ranura de alto fijo (`Components.md` §13b.3). */
export type TypeFormSlot =
  | { readonly kind: "idle" }
  | { readonly kind: "error"; readonly text: string };

export interface TypeFormResult {
  readonly definition: UserEntityTypeDefinition;
  readonly slot: TypeFormSlot;
  /** El botón principal se apaga con un error o con el nombre todavía vacío. */
  readonly canSubmit: boolean;
}

/**
 * Valida el formulario en vivo. Un nombre todavía vacío no es un error que
 * mostrar: la ranura queda en reposo (el usuario no escribió nada) y el botón
 * apagado. Con cualquier otro error, la ranura dice por qué y qué hacer.
 *
 * `existing` ya excluye al tipo que se edita (se compara por id).
 */
export function evaluateTypeForm(
  id: UserEntityTypeId,
  fields: UserTypeFields,
  existing: ReadonlyArray<UserEntityTypeDefinition>,
  country: CountryCode,
): TypeFormResult {
  const definition = buildUserTypeDefinition(id, fields);
  const validation = validateUserEntityType(definition, { country, existing });
  const first = validation.issues[0];
  if (first === undefined) return { definition, slot: { kind: "idle" }, canSubmit: true };
  if (definition.name === "" && first.code === "name_empty") {
    return { definition, slot: { kind: "idle" }, canSubmit: false };
  }
  return {
    definition,
    slot: { kind: "error", text: userTypeIssueText(first.code, definition) },
    canSubmit: false,
  };
}

export const TYPE_FORM_COPY = {
  createTitle: "Nuevo tipo",
  editTitle: "Editar tipo",
  createButton: "Crear tipo",
  editButton: "Guardar",
  nameLabel: "Nombre del tipo",
  ladderTitle: "Cómo se reemplaza",
  shortLevel1Label: "Versión corta 1",
  shortLevel2Label: "Versión más corta",
  idleSlot: "Para un dato que el catálogo no conoce, como un legajo o una historia clínica.",
  noteSaved: "Se guarda en este equipo y se aplica a los próximos documentos que abras.",
  noteDocument: "Este tipo es solo de este documento.",
} as const;

/** La nota al pie del cuerpo según el alcance (`Components.md` §13b.3). */
export function typeFormNote(scope: UserTypeScope): string {
  return scope === "saved" ? TYPE_FORM_COPY.noteSaved : TYPE_FORM_COPY.noteDocument;
}
