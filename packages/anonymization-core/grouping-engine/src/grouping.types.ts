/**
 * @anonly/grouping-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/Grouping_Engine.md §6, §9, §10.
 *
 * Nota de nombrado (mismo precedente que regex-engine/src/regex.types.ts y
 * ner-engine/src/ner.types.ts): se sigue Code_Standards.md §4 (prefijo del
 * motor) en vez del nombre literal "types.ts" del checklist §15 item 2.
 *
 * `GroupingConfig` NO se redefine acá: es el tipo canónico de @anonly/shared
 * (Contracts.md §6, ADR-026 — el alias "GroupingEngineConfig" que aparecía en
 * el texto de Grouping_Engine.md §6/§15.2 fue eliminado por ADR-026 y nunca
 * existió en código). Se re-exporta desde index.ts para conveniencia del
 * caller, igual que ner-engine hace con NerConfig.
 */

import type { Conflict, EntityGroup, Rule } from "@anonly/shared";

export interface GroupingEngineInput {
  readonly documentId: string;
  // No se pasa input directo; el motor escucha ENTITY_FOUND del bus (spec §9).
}

export interface GroupingEngineSnapshot {
  readonly documentId: string;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly rules: ReadonlyArray<Rule>;
}
