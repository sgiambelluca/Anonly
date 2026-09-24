/**
 * `ManualOverlapDialog` (`ui/Components.md` §6.3, ADR-174).
 *
 * **Cuándo se abre**: solo, después de un agregado manual (cualquiera de las
 * tres vías) cuyo resultado trae `heldConflictIds`
 * (`addManualEntity.ts` → `manualOverlapController.ts` →
 * `ManualOverlapDialogHost`); y desde el aviso ⚠ de una fila cuando su
 * conflicto tiene `heldManual` (`ConflictBadge`, en vez de `ConflictDialog`).
 *
 * **No nombra a Regex ni a NER** (mismo criterio que `ConflictDialog`,
 * ADR-083 §6): el candidato retenido se presenta como "lo que marcaste" y el
 * otro como "lo que ya estaba detectado", nunca por su `DetectionSource`.
 *
 * **Cerrar sin elegir** (el `[x]`, Escape o el backdrop — no hay "Cancelar"
 * en el pie, solo las dos decisiones) deja un toast de advertencia
 * persistente con "Resolver", que reabre este mismo diálogo
 * (`manualOverlapController.ts`). El conflicto sigue bloqueando el export
 * (`03_Data_Model.md` §15) hasta que se elige.
 */

import type { EntityType } from "@anonly/anonymization-core";
import { useEffect, useRef } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { showToast } from "../common/toast.js";
import { applyManualOverlapResolution } from "../entities/applyEdits.js";
import { ENTITY_TYPE_SINGULAR } from "../entities/entityTypeLabels.js";

import { manualOverlapCandidates } from "./conflictResolution.js";
import { openManualOverlapDialog } from "./manualOverlapController.js";

export interface ManualOverlapDialogProps {
  readonly conflictId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ManualOverlapDialog({ conflictId, open, onClose }: ManualOverlapDialogProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.id === conflictId),
  );
  // Distingue "cerró habiendo elegido" (los dos botones ya llamaron a
  // `onClose` ellos mismos) de "cerró sin elegir" ([x], Escape, backdrop):
  // solo el segundo caso deja el toast de advertencia persistente.
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (open) resolvedRef.current = false;
  }, [open, conflictId]);

  function handleClose(): void {
    if (!resolvedRef.current && conflict !== undefined && !conflict.resolved) {
      const value = manualOverlapCandidates(conflict)?.manual.value ?? "";
      showToast({
        title: `Quedó un choque sin resolver en «${value}»`,
        description: "El export está bloqueado hasta que elijas.",
        tone: "warning",
        persistent: true,
        actions: [{ label: "Resolver", run: () => openManualOverlapDialog(conflictId) }],
      });
    }
    onClose();
  }

  function choose(winner: "manual" | "detected", value: string): void {
    resolvedRef.current = true;
    applyManualOverlapResolution({ conflictId, winner, value });
    onClose();
  }

  if (conflict === undefined) {
    return (
      <Dialog open={open} onClose={handleClose} title="Choque resuelto">
        <p className="text-sm text-text-secondary">Este choque ya no está disponible.</p>
      </Dialog>
    );
  }

  const candidates = manualOverlapCandidates(conflict);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Se superpone con una detección"
      description="Lo que marcaste se superpone con un dato ya detectado. ¿Qué querés ocultar?"
      footer={
        candidates !== null ? (
          <div className="flex flex-wrap justify-end gap-2.5">
            <Button
              variant="secondary"
              className="w-64"
              onClick={() => choose("detected", candidates.manual.value)}
            >
              Dejar lo que ya estaba detectado
            </Button>
            <Button
              variant="primary"
              className="w-64"
              onClick={() => choose("manual", candidates.manual.value)}
            >
              Ocultar lo que marqué
            </Button>
          </div>
        ) : undefined
      }
    >
      {candidates !== null ? (
        <div className="flex flex-col gap-3 text-sm">
          <CandidateCard
            label="Lo que marcaste"
            value={candidates.manual.value}
            type={candidates.manual.entityType}
          />
          <CandidateCard
            label="Lo que ya estaba detectado"
            value={candidates.detected.value}
            type={candidates.detected.entityType}
          />
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
