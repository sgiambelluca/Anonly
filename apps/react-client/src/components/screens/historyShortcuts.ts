/**
 * `historyShortcuts.ts` — cuándo `Ctrl/Cmd+Z` y `Ctrl/Cmd+Y` recorren la pila
 * de deshacer (ADR-172 §3, `ui/React_Client.md` §3.6c).
 *
 * - `Ctrl/Cmd+Z` deshace; `Ctrl/Cmd+Y` y `Ctrl/Cmd+Shift+Z` rehacen.
 * - **No actúa** con el foco en un `input`, `textarea` o `contenteditable`
 *   (ahí manda el deshacer nativo del campo), con un diálogo abierto, durante
 *   una pasada de detección ni durante un export.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 * `useHistoryShortcuts` lo conecta al `window`.
 */

import { PipelineStage } from "@anonly/anonymization-core";

import { matchesShortcut, type ShortcutKeyEvent } from "../toolbar/shortcuts.js";

export type HistoryCommand = "undo" | "redo";

export type { ShortcutKeyEvent };

/**
 * La combinación de teclas, sin mirar el contexto. Sale de la tabla de atajos
 * (`toolbar/shortcuts.ts`), la misma que lista la ayuda.
 */
export function historyCommandFor(event: ShortcutKeyEvent): HistoryCommand | null {
  if (matchesShortcut("undo", event)) return "undo";
  if (matchesShortcut("redo", event)) return "redo";
  return null;
}

export interface EditableTargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

/** Un campo donde el deshacer nativo del navegador tiene prioridad. */
export function isEditableTarget(target: EditableTargetLike | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Las etapas en las que el Core no toma ni restaura puntos (ADR-172 §1:
 * una pasada de detección en curso) más el export.
 */
const BLOCKED_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Importing,
  PipelineStage.Extracting,
  PipelineStage.OCRing,
  PipelineStage.Detecting,
  PipelineStage.Grouping,
  PipelineStage.Exporting,
]);

export function resolveHistoryShortcut(
  event: ShortcutKeyEvent,
  context: {
    readonly stage: PipelineStage;
    readonly editableTarget: boolean;
    readonly dialogOpen: boolean;
  },
): HistoryCommand | null {
  const command = historyCommandFor(event);
  if (command === null) return null;
  if (context.editableTarget || context.dialogOpen) return null;
  if (BLOCKED_STAGES.has(context.stage)) return null;
  return command;
}
