/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §6 errata): decide qué
 * hace el diálogo con el resultado de `actions.addManualEntity`. Extraída
 * como función pura porque `apps/react-client` corre sus tests en Node sin
 * jsdom (mismo criterio que `mergeValidation.ts`/`personGenderVisibility.ts`).
 */

import type { ManualEntityResult } from "@anonly/anonymization-core";

export type ManualEntityFeedback = "added" | "not-found" | "no-op";

export function manualEntityFeedback(result: ManualEntityResult | null): ManualEntityFeedback {
  if (result === null) return "no-op";
  return result.occurrenceCount === 0 ? "not-found" : "added";
}
