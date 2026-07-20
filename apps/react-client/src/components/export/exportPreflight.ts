/**
 * `exportPreflight.ts` — conteo puro de grupos habilitados/deshabilitados
 * para el resumen de `ExportDialog` (`ui/UX_Guidelines.md` §8.2 "Resumen") y
 * el pre-flight de `ui/React_Client.md` §8: "`enabledGroups === 0` (pre-flight
 * **local** del `ExportDialog`, calculado del store — no es un evento)".
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";

export interface GroupCounts {
  readonly total: number;
  readonly enabled: number;
  readonly disabled: number;
}

export function countGroups(
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): GroupCounts {
  let total = 0;
  let enabled = 0;
  for (const groups of groupsByType.values()) {
    for (const group of groups) {
      total += 1;
      if (group.enabled) enabled += 1;
    }
  }
  return { total, enabled, disabled: total - enabled };
}

/** `ui/React_Client.md` §8: dispara el modal "No hay grupos habilitados...". */
export function needsNoEnabledGroupsConfirmation(counts: GroupCounts): boolean {
  return counts.enabled === 0;
}
