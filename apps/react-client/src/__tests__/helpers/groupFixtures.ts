/**
 * Fixtures de grupos y conflictos para los tests del panel de entidades de la
 * 1.1 (F7, tanda 3). Todo inventado: ningún dato de un documento real.
 */

import {
  ConflictReason,
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Conflict,
  type EntityGroup,
  type EntityTypeId,
  type OccurrenceRef,
} from "@anonly/anonymization-core";

export function member(overrides: Partial<OccurrenceRef> = {}): OccurrenceRef {
  return {
    occurrenceId: "o1",
    value: "Valor",
    pageIndex: 0,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    source: DetectionSource.Regex,
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [member()],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 01]",
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 01]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "c1",
    groupId: "g1",
    reason: ConflictReason.Disagree,
    candidates: [],
    resolved: false,
    ...overrides,
  };
}

export function groupsMap(
  ...groups: ReadonlyArray<EntityGroup>
): ReadonlyMap<EntityTypeId, ReadonlyArray<EntityGroup>> {
  const map = new Map<EntityTypeId, EntityGroup[]>();
  for (const group of groups) {
    const bucket = map.get(group.type) ?? [];
    bucket.push(group);
    map.set(group.type, bucket);
  }
  return map;
}
