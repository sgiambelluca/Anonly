/**
 * `useHistoryShortcuts` — el único listener de `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y`,
 * montado en `WorkLayout` (activo solo en la pantalla de trabajo, ADR-172 §3).
 *
 * La decisión es pura (`historyShortcuts.ts`); acá se lee el contexto del DOM
 * y se ejecuta. Deshacer o rehacer por atajo **cierra el toast de edición**:
 * su "Deshacer" nombraba una edición que ya no es la última.
 */

import { useEffect } from "react";

import { useHistoryStore } from "../../core-adapter/history.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { dismissToast } from "../common/toast.js";

import { isEditableTarget, resolveHistoryShortcut } from "./historyShortcuts.js";

/**
 * Un diálogo abierto (Radix pone `role="dialog"`/`"alertdialog"` al
 * contenido). El cajón de entidades también es un `dialog`, pero es la lista
 * misma: ahí el atajo sí vale.
 */
function isDialogOpen(): boolean {
  return (
    document.querySelector('[role="alertdialog"], [role="dialog"]:not([data-entities-drawer])') !==
    null
  );
}

export function useHistoryShortcuts(): void {
  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = resolveHistoryShortcut(event, {
        stage: usePipelineStore.getState().stage,
        editableTarget: isEditableTarget(target),
        dialogOpen: isDialogOpen(),
      });
      if (command === null) return;
      event.preventDefault();
      dismissToast();
      const history = useHistoryStore.getState();
      void (command === "undo" ? history.undo() : history.redo());
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);
}
