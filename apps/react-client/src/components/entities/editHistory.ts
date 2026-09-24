/**
 * `editHistory.ts` — cómo entra una edición a la pila de deshacer (ADR-172
 * §2-§3, `ui/Components.md` §3.11).
 *
 * - `recordEdit(label)` va **antes** de emitir los pedidos de una acción del
 *   usuario: un punto de restauración del estado previo. Una acción = un
 *   `recordEdit`, aunque emita varios pedidos.
 * - `editToast(input, recorded)` le suma a un toast de edición el botón
 *   **"Deshacer"** con la pista `Ctrl+Z`, que llama a `undo()` —el mismo
 *   camino que el atajo—. Si la edición no quedó registrada (el Core no pudo
 *   tomar el punto), el toast sale sin el botón: ofrecer un deshacer que no
 *   existe es peor que no ofrecerlo.
 *
 * Hay un solo toast a la vez (`toast.ts`): una edición nueva reemplaza al
 * anterior, así que el "Deshacer" visible siempre deshace la edición que el
 * toast nombra, que es la última.
 */

import { useHistoryStore } from "../../core-adapter/history.js";
import type { ToastAction, ToastInput } from "../common/toast.js";

/** La pista del atajo en el botón del toast (ADR-172 §3). */
export const UNDO_SHORTCUT_HINT = "Ctrl+Z";

export function recordEdit(label: string): boolean {
  return useHistoryStore.getState().record(label);
}

export function undoLastEdit(): void {
  void useHistoryStore.getState().undo();
}

/** Agrega "Deshacer" al final de las acciones del toast, si hay algo que deshacer. */
export function withUndoAction(input: ToastInput, recorded: boolean, undo: () => void): ToastInput {
  if (!recorded) return input;
  const undoAction: ToastAction = { label: "Deshacer", run: undo, shortcut: UNDO_SHORTCUT_HINT };
  return { ...input, actions: [...(input.actions ?? []), undoAction] };
}

export function editToast(input: ToastInput, recorded: boolean): ToastInput {
  return withUndoAction(input, recorded, undoLastEdit);
}
