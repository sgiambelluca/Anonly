import { ConflictReason, type Conflict, type EntityGroup } from "@anonly/anonymization-core";

import {
  candidateTypes,
  defaultCandidate,
  spellingChoices,
} from "../../../apps/react-client/src/components/conflicts/conflictResolution.js";

export interface V1GroupingSnapshot {
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly conflicts: ReadonlyArray<Conflict>;
}

export function conflictPreparationInvariants(
  before: V1GroupingSnapshot,
  after: V1GroupingSnapshot,
): { readonly groupsPreserved: boolean; readonly conflictsPreserved: boolean } {
  const groupProjection = (groups: ReadonlyArray<EntityGroup>) =>
    groups.map(({ updatedAt: _updatedAt, ...group }) => group);
  const conflictProjection = (conflicts: ReadonlyArray<Conflict>) =>
    conflicts.map(({ resolved: _resolved, resolvedType: _resolvedType, ...conflict }) => conflict);
  return {
    groupsPreserved:
      JSON.stringify(groupProjection(before.groups)) ===
      JSON.stringify(groupProjection(after.groups)),
    conflictsPreserved:
      JSON.stringify(conflictProjection(before.conflicts)) ===
      JSON.stringify(conflictProjection(after.conflicts)),
  };
}

export function unresolvedConflictCount(snapshot: V1GroupingSnapshot): number {
  return snapshot.conflicts.filter((conflict) => !conflict.resolved).length;
}

export function heldManualConflictCount(snapshot: V1GroupingSnapshot): number {
  return snapshot.conflicts.filter((conflict) => !conflict.resolved && conflict.heldManual === true)
    .length;
}

export function conflictDialogDefaultMatches(
  conflict: Conflict,
  group: EntityGroup,
  selectedRadioValues: ReadonlyArray<string>,
): boolean {
  const hasSpellingChoice =
    conflict.reason === ConflictReason.AmbiguousCanonical && spellingChoices(conflict).length > 1;
  if (hasSpellingChoice)
    return selectedRadioValues.length === 1 && selectedRadioValues[0] === group.canonicalValue;
  if (candidateTypes(conflict).length > 1)
    return (
      selectedRadioValues.length === 1 &&
      selectedRadioValues[0] === defaultCandidate(conflict).entityType
    );
  return selectedRadioValues.length === 0;
}
