/**
 * `exportBlockReason.ts` — la regla de bloqueo de `ExportButton` (ADR-176
 * §1, `ui/Components.md` §2.5 "Bloqueo", `ui/UX_Guidelines.md` §8.1/§8.4).
 * Función pura y testeable, separada del `.tsx` (ADR-056): mismo criterio
 * que `manualOverlapWarning.ts`.
 *
 * **UI y Core bloquean a la vez** (ADR-176 §1, "Decidido por"): esto es el
 * lado de la UI — el botón queda deshabilitado antes de que el pedido
 * llegue a `runExport`, que además lo rechaza por su cuenta
 * (`EXPORT_UNRESOLVED_CONFLICTS`) como red de seguridad para cualquier otro
 * llamador. `03_Data_Model.md` §15 ya no admite "ignorado explícitamente":
 * no hay ningún camino para eso.
 */

import type { Conflict, EntityGroup, EntityType } from "@anonly/anonymization-core";

import type { EntitySortOrder } from "../../store/entities.store.js";
import { visibleTypeEntries } from "../entities/entityTree.js";

/**
 * `null` sin nada pendiente. Con algo pendiente, dos variantes de texto: si
 * alguno de los conflictos sin resolver es `heldManual`, el mismo mensaje
 * del aviso persistente de ADR-175 §5; si no —hoy no existe ese caso, pero
 * el Core no lo descarta— uno genérico.
 */
export function exportBlockReason(conflicts: ReadonlyArray<Conflict>): string | null {
  const pending = conflicts.filter((conflict) => !conflict.resolved);
  if (pending.length === 0) return null;
  return pending.some((conflict) => conflict.heldManual === true)
    ? "Hay un choque sin resolver. Resolvelo para exportar."
    : "Hay un conflicto sin resolver.";
}

/**
 * El primer conflicto sin resolver que **no** es `heldManual`, en el orden
 * del árbol (`entityTree.visibleTypeEntries`) — para "Resolver", que abre el
 * `ConflictDialog` de esa fila (`ui/Components.md` §2.5). Simétrico a
 * `manualOverlapWarning.firstPendingManualOverlapGroupId`, pero devuelve el
 * `conflictId` directo: `ConflictDialog` toma uno solo, a diferencia de
 * `ManualOverlapDialog` (que toma todos los de la fila).
 */
export function firstPendingConflictId(params: {
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>;
  readonly sortOrder: EntitySortOrder;
}): string | null {
  const byGroupId = new Map<string, Conflict>();
  for (const conflict of params.conflicts) {
    if (conflict.resolved || conflict.heldManual === true) continue;
    if (!byGroupId.has(conflict.groupId)) byGroupId.set(conflict.groupId, conflict);
  }
  if (byGroupId.size === 0) return null;
  for (const [, groups] of visibleTypeEntries(params.groupsByType, params.sortOrder)) {
    for (const group of groups) {
      const conflict = byGroupId.get(group.id);
      if (conflict !== undefined) return conflict.id;
    }
  }
  return null;
}
