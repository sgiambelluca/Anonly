/**
 * `applyEdits.ts` — ejecuta las ediciones del árbol que ganan "Deshacer"
 * (`undoableEdits.ts` explica el criterio y qué queda afuera).
 *
 * Mismo reparto que `applyMode.ts`: la decisión pura vive en el módulo de al
 * lado, acá solo se emiten las acciones y se muestra el toast.
 */

import type { EntityGroup } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { showToast } from "../common/toast.js";

import { enabledToastText, groupsToToggle } from "./undoableEdits.js";

/**
 * Habilitar/deshabilitar uno o varios grupos. Cubre las dos superficies que
 * llegan acá: el checkbox de una fila y la cascada de una cabecera de tipo
 * (que en un tipo grande apaga decenas de grupos con un click).
 */
export function applyEnabled(params: {
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly next: boolean;
  readonly label: string;
  readonly isType: boolean;
}): void {
  const snapshot = groupsToToggle(params.groups, params.next);
  if (snapshot.length === 0) return;

  for (const entry of snapshot) {
    actions.updateGroup(entry.groupId, { enabled: params.next });
  }

  showToast(
    enabledToastText({
      count: snapshot.length,
      label: params.label,
      isType: params.isType,
      next: params.next,
    }),
    {
      label: "Deshacer",
      run: () => {
        // Se restituye grupo por grupo su valor anterior, no un `next` global:
        // en una cascada la mitad de las filas podía estar ya en ese estado.
        for (const entry of snapshot) {
          actions.updateGroup(entry.groupId, { enabled: entry.enabled });
        }
      },
    },
  );
}

/**
 * Editar a mano el valor de reemplazo (`EditReplacementDialog`).
 *
 * El undo tiene dos formas según de dónde venía el valor anterior. Si el
 * usuario ya lo había escrito, se reescribe. Si era el valor **calculado** por
 * el Core, reescribirlo lo dejaría marcado como escrito a mano —el punto de la
 * fila y la marca `replacementValueUserSet` mienten desde ahí en adelante—,
 * así que en su lugar se re-aplica el modo vigente, que es lo que recalcula el
 * valor (mismo camino que "Restaurar valor calculado" del menú contextual).
 */
export function applyReplacementValue(params: {
  readonly group: EntityGroup;
  readonly value: string;
}): void {
  const { group, value } = params;
  const previousValue = group.replacementValue;
  const wasUserSet = group.replacementValueUserSet;

  actions.updateGroup(group.id, { replacementValue: value });

  showToast(`«${group.canonicalValue}» se reemplaza por «${value}»`, {
    label: "Deshacer",
    run: () => {
      if (wasUserSet && previousValue !== undefined) {
        actions.updateGroup(group.id, { replacementValue: previousValue });
        return;
      }
      actions.updateGroup(group.id, { replacementMode: group.replacementMode });
    },
  });
}
