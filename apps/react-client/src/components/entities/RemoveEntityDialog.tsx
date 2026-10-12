/**
 * `RemoveEntityDialog` — la confirmación de "Eliminar entidad"
 * (`ui/Components.md` §3.5b, ADR-215 §2; la acción es la de ADR-171 §5).
 *
 * Reemplaza al `ConfirmDialog` genérico **solo** para esta acción: una oración
 * gris con la consecuencia en el medio no alcanzaba para algo que deja un dato
 * a la vista. Ahora el diálogo muestra la frase de la primera aparición con
 * "Hoy" y "Si la eliminás", y las tres consecuencias en orden, la que importa
 * primero y en el color del texto principal.
 *
 * Al confirmar hace exactamente lo de siempre (`applyRemove`): la regla de
 * grupo si existe y `GROUP_REMOVE_REQUESTED`, en un mismo punto de deshacer, y
 * los toasts no cambian. El pie lo dice: se puede deshacer con `Ctrl+Z`, la
 * misma pista que usan los toasts de edición.
 *
 * **Foco inicial**: Radix lo pone en el primer control de la tabulación, que
 * es el botón de cierre del encabezado — nunca en "Eliminar".
 */

import type { EntityGroup } from "@anonly/anonymization-core";
import { EyeIcon, ListXIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import { applyRemove } from "./applyEdits.js";
import { ContextPreview } from "./ContextPreview.js";
import { UNDO_SHORTCUT_HINT } from "./editHistory.js";
import { EntityLine } from "./EntityLine.js";
import { todayPhrase } from "./phraseContent.js";
import {
  REMOVE_DESCRIPTION,
  REMOVE_IF_REMOVED_LABEL,
  REMOVE_LIST_CONSEQUENCE,
  REMOVE_NO_OCCURRENCE,
  REMOVE_REANALYZE_CONSEQUENCE,
  REMOVE_TITLE,
  REMOVE_TODAY_LABEL,
  REMOVE_UNDO_HINT_LEAD,
  visibleConsequence,
} from "./removeEntityCopy.js";

export interface RemoveEntityDialogProps {
  readonly group: EntityGroup;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RemoveEntityDialog({ group, open, onClose }: RemoveEntityDialogProps) {
  const first = group.members[0];
  const visible = visibleConsequence(group.members.length);

  function handleConfirm(): void {
    onClose();
    applyRemove(group);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={REMOVE_TITLE}
      description={REMOVE_DESCRIPTION}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-error/10 text-error">
          <Trash2Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      }
      footer={
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-sm text-text-secondary">
            {REMOVE_UNDO_HINT_LEAD}{" "}
            <kbd className="rounded border border-border bg-bg-tertiary px-1.5 font-sans text-text-primary">
              {UNDO_SHORTCUT_HINT}
            </kbd>
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            <Trash2Icon className="h-4 w-4" aria-hidden />
            Eliminar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 text-sm">
        <EntityLine
          group={{
            type: group.type,
            canonicalValue: group.canonicalValue,
            indexInType: group.indexInType,
            memberCount: group.members.length,
          }}
        />

        {/* Alto mínimo = el de la caja con una aparición: sin ella no cambia (UX-10). */}
        <div className="flex min-h-[8.75rem] flex-col gap-1.5 rounded-lg border border-border bg-bg-secondary px-3.5 py-3">
          {first !== undefined ? (
            <>
              <span className="text-text-secondary">{REMOVE_TODAY_LABEL}</span>
              <ContextPreview
                before={first.context?.before ?? ""}
                original={first.value}
                after={first.context?.after ?? ""}
                content={todayPhrase(group)}
              />
              <span className="text-text-secondary">{REMOVE_IF_REMOVED_LABEL}</span>
              <ContextPreview
                before={first.context?.before ?? ""}
                original={first.value}
                after={first.context?.after ?? ""}
                content={{ kind: "original" }}
                highlight="danger"
              />
            </>
          ) : (
            <span className="flex flex-1 items-center text-text-secondary">
              {REMOVE_NO_OCCURRENCE}
            </span>
          )}
        </div>

        <ul className="flex flex-col gap-2">
          <li className="flex items-start gap-2.5 text-text-primary">
            <EyeIcon className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden />
            <span>
              <b className="font-semibold">{visible.strong}</b>
              {visible.rest}
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-text-secondary">
            <ListXIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{REMOVE_LIST_CONSEQUENCE}</span>
          </li>
          <li className="flex items-start gap-2.5 text-text-secondary">
            <RotateCcwIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{REMOVE_REANALYZE_CONSEQUENCE}</span>
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
