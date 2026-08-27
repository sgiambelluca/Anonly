/**
 * `SplitDialog` (`ui/Components.md` §3.7).
 *
 * Props del catálogo: `groupId` (+ `open`/`onClose` levantados al llamador,
 * mismo patrón que `MergeDialog`). Lista de `members` (`OccurrenceRef[]`) con
 * checkbox + "bbox miniatura" (`ui/UX_Guidelines.md` §5.1 menciona el mismo
 * concepto para el phantom de página: acá es un rectángulo proporcional al
 * `bbox.width`/`bbox.height` de la ocurrencia — no hay dimensiones de página
 * disponibles en este componente para posicionarlo dentro de la hoja real, así
 * que la miniatura es solo de proporción, no de posición absoluta).
 *
 * Acción: `actions.splitGroup(groupId, selectedOccurrenceIds)` →
 * `GROUP_SPLIT_REQUESTED`. El feedback de toast ("Grupo dividido. Nuevo
 * grupo: <type> <NN>.") queda fuera de este PR — mismo motivo que
 * `MergeDialog` (sin componente `Toast` implementado todavía).
 */

import type { BoundingBox } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { Dialog } from "../common/Dialog.js";
import { DETECTION_SOURCE_LABEL } from "../conflicts/conflictLabels.js";

import { findGroupById } from "./entityTree.js";
import { validateSplit } from "./splitValidation.js";

export interface SplitDialogProps {
  readonly groupId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function SplitDialog({ groupId, open, onClose }: SplitDialogProps) {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const group = findGroupById(groupsByType, groupId);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open, groupId]);

  if (group === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Dividir grupo">
        <p className="text-sm text-text-secondary">Este grupo ya no está disponible.</p>
      </Dialog>
    );
  }

  const selectedIds = Array.from(selected);
  const validation = validateSplit(group, selectedIds);

  function toggleMember(occurrenceId: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(occurrenceId);
      else next.delete(occurrenceId);
      return next;
    });
  }

  // Arrow function, no `function` declaration: preserva el narrowing de
  // `group` (por el `if` de arriba) — ver la nota equivalente en
  // `MergeDialog.tsx`.
  const handleConfirm = (): void => {
    if (!validation.valid) return;
    actions.splitGroup(group.id, selectedIds);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Dividir grupo">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">
          Seleccioná las ocurrencias de{" "}
          <span className="font-medium text-text-primary">{group.canonicalValue}</span> que van a un
          grupo nuevo.
        </p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {group.members.map((member) => (
            <li key={member.occurrenceId}>
              <Checkbox
                id={`split-${member.occurrenceId}`}
                checked={selected.has(member.occurrenceId)}
                onCheckedChange={(checked) => toggleMember(member.occurrenceId, checked)}
                label={
                  <span className="flex items-center gap-2 text-sm text-text-secondary">
                    <BboxMiniature bbox={member.bbox} />
                    {/*
                      ADR-104: el valor **tal cual aparece en el documento**.
                      Sin esto el diálogo era circular — existe para deshacer
                      una fusión y no mostraba qué se había fusionado: dos
                      miembros solo se distinguían por la página, y si caían
                      en la misma, por nada.
                    */}
                    <span className="font-medium text-text-primary">{member.value}</span>
                    <span className="text-text-secondary">
                      Página {member.pageIndex + 1} — {DETECTION_SOURCE_LABEL[member.source]}
                    </span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
        {!validation.valid ? (
          <p role="alert" className="text-sm text-error">
            {validation.reason}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" disabled={!validation.valid} onClick={handleConfirm}>
          Dividir
        </Button>
      </div>
    </Dialog>
  );
}

const BBOX_MINIATURE_MAX_PX = 20;
const BBOX_MINIATURE_MIN_PX = 2;

/** Rectángulo proporcional al aspect-ratio de `bbox` (ver nota de alcance arriba). */
function BboxMiniature({ bbox }: { readonly bbox: BoundingBox }) {
  const largestSide = Math.max(bbox.width, bbox.height, 1);
  const scale = BBOX_MINIATURE_MAX_PX / largestSide;
  const width = Math.max(BBOX_MINIATURE_MIN_PX, Math.round(bbox.width * scale));
  const height = Math.max(BBOX_MINIATURE_MIN_PX, Math.round(bbox.height * scale));
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 border border-accent bg-accent/20"
      style={{ width, height }}
    />
  );
}
