/**
 * @anonly/regex-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §11.
 * El error code (REGEX_INVALID_PATTERN) ya existe en EngineErrorCode
 * (Contracts.md §4 / shared/src/enums.ts) — no se agrega uno nuevo acá.
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * Patrón custom del usuario con regex inválida (p. ej. lanza al ejecutarla).
 * No recuperable: el patrón se descarta, el resto sigue funcionando
 * (Regex_Engine.md §11, §13 caso 8).
 */
export class RegexInvalidPatternError extends EngineError {
  readonly code = EngineErrorCode.REGEX_INVALID_PATTERN;
  readonly engineId = EngineId.Regex;

  constructor(patternId: string, reason: string) {
    super(`Patrón regex inválido (${patternId}): ${reason}`, false, { patternId, reason });
  }
}
