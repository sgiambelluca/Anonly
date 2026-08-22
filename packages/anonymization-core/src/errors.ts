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
