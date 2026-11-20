// ADR-219 §1: estrecha un EntityTypeId a un tipo propio. Un tipo propio es
// `"user:"` + UUID v4; los valores del enum `EntityType` nunca empiezan así.

import type { EntityTypeId, UserEntityTypeId } from "./types.js";

export function isUserEntityType(type: EntityTypeId): type is UserEntityTypeId {
  return type.startsWith("user:");
}
