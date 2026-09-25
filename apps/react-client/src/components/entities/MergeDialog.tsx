/**
 * `MergeDialog` — "Fusionar entidades" (`ui/Components.md` §3.6, rediseñado
 * por ADR-169 §10 con vistas previas de ADR-170).
 *
 * - La entidad de origen arriba.
 * - Una lista **de alto fijo** con filtro y casillas: se eligen **una o
 *   varias** entidades del mismo tipo de una vez (reemplaza a las filas de
 *   `Select` con "+ Agregar otro grupo").
 * - Una caja **"Resultado"** de alto fijo con nombre, N.º, apariciones y token
 *   del grupo que queda, calculada por el Core (`previewEdit({ kind: "merge"
 *   })`); sin selección, un texto neutro en la misma caja (UX-10).
 * - El botón dice cuántas quedan en una ("Fusionar 3 entidades"), con ancho
 *   mínimo fijo.
 *
 * **El contrato no cambia**: `GROUP_MERGE_REQUESTED` sigue siendo 1→1 y la UI
 * emite los pasos de `mergePlan`. La UI pone primero al elegido de menor
 * `indexInType`: el sobreviviente conserva el `id` del primero y el menor
 * número de todos (ADR-170 §2), así que el `id` que queda es el del número
 * que queda. Es seguro en fila porque `applyGroupMerge` corre síncrono.
 */

import type { EntityGroup } from "@anonly/anonymization-core";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { Dialog } from "../common/Dialog.js";

import { applyMerge } from "./applyEdits.js";
import {
  displayReplacement,
  mergeButtonLabel,
  mergePreviewRequest,
  mergeResult,
  mergeToastText,
  orderMergeTargets,
} from "./editPreviews.js";
import { EntityLine } from "./EntityLine.js";
import { filterGroups, findGroupById } from "./entityTree.js";
import { ENTITY_TYPE_LABEL, formatIndexInType } from "./entityTypeLabels.js";
import { mergePlan, mergeTargetOptions, validateMultiMerge } from "./mergeValidation.js";

export interface MergeDialogProps {
  readonly sourceGroupId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function MergeDialog({ sourceGroupId, open, onClose }: MergeDialogProps) {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const sourceGroup = findGroupById(groupsByType, sourceGroupId);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");

  // Reinicia la selección cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setFilter("");
  }, [open, sourceGroupId]);

  const candidates: ReadonlyArray<EntityGroup> = useMemo(
    () =>
      sourceGroup === undefined
        ? []
        : [...mergeTargetOptions(sourceGroup, groupsByType.get(sourceGroup.type) ?? [])].sort(
            (a, b) => a.indexInType - b.indexInType,
          ),
    [sourceGroup, groupsByType],
  );
  const selected = candidates.filter((group) => selectedIds.has(group.id));
  const visible = filterGroups(candidates, filter);

  // ADR-170 §2: la vista previa se pide al cambiar la selección (sincrónica).
  const preview = useMemo(() => {
    if (!open || sourceGroup === undefined) return null;
    const request = mergePreviewRequest(sourceGroup.id, selected);
    return request === null ? null : actions.previewEdit(request);
    // `selected` se deriva de `selectedIds` y `candidates`.
  }, [open, sourceGroup, selectedIds, candidates]);
  const result = mergeResult(preview);

  if (sourceGroup === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Fusionar entidades">
        <p className="text-sm text-text-secondary">Esta entidad ya no está disponible.</p>
      </Dialog>
    );
  }

  const validation = validateMultiMerge(sourceGroup, selected);
  // "personas", pero "DNI" y "CUIT" quedan en mayúsculas.
  const plural = ENTITY_TYPE_LABEL[sourceGroup.type];
  const typeLabel = plural === plural.toUpperCase() ? plural : plural.toLowerCase();

  function toggle(groupId: string, checked: boolean): void {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }

  // Arrow function: TypeScript preserva el narrowing de `sourceGroup` solo en
  // expresiones de función del mismo scope (mismo motivo en `SplitDialog`).
  const handleConfirm = (): void => {
    if (!validation.valid) return;
    const targets = orderMergeTargets(selected);
    const entityCount = selected.length + 1;
    const toast = result !== null ? mergeToastText(entityCount, result) : null;
    // Los N pedidos de `mergePlan` son una sola entrada de la pila (ADR-172 §2).
    applyMerge({
      steps: mergePlan(sourceGroup.id, targets),
      toast,
      historyLabel: toast?.title ?? `Fusionaste ${entityCount} entidades`,
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fusionar entidades"
      description="Juntá en una sola las entidades que son la misma persona o el mismo dato."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="min-w-[11rem]"
            disabled={!validation.valid}
            onClick={handleConfirm}
          >
            {mergeButtonLabel(selected.length)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-text-secondary">Entidad</span>
          <EntityLine
            group={{
              type: sourceGroup.type,
              canonicalValue: sourceGroup.canonicalValue,
              indexInType: sourceGroup.indexInType,
              memberCount: sourceGroup.members.length,
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span id="merge-with" className="font-semibold text-text-secondary">
              ¿Con cuál o cuáles la fusionás?
            </span>
            <label className="flex h-8 w-48 items-center gap-2 rounded-md border border-border bg-bg-primary px-2 focus-within:ring-2 focus-within:ring-accent">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={`Filtrar ${typeLabel}…`}
                aria-label={`Filtrar ${typeLabel}`}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none"
              />
            </label>
          </div>
          {/* Lista de alto fijo (UX-10). */}
          <div
            role="group"
            aria-labelledby="merge-with"
            className="flex h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-bg-secondary p-1"
          >
            {candidates.length === 0 ? (
              <p className="p-2 text-text-secondary">
                No hay otras entidades de tipo {ENTITY_TYPE_LABEL[sourceGroup.type]} para fusionar.
              </p>
            ) : visible.length === 0 ? (
              <p className="p-2 text-text-secondary">Ninguna coincide con el filtro.</p>
            ) : (
              visible.map((group) => (
                <div
                  key={group.id}
                  className={`rounded-md px-2 py-1.5 ${
                    selectedIds.has(group.id) ? "bg-accent/10" : "hover:bg-bg-primary"
                  }`}
                >
                  <Checkbox
                    id={`merge-${group.id}`}
                    checked={selectedIds.has(group.id)}
                    onCheckedChange={(checked) => toggle(group.id, checked)}
                    label={
                      <span className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span className="w-6 shrink-0 tabular-nums text-text-secondary">
                          {formatIndexInType(group.indexInType)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-primary">
                          {group.canonicalValue}
                        </span>
                        <span className="shrink-0 text-text-secondary">
                          {group.members.length === 1
                            ? "1 aparición"
                            : `${group.members.length} apariciones`}
                        </span>
                      </span>
                    }
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Caja "Resultado" de alto fijo (UX-10). */}
        <div
          aria-live="polite"
          className="flex h-[8.5rem] flex-col gap-2 rounded-lg border border-accent/35 bg-accent/5 px-3.5 py-3"
        >
          <span className="font-semibold text-text-primary">Resultado</span>
          {result !== null ? (
            <>
              <EntityLine group={result} token={displayReplacement(result)} />
              <span className="line-clamp-2 text-text-secondary">
                Se queda con el número más bajo y con el nombre que más se repite. Si te equivocás,
                podés dividirla después.
              </span>
            </>
          ) : (
            <span className="text-text-secondary">
              Elegí al menos una entidad para ver cómo queda.
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
