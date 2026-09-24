/**
 * `applyEdits.ts` — las ediciones de entidades como acciones del usuario, cada
 * una una entrada de la pila de deshacer (ADR-172 §2).
 *
 * Todas siguen el mismo patrón: `recordEdit(label)` **antes** de emitir
 * (el punto del estado previo), los pedidos de siempre por `actions`, y —si
 * la superficie lo lleva— el toast con "Deshacer" (`editToast`). El undo ya no
 * se arma acá con la operación contraria (la restitución grupo por grupo que
 * tenía `undoableEdits.ts`, retirada por ADR-172 §4): vuelve al punto de
 * restauración, que es exacto también donde no había inversa.
 *
 * La decisión pura (qué grupos cambian, qué dice el toast) vive en los
 * módulos de al lado; acá solo se emite y se avisa.
 */

import type {
  EditPreviewGroup,
  EntityGroup,
  EntityType,
  PersonGenderChoice,
  ReplacementMode,
} from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { showToast } from "../common/toast.js";
import { removedGroupOverlapReveal } from "../conflicts/conflictResolution.js";

import { editToast, recordEdit } from "./editHistory.js";
import { typeChangeToastText } from "./editPreviews.js";
import { enabledToastText, groupsToToggle, removedToastText } from "./undoableEdits.js";

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
  const changing = groupsToToggle(params.groups, params.next);
  if (changing.length === 0) return;

  const title = enabledToastText({
    count: changing.length,
    label: params.label,
    isType: params.isType,
    next: params.next,
  });
  const recorded = recordEdit(title);
  for (const entry of changing) {
    actions.updateGroup(entry.groupId, { enabled: params.next });
  }
  showToast(editToast({ title }, recorded));
}

/** Editar a mano el valor de reemplazo (`EditReplacementDialog`). */
export function applyReplacementValue(params: {
  readonly group: EntityGroup;
  readonly value: string;
}): void {
  const { group, value } = params;
  const title = `«${group.canonicalValue}» se reemplaza por «${value}»`;
  const recorded = recordEdit(title);
  actions.updateGroup(group.id, { replacementValue: value });
  showToast(editToast({ title }, recorded));
}

/**
 * "Restaurar valor calculado" / "Volver al calculado" (ADR-078 §3):
 * re-aplicar el MISMO modo recalcula el valor y apaga el flag. Sin API nueva.
 */
export function restoreComputedValue(group: EntityGroup): void {
  const title = `«${group.canonicalValue}» volvió al reemplazo calculado`;
  const recorded = recordEdit(title);
  actions.updateGroup(group.id, { replacementMode: group.replacementMode });
  showToast(editToast({ title }, recorded));
}

/**
 * El género de una persona (ADR-069 §4). Es un control de la fila, como el
 * modo: sin toast, pero entra a la pila (ADR-172 §2).
 */
export function applyPersonGender(params: {
  readonly groupId: string;
  readonly label: string;
  readonly next: PersonGenderChoice;
}): void {
  recordEdit(`Género de «${params.label}»`);
  actions.updateGroup(params.groupId, { personGender: params.next });
}

/**
 * El modo de un grupo puesto desde el aviso de espacio justo (ADR-062 §3):
 * tapar con negro. Entra a la pila como cualquier cambio de modo.
 */
export function applyGroupMode(group: EntityGroup, mode: ReplacementMode): void {
  recordEdit(`«${group.canonicalValue}» cambia de modo`);
  actions.updateGroup(group.id, { replacementMode: mode });
}

/** Dejar un dato a la vista desde el aviso de espacio justo: deshabilitarlo. */
export function applyLeaveVisible(group: EntityGroup): void {
  recordEdit(`«${group.canonicalValue}» no se anonimiza`);
  actions.updateGroup(group.id, { enabled: false });
}

/** "Cambiar tipo…" (ADR-082 §6). `next` es la vista previa del Core, para el toast. */
export function applyTypeChange(
  group: EntityGroup,
  type: EntityType,
  next: EditPreviewGroup | undefined,
): void {
  const text = typeChangeToastText(group.canonicalValue, next);
  const recorded = recordEdit(text.title);
  actions.updateGroup(group.id, { type });
  showToast(editToast(text, recorded));
}

/**
 * "Fusionar con…": los N pedidos de `mergePlan` son **una** entrada de la
 * pila (ADR-172 §2).
 */
