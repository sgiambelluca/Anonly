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
  USER_TYPE_NAME_MAX,
  USER_TYPE_SHORT_LABEL_MAX,
  userTypeLabel,
  validateUserEntityType,
  type CountryCode,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

import { joinHelp, lengthCounter } from "../common/fieldHintText.js";

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

/**
 * Los tres reemplazos reales de la escalera de ADR-057 para el primer número
 * (`[LEGAJO 01]`, `[LEGA 01]`, `[LEG-01]`). Sin nombre, un guion largo en cada uno.
 */
export function replacementTokens(ladder: ReplacementLadder): readonly [string, string, string] {
  const token = (label: string, separator: string): string =>
    label === "" ? "—" : `[${label}${separator}01]`;
  return [token(ladder.level0, " "), token(ladder.level1, " "), token(ladder.level2, "-")];
}

/** La ayuda bajo el nombre: el contador y cómo queda (§11b.17), p. ej. `6/40 · Así se ve: [LEGAJO 01]`. */
export function typeNameHelp(fields: UserTypeFields): string {
  const [full] = replacementTokens(replacementLadder(fields));
  return joinHelp(
    lengthCounter(fields.name, USER_TYPE_NAME_MAX),
    fields.name.trim() === "" ? "" : `Así se ve: ${full}`,
  );
}

/** La ayuda bajo cada versión corta (§11b.17). */
export const SHORT_LABEL_HELP = `Hasta ${USER_TYPE_SHORT_LABEL_MAX} letras o números; vacías, se arman solas`;

/** Lo que muestra la ranura de alto fijo (`Components.md` §13b.3). */
export type TypeFormSlot =
  | { readonly kind: "idle" }
  | { readonly kind: "error"; readonly text: string };

export interface TypeFormResult {
  readonly definition: UserEntityTypeDefinition;
  readonly slot: TypeFormSlot;
  /** En qué campo va el error (§11b.17): las versiones cortas, o el nombre en todo lo demás. */
  readonly errorField: "name" | "short" | null;
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
  if (first === undefined) {
    return { definition, slot: { kind: "idle" }, errorField: null, canSubmit: true };
  }
  if (definition.name === "" && first.code === "name_empty") {
    return { definition, slot: { kind: "idle" }, errorField: null, canSubmit: false };
  }
  return {
    definition,
    slot: { kind: "error", text: userTypeIssueText(first.code, definition) },
    errorField: first.code === "short_label_invalid" ? "short" : "name",
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
  shortLabelsTitle: "Versiones cortas",
  optional: "(opcional)",
  shortLevel1Label: "Corta",
  shortLevel2Label: "Mínima",
  shortLabelsHint: "Si las dejás vacías, se arman solas con las primeras letras.",
  ladderCaptions: ["Completa", "Si no entra", "Si entra menos"],
  replacementInfo:
    "Se puede etiquetar, ocultar parcialmente o tapar con negro. Los tipos propios no tienen dato falso.",
  noteSaved: "Se guarda en este equipo y se aplica a los próximos documentos que abras.",
  noteSavedEdit:
    "El cambio se aplica al próximo documento que abras. Lo que ya exportaste queda como estaba.",
  noteDocument:
    "Es solo de este documento: se pierde al cerrarlo. Para tenerlo siempre y que se detecte solo, crealo en la pantalla de inicio y sumale un formato.",
  noteDocumentEdit:
    "Sigue siendo solo de este documento. Los tipos guardados solo se editan desde «Formatos de detección», en la pantalla de inicio.",
} as const;

/** La línea bajo el título del formulario, según el alcance y si se crea o se edita. */
export function typeFormLead(
  scope: UserTypeScope,
  mode: UserTypeMode,
  formatCount: number,
): string {
  if (scope === "document") {
    return mode === "edit"
      ? "Cambia cómo se reemplazan todas las entidades de este tipo."
      : "Para un dato que el análisis no conoce. Numera y se reemplaza por separado.";
  }
  if (mode === "create")
    return "Un dato que el catálogo no conoce, con nombre y numeración propios.";
  return `Cambiá cómo se llama y cómo se abrevia. ${
    formatCount === 1 ? "Su formato no cambia." : `Sus ${formatCount} formatos no cambian.`
  }`;
}

/** La nota al pie del cuerpo según el alcance (`Components.md` §13b.3). */
export function typeFormNote(scope: UserTypeScope, mode: UserTypeMode = "create"): string {
  if (scope === "saved") {
    return mode === "edit" ? TYPE_FORM_COPY.noteSavedEdit : TYPE_FORM_COPY.noteSaved;
  }
  return mode === "edit" ? TYPE_FORM_COPY.noteDocumentEdit : TYPE_FORM_COPY.noteDocument;
}
