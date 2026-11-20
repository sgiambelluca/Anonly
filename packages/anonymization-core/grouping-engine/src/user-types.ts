/**
 * Validación de un tipo propio (ADR-219 §2, Contracts.md §5.2). Función pura y
 * dueña de las reglas: el façade la reexporta (Contracts.md §3.5).
 */

import {
  USER_TYPE_NAME_MAX,
  USER_TYPE_SHORT_LABEL_MAX,
  type UserEntityTypeDefinition,
  type UserEntityTypeIssueCode,
  type UserEntityTypeValidation,
  type UserEntityTypeValidationContext,
} from "@anonly/shared";

import { baseTypeLabels } from "./labels.js";
import { userTypeLabel } from "./user-type-label.js";

const NAME_CHARS_RE = /^[\p{L}\p{N} -]+$/u;
const LETTER_RE = /\p{L}/u;
const LETTERS_OR_DIGITS_RE = /^[\p{L}\p{N}]+$/u;
// `"user:"` + UUID v4 (Contracts.md §5.2): versión 4 y variante [89ab], igual que
// `validateFormat` en regex-engine.
const USER_TYPE_ID_RE =
  /^user:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidShortLabel(value: string | undefined): boolean {
  if (value === undefined) return true;
  return (
    value.length >= 1 &&
    value.length <= USER_TYPE_SHORT_LABEL_MAX &&
    LETTERS_OR_DIGITS_RE.test(value)
  );
}

/**
 * Nombre de 1 a `USER_TYPE_NAME_MAX` caracteres, con al menos una letra y solo
 * letras, dígitos, espacios y guiones. Versiones cortas de 1 a
 * `USER_TYPE_SHORT_LABEL_MAX` letras o dígitos. `id` con forma `user:<uuid>` y
 * sin repetir en `existing`. La etiqueta no puede ser la de un tipo base en
 * `context.country` ni la de otro tipo de `existing`.
 */
export function validateUserEntityType(
  definition: UserEntityTypeDefinition,
  context: UserEntityTypeValidationContext,
): UserEntityTypeValidation {
  const issues: UserEntityTypeIssueCode[] = [];
  const name = definition.name.trim();

  if (name.length === 0) {
    issues.push("name_empty");
  } else {
    if (name.length > USER_TYPE_NAME_MAX) issues.push("name_too_long");
    if (!NAME_CHARS_RE.test(name)) issues.push("name_invalid_chars");
    if (!LETTER_RE.test(name)) issues.push("name_without_letter");
  }

  if (
    !isValidShortLabel(definition.shortLabels?.level1) ||
    !isValidShortLabel(definition.shortLabels?.level2)
  ) {
    issues.push("short_label_invalid");
  }

  if (name.length > 0) {
    const label = userTypeLabel(name);
    const taken =
      baseTypeLabels(context.country).includes(label) ||
      context.existing.some((other) => userTypeLabel(other.name) === label);
    if (taken) issues.push("label_taken");
  }

  if (!USER_TYPE_ID_RE.test(definition.id)) issues.push("id_invalid");
  else if (context.existing.some((other) => other.id === definition.id)) issues.push("id_taken");

  return { ok: issues.length === 0, issues: issues.map((code) => ({ code })) };
}
