/**
 * @anonly/regex-engine — Valor y máscara de la `Occurrence` de un formato del
 * generador (ADR-220 §5).
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, «La `Occurrence` de un
 * formato del generador».
 */

import {
  alphanumericKey,
  EntityType,
  isUserEntityType,
  maskByCharacters,
  type EntityTypeId,
} from "@anonly/shared";

import {
  normalizeUppercaseNoDashes,
  normalizeUppercaseNoSpaces,
  stripDashes,
  stripDots,
  stripNonDigits,
} from "../patterns/default-ar.js";

/** Los separadores del generador: espacio, `-`, `.` y `/`. */
const GENERATOR_SEPARATORS_RE = /[\s\-./]/g;

/**
 * Bajo un tipo propio, `alphanumericKey(value)`. Bajo un tipo base, el
 * normalizador de ese tipo después de quitar los separadores del generador:
 * así `"34-567-891"` da `"34567891"`, igual que el `"34.567.891"` de `dni-ar`.
 */
export function userFormatNormalizedValue(entityType: EntityTypeId, value: string): string {
  if (isUserEntityType(entityType)) return alphanumericKey(value);
  const withoutSeparators = value.replace(GENERATOR_SEPARATORS_RE, "");
  switch (entityType) {
    case EntityType.DNI:
      return stripDots(withoutSeparators);
    case EntityType.CUIT:
      return stripDashes(withoutSeparators);
    case EntityType.Phone:
      return stripNonDigits(withoutSeparators);
    case EntityType.License:
      return normalizeUppercaseNoDashes(withoutSeparators);
    case EntityType.Plate:
      return normalizeUppercaseNoSpaces(withoutSeparators);
    default:
      return withoutSeparators;
  }
}

/** Bajo un tipo base, `maskByCharacters(value)`; bajo un tipo propio, ausente (ADR-219 §3). */
export function userFormatMaskFormat(entityType: EntityTypeId, value: string): string | undefined {
  return isUserEntityType(entityType) ? undefined : maskByCharacters(value);
}
