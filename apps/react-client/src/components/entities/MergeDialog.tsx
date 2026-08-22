/**
 * `MergeDialog` (`ui/Components.md` §3.6).
 *
 * Props del catálogo: `sourceGroupId`. `open`/`onClose` se agregan siguiendo
 * el mismo patrón que el resto de los diálogos ya existentes en el repo
 * (`SettingsDialog`, `PasswordDialog`: estado de apertura levantado al
 * llamador, acá `EntityGroupItem`).
 *
 * Autocomplete de destino filtrado por mismo `EntityType`
 * (`mergeValidation.ts`). Acción: `actions.mergeGroups(sourceGroupId,
 * targetGroupId)` → `GROUP_MERGE_REQUESTED`. El feedback de toast ("Grupos
 * fusionados. Índice conservado: 01.") queda fuera de este PR: no hay
 * componente `Toast`/`Sonner` implementado todavía (`ui/Components.md` §8.6 lo
 * documenta pero ningún PR anterior lo construyó) y agregarlo no está en el
 * pedido concreto de este PR.
 */

import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select } from "../common/Select.js";

import { findGroupById } from "./entityTree.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { mergeTargetOptions, validateMerge } from "./mergeValidation.js";

export interface MergeDialogProps {
  readonly sourceGroupId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function MergeDialog({ sourceGroupId, open, onClose }: MergeDialogProps) {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const sourceGroup = findGroupById(groupsByType, sourceGroupId);
  const targetOptions = sourceGroup
    ? mergeTargetOptions(sourceGroup, groupsByType.get(sourceGroup.type) ?? [])
    : [];

  const [targetGroupId, setTargetGroupId] = useState<string | null>(targetOptions[0]?.id ?? null);

  // Reinicia la selección cada vez que se abre (mismo criterio que
  // `SettingsDialog`: "re-sincroniza el formulario ... cada vez que se abre").
  useEffect(() => {
    if (!open) return;
    setTargetGroupId(targetOptions[0]?.id ?? null);
    // Deps acotadas a propósito a `[open, sourceGroupId]` (sin `targetOptions`,
    // que es un array nuevo en cada render): mismo criterio que
    // `viewer/PdfViewer.tsx` — el repo no tiene `eslint-plugin-react-hooks`
    // que exija la lista exhaustiva.
  }, [open, sourceGroupId]);

  if (sourceGroup === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Fusionar grupo">
        <p className="text-sm text-text-secondary">Este grupo ya no está disponible.</p>
      </Dialog>
    );
  }

  const targetGroup = targetOptions.find((group) => group.id === targetGroupId);
  const validation = validateMerge(sourceGroup, targetGroup);

  // Arrow function (no `function` declaration): TypeScript solo preserva el
  // narrowing de `sourceGroup` (por el `if` de arriba) dentro de expresiones de
  // función definidas en el mismo scope, no de declaraciones `function`
  // (hoisting — mismo motivo en `SplitDialog.tsx`/`ConflictDialog.tsx`).
  const handleConfirm = (): void => {
    if (!validation.valid || targetGroup === undefined) return;
    actions.mergeGroups(sourceGroup.id, targetGroup.id);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Fusionar grupo">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">
          Fusionar{" "}
          <span className="font-medium text-text-primary">{sourceGroup.canonicalValue}</span> con
          otro grupo de tipo {ENTITY_TYPE_LABEL[sourceGroup.type]}. El resultante conserva el menor
          índice.
        </p>
        {targetOptions.length === 0 || targetGroupId === null ? (
          <p role="alert" className="text-sm text-error">
            No hay otros grupos de tipo {ENTITY_TYPE_LABEL[sourceGroup.type]} para fusionar.
          </p>
        ) : (
          <Select
            value={targetGroupId}
            onChange={setTargetGroupId}
            options={targetOptions.map((group) => ({
              value: group.id,
              label: `${group.canonicalValue} (${group.members.length})`,
            }))}
            aria-label="Grupo destino"
          />
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" disabled={!validation.valid} onClick={handleConfirm}>
          Fusionar
        </Button>
      </div>
    </Dialog>
  );
}
