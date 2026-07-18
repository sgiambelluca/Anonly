/**
 * @anonly/grouping-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/Grouping_Engine.md §6, §9, §10 (v1.1.0,
 * ADR-038: reopenSession/dropOccurrences).
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
 *
 * `ReopenSessionOptions`/`DropOccurrencesFilter` (ADR-038 §2) se definen
 * literalmente en `Grouping_Engine.md` §6 (no en Contracts.md): son tipos
 * propios del motor, no contratos compartidos entre motores.
 */

import type { Conflict, DetectionSource, EntityGroup, Rule } from "@anonly/shared";

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

/** ADR-038 §2: re-análisis parcial preservando ediciones. */
export interface ReopenSessionOptions {
  readonly expectRegex: boolean; // la pasada re-correrá Regex (esperar REGEX_FINISHED)
  readonly expectNer: boolean; // la pasada re-correrá NER (esperar NER_FINISHED)
}

export interface DropOccurrencesFilter {
  readonly source?: DetectionSource;
  readonly pageIndices?: ReadonlyArray<number>;
  // Al menos un campo; ambos presentes = AND.
}
