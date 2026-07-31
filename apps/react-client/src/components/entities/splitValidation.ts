/**
 * `splitValidation.ts` — validación pura para `SplitDialog`
 * (`ui/Components.md` §3.7: "lista de members con checkbox ... Las
 * seleccionadas van a un grupo nuevo"; `03_Data_Model.md` §9 invariante
 * `members.length >= 1` — tanto para el grupo original como para el nuevo).
 */

import type { EntityGroup } from "@anonly/anonymization-core";

export interface SplitValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export function validateSplit(
  group: EntityGroup | undefined,
  selectedOccurrenceIds: ReadonlyArray<string>,
): SplitValidationResult {
  if (group === undefined) {
    return { valid: false, reason: "Grupo no encontrado." };
  }
  if (selectedOccurrenceIds.length === 0) {
    return { valid: false, reason: "Seleccioná al menos una ocurrencia." };
  }
  const memberIds = new Set(group.members.map((member) => member.occurrenceId));
  const allBelongToGroup = selectedOccurrenceIds.every((id) => memberIds.has(id));
  if (!allBelongToGroup) {
    return { valid: false, reason: "Alguna ocurrencia seleccionada no pertenece al grupo." };
  }
  const uniqueSelectedCount = new Set(selectedOccurrenceIds).size;
  if (uniqueSelectedCount >= memberIds.size) {
    return {
      valid: false,
      reason: "Debe quedar al menos una ocurrencia en el grupo original.",
    };
  }
  return { valid: true };
}