export function applyMerge(params: {
  readonly steps: ReadonlyArray<{ readonly sourceGroupId: string; readonly targetGroupId: string }>;
  readonly toast: { readonly title: string; readonly description?: string } | null;
  readonly historyLabel: string;
}): void {
  const recorded = recordEdit(params.historyLabel);
  for (const step of params.steps) {
    actions.mergeGroups(step.sourceGroupId, step.targetGroupId);
  }
  if (params.toast !== null) showToast(editToast(params.toast, recorded));
}

/** "Dividir…". */
export function applySplit(params: {
  readonly group: EntityGroup;
  readonly occurrenceIds: ReadonlyArray<string>;
  readonly toast: { readonly title: string; readonly description?: string };
}): void {
  const recorded = recordEdit(params.toast.title);
  actions.splitGroup(params.group.id, params.occurrenceIds);
  showToast(editToast(params.toast, recorded));
}

/**
 * "Eliminar entidad" (ADR-171 §5): borrar la regla de grupo y pedir la
 * eliminación son **un** punto de deshacer.
 *
 * **ADR-175 §1**: si este mismo pedido resuelve solo un conflicto
 * `heldManual` de este grupo —la detección que chocaba con algo marcado a
 * mano desaparece, así que lo marcado deja de estar retenido y se oculta—,
 * el toast lo dice en vez del de siempre. `actions.removeGroup` emite
 * `GROUP_REMOVE_REQUESTED` **sync** (`04_Event_System.md` §10): para cuando
 * la llamada vuelve, `entities.store.conflicts` ya refleja la resolución, si
 * la hubo — comparar el snapshot de antes contra el de después alcanza, sin
 * esperar ningún evento por separado.
 */
export function applyRemove(group: EntityGroup): void {
  const conflictsBefore = useEntitiesStore.getState().conflicts;
  const recorded = recordEdit(`Eliminaste «${group.canonicalValue}»`);
  actions.removeGroup(group.id);
  const conflictsAfter = useEntitiesStore.getState().conflicts;

  const reveal = removedGroupOverlapReveal({ conflictsBefore, conflictsAfter, groupId: group.id });
  const text =
    reveal !== null
      ? {
          title: `Eliminaste «${group.canonicalValue}»`,
          description: `Lo que marcaste («${reveal.value}») ahora se oculta`,
        }
      : removedToastText(group.canonicalValue);
  showToast(editToast(text, recorded));
}

/**
 * Resolver un conflicto (ADR-083): elegir la grafía y el tipo son una sola
 * decisión del usuario y una sola entrada de la pila.
 */
export function applyConflictResolution(params: {
  readonly conflictId: string;
  readonly groupId: string;
  readonly spelling: string | null;
  readonly entityType: EntityType | undefined;
  readonly label: string;
}): void {
  recordEdit(`Revisaste «${params.label}»`);
  if (params.spelling !== null) {
    actions.updateGroup(params.groupId, { canonicalValue: params.spelling });
  }
  actions.resolveConflict(
    params.conflictId,
    params.entityType !== undefined ? { entityType: params.entityType } : undefined,
  );
}

/**
 * `ManualOverlapDialog` (ADR-174 §3-§4, ADR-175 §4, `Components.md` §6.3):
 * el usuario elige quién gana, y esa elección vale para **todos** los
 * `conflictIds` del diálogo — un `resolveConflict` por conflicto, con el
 * mismo `winner`, dentro de **una sola** entrada de deshacer.
 */
export function applyManualOverlapResolution(params: {
  readonly conflictIds: ReadonlyArray<string>;
  readonly winner: "manual" | "detected";
  readonly value: string;
}): void {
  const count = params.conflictIds.length;
  const recorded = recordEdit(
    count === 1
      ? `Resolviste el choque de «${params.value}»`
      : `Resolviste ${count} choques de «${params.value}»`,
  );
  for (const conflictId of params.conflictIds) {
    actions.resolveConflict(conflictId, { winner: params.winner });
  }
  // Copy literal de ADR-175 §4 / `Components.md` §6.3: "Ocultaste «X»" /
  // "Dejaste lo que ya estaba detectado", con " en N lugares" solo si N > 1.
  const suffix = count > 1 ? ` en ${count} lugares` : "";
  showToast(
    editToast(
      {
        title:
          params.winner === "manual"
            ? `Ocultaste «${params.value}»${suffix}`
            : `Dejaste lo que ya estaba detectado${suffix}`,
        tone: "success",
      },
      recorded,
    ),
  );
}
