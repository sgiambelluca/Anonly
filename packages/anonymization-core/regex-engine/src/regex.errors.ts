/**
 * @anonly/regex-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §11.
 * El error code (REGEX_INVALID_PATTERN) ya existe en EngineErrorCode
 * (Contracts.md §4 / shared/src/enums.ts) — no se agrega uno nuevo acá.
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * Un `FormatDefinition` de `detection.userFormats` que no pasa `validateFormat`
 * al `init` (ADR-220 §6). No recuperable: el formato se descarta con `warn` y
 * el resto sigue funcionando; el motor no la lanza hacia el caller
 * (Regex_Engine.md §11, §13 caso 47). `patternId` es el id del formato.
 */
export class RegexInvalidPatternError extends EngineError {
  readonly code = EngineErrorCode.REGEX_INVALID_PATTERN;
  readonly engineId = EngineId.Regex;

  constructor(patternId: string, reason: string) {
    super(`Patrón regex inválido (${patternId}): ${reason}`, false, { patternId, reason });
  }
}
