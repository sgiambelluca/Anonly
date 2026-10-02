/**
 * `SplitDialog` — "Dividir entidad" (`ui/Components.md` §3.7, rediseñado por
 * ADR-169 §10 con la vista previa de ADR-170).
 *
 * - La entidad arriba.
 * - Cada aparición con su página, la frase alrededor con el valor tal como
 *   aparece (ADR-104, ADR-105) y su origen (*Detectado / Agregado por vos*),
 *   con una casilla: las marcadas pasan a una entidad nueva.
 * - Dos tarjetas **"Se quedan en N.º 02"** → **"Pasan a una nueva: Persona
 *   N.º NN"** con los conteos al día; el N.º nuevo lo calcula el Core
 *   (`previewEdit({ kind: "split" })`).
 * - Una ranura de alto fijo con la nota, o —si se marcaron todas— el error
 *   "Tiene que quedar al menos una aparición en N.º 02" en el mismo lugar
 *   (UX-10).
 *
 * Acción: `applySplit` → `actions.splitGroup(groupId, selectedOccurrenceIds)` →
 * `GROUP_SPLIT_REQUESTED`.
 */

import { DetectionSource } from "@anonly/anonymization-core";
import { ArrowRightIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { Dialog } from "../common/Dialog.js";
import { DETECTION_SOURCE_LABEL } from "../conflicts/conflictLabels.js";

import { applySplit } from "./applyEdits.js";
import {
  splitPreviewRequest,
  splitSlotMessage,
  splitToastText,
  summarizeSplit,
} from "./editPreviews.js";
import { EntityLine } from "./EntityLine.js";
import { findGroupById } from "./entityTree.js";
import { ENTITY_TYPE_COLOR } from "./entityTypeColors.js";
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

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const preview = useMemo(() => {
    if (!open || group === undefined) return null;
    const request = splitPreviewRequest(group, selectedIds);
    return request === null ? null : actions.previewEdit(request);
  }, [open, group, selectedIds]);

  if (group === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Dividir entidad">
        <p className="text-sm text-text-secondary">Esta entidad ya no está disponible.</p>
      </Dialog>
    );
  }

  const validation = validateSplit(group, selectedIds);
  const summary = summarizeSplit(group, selectedIds.length, preview);
  const slot = splitSlotMessage(group, selectedIds.length);
  const color = ENTITY_TYPE_COLOR[group.type];

  function toggleMember(occurrenceId: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(occurrenceId);
      else next.delete(occurrenceId);
      return next;
    });
  }

  // Arrow function, no `function` declaration: preserva el narrowing de
  // `group` (por el `if` de arriba).
  const handleConfirm = (): void => {
    if (!validation.valid) return;
    const created = preview?.groups.find((candidate) => candidate.groupId === null);
    const moved = selectedIds.length;
    applySplit({
      group,
      occurrenceIds: selectedIds,
      toast: splitToastText(group.canonicalValue, moved, created),
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dividir entidad"
      description="Separá las apariciones que en realidad son otra persona u otro dato."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="min-w-[6rem]"
            disabled={!validation.valid}
            onClick={handleConfirm}
          >
            Dividir
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <EntityLine
          group={{
            type: group.type,
            canonicalValue: group.canonicalValue,
            indexInType: group.indexInType,
            memberCount: group.members.length,
          }}
        />

        <div className="flex flex-col gap-1.5">
          <span id="split-list" className="font-semibold text-text-secondary">
            Marcá las que pasan a una entidad nueva
          </span>
          <ul
            aria-labelledby="split-list"
            className="flex h-52 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-bg-secondary p-1"
          >
            {group.members.map((member) => (
              <li
                key={member.occurrenceId}
                className={`rounded-md px-2 py-1.5 ${
                  selected.has(member.occurrenceId) ? "bg-accent/10" : "hover:bg-bg-primary"
                }`}
              >
                <Checkbox
                  id={`split-${member.occurrenceId}`}
                  checked={selected.has(member.occurrenceId)}
                  onCheckedChange={(checked) => toggleMember(member.occurrenceId, checked)}
                  // El nombre accesible conserva la forma que localiza el E2E
                  // (`scenario-10`): página y origen.
                  aria-label={`Página ${member.pageIndex + 1} — ${DETECTION_SOURCE_LABEL[member.source]}: ${member.value}`}
                  label={
                    <span className="flex min-w-0 flex-1 items-start gap-2.5">
                      <span className="w-12 shrink-0 font-semibold tabular-nums text-text-secondary">
                        Pág. {member.pageIndex + 1}
                      </span>
                      {/*
                        ADR-104/ADR-105: el valor tal cual aparece y la frase
                        alrededor — lo único que distingue dos apariciones del
                        mismo texto.
                      */}
                      <span className="min-w-0 flex-1 text-text-secondary">
                        {member.context ? <span>…{member.context.before}</span> : null}
                        <b className="font-semibold text-text-primary">{member.value}</b>
                        {member.context ? <span>{member.context.after}…</span> : null}
                      </span>
                      <span className="shrink-0 rounded-md bg-bg-tertiary px-1.5 text-text-secondary">
                        {member.source === DetectionSource.Manual
                          ? "Agregado por vos"
                          : "Detectado"}
                      </span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <SplitCard
            caption="Se quedan en"
            label={summary.stayLabel}
            count={summary.stayCount}
            color={color}
          />
          <ArrowRightIcon className="h-4 w-4 text-text-secondary" aria-hidden />
          <SplitCard
            caption="Pasan a una nueva"
            label={summary.moveLabel}
            count={summary.moveCount}
            color={color}
          />
        </div>

        {/* La nota y el error comparten una ranura de alto fijo (UX-10). */}
        <div
          aria-live="polite"
          role={slot.kind === "error" ? "alert" : undefined}
          className={`flex h-12 items-start gap-2 rounded-lg border px-3 py-2 leading-snug ${
            slot.kind === "error"
              ? "border-error bg-error/10 font-medium text-error"
              : "border-border bg-bg-secondary text-text-secondary"
          }`}
        >
          {slot.kind === "error" ? (
            <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span className="line-clamp-2">{slot.text}</span>
        </div>
      </div>
    </Dialog>
  );
}

function SplitCard({
  caption,
  label,
  count,
  color,
}: {
  readonly caption: string;
  readonly label: string;
  readonly count: number;
  readonly color: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg-primary px-3 py-2.5">
      <span className="text-text-secondary">{caption}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <b className="truncate font-semibold text-text-primary">{label}</b>
      </span>
      <span className="tabular-nums text-text-primary">
        {count}{" "}
        <span className="text-text-secondary">{count === 1 ? "aparición" : "apariciones"}</span>
      </span>
    </div>
  );
}
