/**
 * `RemoveDocumentTypeDialog` — la confirmación de «Borrar tipo…» sobre un tipo
 * «solo de este documento» (`Components.md` §13b.6, ADR-225 §4,
 * `UX_Guidelines.md` §11b.10).
 *
 * Es un `alertdialog`. **Con entidades**, las lista —con sus apariciones— y avisa
 * que «Sus entidades quedan libres y descubiertas»: dejan de ocultarse en el
 * documento y en la copia exportada, y sugiere cambiarles el tipo antes. **Con
 * choques sin resolver** de entidades del tipo, suma antes de la lista el aviso
 * que recomienda resolverlos; **no bloquea** el botón: es una fricción, no una
 * traba. **Vacío**, se confirma igual, sin lista ni aviso.
 *
 * Al confirmar hace una sola entrada del deshacer (`applyRemoveDocumentType`).
 * La lista es de alto fijo y scrollea: el diálogo no crece con la cantidad.
 */

import type { UserEntityTypeDefinition } from "@anonly/anonymization-core";
import { TriangleAlertIcon, Trash2Icon } from "lucide-react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import {
  CHANGE_TYPE_FIRST_HINT,
  FREED_ENTITIES_LEAD,
  FREED_ENTITIES_REST,
  occurrencesLabel,
  removeTypeConfirmLabel,
  removeTypeTitle,
  unresolvedConflictCount,
  unresolvedConflictsWarning,
} from "./documentTypeCopy.js";
import { applyRemoveDocumentType } from "./documentTypeEdits.js";
import { sortGroups } from "./entityTree.js";

export interface RemoveDocumentTypeDialogProps {
  /** El tipo a borrar; `null` mientras no hay ninguno elegido. */
  readonly type: UserEntityTypeDefinition | null;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function RemoveDocumentTypeDialog({ type, open, onClose }: RemoveDocumentTypeDialogProps) {
  const groups = useEntitiesStore((state) =>
    type === null ? undefined : state.groupsByType.get(type.id),
  );
  const conflicts = useEntitiesStore((state) => state.conflicts);

  if (type === null) return null;
  const entities = sortGroups(groups ?? [], "appearance");
  const conflictCount = unresolvedConflictCount(conflicts, entities, type.id);

  function handleConfirm(): void {
    if (type === null) return;
    onClose();
    void applyRemoveDocumentType(type);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={removeTypeTitle(type.name)}
      role="alertdialog"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-error/10 text-error">
          <Trash2Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            <Trash2Icon className="h-4 w-4" aria-hidden />
            {removeTypeConfirmLabel(entities.length)}
          </Button>
        </div>
      }
    >
      {entities.length === 0 ? null : (
        <div className="flex flex-col gap-3 text-sm">
          {conflictCount > 0 ? (
            <p
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-text-primary"
            >
              <TriangleAlertIcon
                className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
                aria-hidden
              />
              <span>{unresolvedConflictsWarning(conflictCount)}</span>
            </p>
          ) : null}
          <ul
            aria-label="Entidades que se borran"
            className="max-h-44 overflow-y-auto rounded-lg border border-border bg-bg-secondary"
          >
            {entities.map((group) => (
              <li
                key={group.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate font-semibold text-text-primary">
                  {group.canonicalValue}
                </span>
                <span className="shrink-0 text-text-secondary">
                  {occurrencesLabel(group.members.length)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-text-primary">
            <b className="font-semibold">{FREED_ENTITIES_LEAD}</b> {FREED_ENTITIES_REST}{" "}
            <span className="text-text-secondary">{CHANGE_TYPE_FIRST_HINT}</span>
          </p>
        </div>
      )}
    </Dialog>
  );
}
