/**
 * Errores propios del Orchestrator.
 *
 * El Orchestrator no define códigos de error nuevos (Orchestrator.md §11):
 * usa los códigos genéricos ya canónicos de `core/Contracts.md` §4
 * (`ENGINE_DISPOSED`, `ENGINE_NOT_INITIALIZED`). `shared/src/errors.ts`
 * define `EngineDisposedError`/`EngineNotInitializedError` genéricos, pero
 * su constructor exige un `EngineId` real (el Orchestrator no es un motor,
 * no tiene `EngineId`) — estas dos subclases replican exactamente el mismo
 * patrón (`code`, `engineId: "core"`, mensaje descriptivo) sin ese
 * parámetro, igual que `InvalidInputError`/`CancelledError` en `shared` no
 * lo piden.
 */

import { EngineError, EngineErrorCode } from "@anonly/shared";

export class OrchestratorDisposedError extends EngineError {
  readonly code = EngineErrorCode.ENGINE_DISPOSED;
  readonly engineId = "core" as const;

  constructor() {
    super("El Orchestrator fue dispuesto. No se puede usar después de dispose().", false, {});
  }
}

/**
 * Type-guard para discriminar un `EngineError` por `code`, no por
 * `instanceof <SubclaseConcreta>` (ADR-049 §3). La subclase concreta no
 * sobrevive al boundary de un Worker: `postMessage` no transporta
 * prototipos y `EngineError.deserialize()` siempre reconstruye un
 * `DeserializedEngineError` genérico (`Contracts.md` §4). Lo que sí
 * sobrevive — y por lo tanto lo único seguro para discriminar — es `code`.
 * `instanceof EngineError` sigue siendo válido (distingue un error tipado
 * del Core de un `Error` cualquiera); lo que este helper reemplaza es el
 * `instanceof` de la subclase (`ai/Code_Standards.md` §7).
 */
export function isEngineErrorCode<C extends EngineErrorCode>(
  err: unknown,
  code: C,
): err is EngineError & { readonly code: C } {
  return err instanceof EngineError && err.code === code;
}
