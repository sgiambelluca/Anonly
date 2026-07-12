/**
 * @anonly/grouping-engine — Errores propios del motor.
 *
 * Fuente de verdad: docs/core/Grouping_Engine.md §11.
 * Los error codes (GROUPING_INVALID_PATCH, GROUPING_GROUP_NOT_FOUND) ya
 * existen en EngineErrorCode (Contracts.md §4 / shared/src/enums.ts) — no se
 * agregan nuevos acá (I-4, R-19).
 *
 * `retryable`: ambos `false` (spec §11: "Grouping es determinista dadas las
 * ocurrencias y reglas; sin errores de runtime esperados... retryable: todos
 * false").
 */

import { EngineError, EngineErrorCode, EngineId } from "@anonly/shared";

/**
 * `GroupUpdateRequested.patch` contiene campos inmutables (`id`, `type`,
 * `members`, `indexInType`, `createdAt`, `aliases`) o una clave no permitida
 * por `Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" |
 * "enabled" | "canonicalValue">>` (spec §9, §11). No recuperable: se
 * rechaza el request completo.
 */
export class GroupingInvalidPatchError extends EngineError {
  readonly code = EngineErrorCode.GROUPING_INVALID_PATCH;
  readonly engineId = EngineId.Grouping;

  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Patch de grupo inválido: ${reason}`, false, details);
  }
}

/**
 * El `groupId` (o, por extensión del mismo caso "recurso no encontrado
 * dentro de la sesión" — ver nota de implementación en grouping.engine.ts
 * sobre `applyConflictResolve`, no hay un `EngineErrorCode` dedicado a
 * "conflictId no encontrado") referenciado no existe: fue eliminado o nunca
 * existió (spec §11). No recuperable.
 */
export class GroupingGroupNotFoundError extends EngineError {
  readonly code = EngineErrorCode.GROUPING_GROUP_NOT_FOUND;
  readonly engineId = EngineId.Grouping;

  constructor(documentId: string, groupId: string, details?: Record<string, unknown>) {
    super(`Grupo "${groupId}" no encontrado en el documento "${documentId}".`, false, {
      documentId,
      groupId,
      ...details,
    });
  }
}
