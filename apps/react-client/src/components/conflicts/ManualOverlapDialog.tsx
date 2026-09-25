/**
 * `ManualOverlapDialog` (`ui/Components.md` §6.3, ADR-174 §4, ADR-175 §4).
 *
 * **Cuándo se abre**: solo, después de un agregado manual (cualquiera de las
 * tres vías) cuyo resultado trae `heldConflictIds` (con **todos**, ADR-175
 * §4) (`addManualEntity.ts` → `manualOverlapController.ts` →
 * `ManualOverlapDialogHost`); desde el ⚠ de una fila, con los conflictos
 * `heldManual` sin resolver de **esa** fila (`ConflictBadge`, en vez de
 * `ConflictDialog`); y desde "Resolver" del aviso persistente, con los de la
 * primera fila de la lista que tenga uno (`ManualOverlapDialogHost`,
 * `manualOverlapWarning.ts`).
 *
 * **Una decisión para todos** (ADR-175 §4): un solo par de botones resuelve
 * los `conflictIds` completos, con el mismo `winner`, en **una sola** entrada
 * de deshacer (`applyManualOverlapResolution`). Con uno, el copy es singular;
 * con más, plural — "el primer par" y "y N−1 lugares más".
 *
 * **No nombra a Regex ni a NER** (mismo criterio que `ConflictDialog`,
 * ADR-083 §6): el candidato retenido se presenta como "lo que marcaste" y el
 * otro como "lo que ya estaba detectado", nunca por su `DetectionSource`.
 *
 * **Ya resuelto** (ADR-175 §4): si todos los conflictos de `conflictIds`
 * quedan resueltos —por estos botones o por otro camino, p. ej. ADR-175 §1 al
 * eliminar la detección mientras el diálogo está abierto— el diálogo se
 * cierra solo (`onClose`), sin pila ni toast propios. El diálogo **no**
 * decide el aviso de advertencia: ese es un estado aparte
 * (`ManualOverlapDialogHost`, ADR-175 §5) que mira si este diálogo está
 * cerrado y si queda algo pendiente en cualquier lado — no si ESTE cierre en
 * particular vino de "elegir" o de "abandonar".
 */

import type { Conflict, EntityType } from "@anonly/anonymization-core";
import { useEffect } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { applyManualOverlapResolution } from "../entities/applyEdits.js";
import { ENTITY_TYPE_SINGULAR } from "../entities/entityTypeLabels.js";

import { manualOverlapCandidates } from "./conflictResolution.js";

export interface ManualOverlapDialogProps {
  readonly conflictIds: ReadonlyArray<string>;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ManualOverlapDialog({ conflictIds, open, onClose }: ManualOverlapDialogProps) {
  const conflicts = useEntitiesStore((state) =>
    conflictIds
      .map((id) => state.conflicts.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Conflict => candidate !== undefined),
  );
  const unresolved = conflicts.filter((conflict) => !conflict.resolved);

  // ADR-175 §4: nada que elegir → se cierra solo, sin pila ni toast. Cubre
  // tanto "ya estaba todo resuelto al abrirse" (conflictIds vacío o todos ya
  // `resolved`) como "se resolvió mientras estaba abierto".
  useEffect(() => {
    if (open && unresolved.length === 0) onClose();
  }, [open, unresolved.length, onClose]);

  function choose(winner: "manual" | "detected", value: string): void {
    applyManualOverlapResolution({
      conflictIds: unresolved.map((conflict) => conflict.id),
      winner,
      value,
    });
    onClose();
  }

  if (unresolved.length === 0) return null;

  const pairs = unresolved
    .map((conflict) => manualOverlapCandidates(conflict))
    .filter((pair): pair is NonNullable<typeof pair> => pair !== null);
  const first = pairs[0];
  const count = unresolved.length;
  const extra = count - 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Se superpone con una detección"
      description={
        count === 1
          ? "Lo que marcaste se superpone con un dato ya detectado. ¿Qué querés ocultar?"
          : `Lo que marcaste se superpone con datos ya detectados en ${count} lugares. ¿Qué querés ocultar?`
      }
      footer={
        first !== undefined ? (
          <div className="flex flex-wrap justify-end gap-2.5">
            <Button
              variant="secondary"
              className="w-64"
              onClick={() => choose("detected", first.manual.value)}
            >
              Dejar lo que ya estaba detectado
            </Button>
            <Button
              variant="primary"
              className="w-64"
              onClick={() => choose("manual", first.manual.value)}
            >
              Ocultar lo que marqué
            </Button>
          </div>
        ) : undefined
      }
    >
      {first !== undefined ? (
        <div className="flex flex-col gap-3 text-sm">
          <CandidateCard
            label="Lo que marcaste"
            value={first.manual.value}
            type={first.manual.entityType}
          />
          <CandidateCard
            label="Lo que ya estaba detectado"
            value={first.detected.value}
            type={first.detected.entityType}
          />
          {/* Copy literal de ADR-175 §4: "y N−1 lugares más", plural fijo. */}
          {extra > 0 ? <p className="text-text-secondary">y {extra} lugares más</p> : null}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          No se pudo leer este choque: le falta uno de los dos candidatos.
        </p>
      )}
    </Dialog>
  );
}

function CandidateCard({
  label,
  value,
  type,
}: {
  readonly label: string;
  readonly value: string;
  readonly type: EntityType;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 font-medium text-text-primary">«{value}»</p>
      <p className="text-text-secondary">{ENTITY_TYPE_SINGULAR[type]}</p>
    </div>
  );
}
