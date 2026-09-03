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
 *
 * **Varios destinos a la vez**: `UX_Guidelines.md` §3.2 pide "2+ grupos del
 * mismo tipo" desde siempre, y el diálogo resolvía uno solo — cuatro grupos de
 * la misma persona eran tres pasadas por este mismo modal, cada una con su
 * confirmación. El botón "+" agrega una fila de destino; la fusión sale como
 * los N-1 `GROUP_MERGE_REQUESTED` que arma `mergePlan` (ahí está por qué es
 * seguro emitirlos en fila). El Core no cambia.
 */

import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select } from "../common/Select.js";

import { findGroupById } from "./entityTree.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import {
  availableTargetOptions,
  mergePlan,
  mergeTargetOptions,
  validateMultiMerge,
} from "./mergeValidation.js";

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

  // Una entrada por fila de destino. La primera es la que sobrevive a la
  // fusión (`mergePlan`), y por eso el orden importa y no se reordena.
  const [targetGroupIds, setTargetGroupIds] = useState<ReadonlyArray<string>>(() =>
    targetOptions[0] ? [targetOptions[0].id] : [],
  );

  // Reinicia la selección cada vez que se abre (mismo criterio que
  // `SettingsDialog`: "re-sincroniza el formulario ... cada vez que se abre").
  useEffect(() => {
    if (!open) return;
    setTargetGroupIds(targetOptions[0] ? [targetOptions[0].id] : []);
    // Deps acotadas a propósito a `[open, sourceGroupId]` (sin `targetOptions`,
    // que es un array nuevo en cada render): mismo criterio que
    // `viewer/PdfViewer.tsx` — el repo no tiene `eslint-plugin-react-hooks`
    // que exija la lista exhaustiva.
  }, [open, sourceGroupId]);

  /*
   * Siembra la primera fila si los grupos hermanos aparecen **con el diálogo ya
   * abierto**.
   *
   * Sin esto, abrir "Fusionar con…" sobre el primer `Person` que encuentra NER
   * —mientras el resto todavía está llegando— deja el modal diciendo "no hay
   * otros grupos para fusionar" hasta cerrarlo y volver a abrirlo, aunque
   * atrás el árbol ya muestre tres. Es el efecto de arriba, que solo corre al
   * abrir: con un análisis en curso esa foto dura poco. Comportamiento
   * heredado (el diálogo de un solo destino hacía exactamente lo mismo), no
   * una regresión de la fusión múltiple.
   *
   * Solo rellena cuando está vacío: nunca pisa lo que el usuario eligió.
   */
  useEffect(() => {
    if (!open) return;
    setTargetGroupIds((current) =>
      current.length > 0 || targetOptions[0] === undefined ? current : [targetOptions[0].id],
    );
  }, [open, targetOptions.length]);

  if (sourceGroup === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Fusionar grupo">
        <p className="text-sm text-text-secondary">Este grupo ya no está disponible.</p>
      </Dialog>
    );
  }

  const selectedGroups = targetGroupIds.map((id) => targetOptions.find((group) => group.id === id));
  const validation = validateMultiMerge(sourceGroup, selectedGroups);
  const remaining = availableTargetOptions(sourceGroup, targetOptions, targetGroupIds);

  const setRow = (index: number, value: string): void => {
    setTargetGroupIds((current) => current.map((id, i) => (i === index ? value : id)));
  };

  const addRow = (): void => {
    const next = remaining[0];
    if (next === undefined) return;
    setTargetGroupIds((current) => [...current, next.id]);
  };

  const removeRow = (index: number): void => {
    setTargetGroupIds((current) => current.filter((_, i) => i !== index));
  };

  // Arrow function (no `function` declaration): TypeScript solo preserva el
  // narrowing de `sourceGroup` (por el `if` de arriba) dentro de expresiones de
  // función definidas en el mismo scope, no de declaraciones `function`
  // (hoisting — mismo motivo en `SplitDialog.tsx`/`ConflictDialog.tsx`).
  const handleConfirm = (): void => {
    if (!validation.valid) return;
    for (const step of mergePlan(sourceGroup.id, targetGroupIds)) {
      actions.mergeGroups(step.sourceGroupId, step.targetGroupId);
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Fusionar grupo">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">
          Fusionar{" "}
          <span className="font-medium text-text-primary">{sourceGroup.canonicalValue}</span> con{" "}
          {targetGroupIds.length > 1 ? `${String(targetGroupIds.length)} grupos` : "otro grupo"} de
          tipo {ENTITY_TYPE_LABEL[sourceGroup.type]}. Queda un solo grupo, y conserva el menor
          índice.
        </p>
        {targetOptions.length === 0 || targetGroupIds.length === 0 ? (
          <p role="alert" className="text-sm text-error">
            No hay otros grupos de tipo {ENTITY_TYPE_LABEL[sourceGroup.type]} para fusionar.
          </p>
        ) : (
          <>
            {targetGroupIds.map((id, index) => (
              <div key={id} className="flex items-center gap-2">
                <Select
                  value={id}
                  onChange={(value) => setRow(index, value)}
                  options={availableTargetOptions(
                    sourceGroup,
                    targetOptions,
                    targetGroupIds,
                    id,
                  ).map((group) => ({
                    value: group.id,
                    label: `${group.canonicalValue} (${group.members.length})`,
                  }))}
                  aria-label={`Grupo destino ${index + 1}`}
                />
                {/*
                  La primera fila no se puede quitar: es el grupo que sobrevive
                  a la fusión, y sin ella no hay nada contra qué fusionar.
                */}
                {index > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar grupo destino ${index + 1}`}
                    onClick={() => removeRow(index)}
                  >
                    <XIcon className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={remaining.length === 0}
                onClick={addRow}
              >
                <span className="inline-flex items-center gap-1">
                  <PlusIcon className="h-4 w-4" aria-hidden />
                  Agregar otro grupo
                </span>
              </Button>
            </div>
          </>
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
