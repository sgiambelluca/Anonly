/**
 * `ConflictDialog` (`ui/Components.md` §6.2, `ui/UX_Guidelines.md` §6).
 *
 * Props: `conflictId` (+ `open`/`onClose` levantados al llamador, mismo
 * patrón que `MergeDialog`/`SplitDialog`). Muestra razón, candidatos y una
 * "resolución sugerida" informativa (`conflictResolution.ts`). Acción real:
 * `actions.resolveConflict(conflictId, mode)` con un `ReplacementMode`
 * elegido explícitamente — el flujo "Personalizado" de `UX_Guidelines.md` §6.
 *
 * Los botones de atajo "[Usar Regex]"/"[Usar NER]" del mockup de
 * `UX_Guidelines.md` §6 **no** se implementan acá: ver la nota de ambigüedad
 * en `conflictResolution.ts` (`ConflictResolveRequested.mode` es un
 * `ReplacementMode`, no un selector de fuente/candidato — no hay forma de
 * expresar "ganó Regex" con el contrato actual).
 */

import { ReplacementMode } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Select } from "../common/Select.js";
import { REPLACEMENT_MODE_OPTIONS } from "../entities/replacementModeOptions.js";

import { CONFLICT_REASON_LABEL, DETECTION_SOURCE_LABEL } from "./conflictLabels.js";
import { suggestedCandidate } from "./conflictResolution.js";

export interface ConflictDialogProps {
  readonly conflictId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ConflictDialog({ conflictId, open, onClose }: ConflictDialogProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.id === conflictId),
  );
  const [mode, setMode] = useState<ReplacementMode>(ReplacementMode.Placeholder);

  useEffect(() => {
    if (open) setMode(ReplacementMode.Placeholder);
  }, [open, conflictId]);

  if (conflict === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Conflicto">
        <p className="text-sm text-text-secondary">Este conflicto ya no está disponible.</p>
      </Dialog>
    );
  }

  const suggested = suggestedCandidate(conflict);

  // Arrow function, no `function` declaration: preserva el narrowing de
  // `conflict` (por el `if` de arriba) — ver la nota equivalente en
  // `entities/MergeDialog.tsx`.
  const handleApply = (): void => {
    actions.resolveConflict(conflict.id, mode);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Conflicto #${conflict.id}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <span className="font-medium text-text-primary">Tipo:</span>{" "}
          <span className="text-text-secondary">{CONFLICT_REASON_LABEL[conflict.reason]}</span>
        </p>
        <div>
          <p className="mb-1 font-medium text-text-primary">Candidatos</p>
          <ul className="flex flex-col gap-1">
            {conflict.candidates.map((candidate, index) => (
              <li key={index} className="text-xs text-text-secondary">
                <span className="font-medium text-text-primary">
                  {DETECTION_SOURCE_LABEL[candidate.source]}
                </span>
                : {candidate.entityType} (confidence {candidate.confidence.toFixed(2)}) → &quot;
                {candidate.value}&quot;
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-text-secondary">
          Resolución sugerida: {DETECTION_SOURCE_LABEL[suggested.source]} ({suggested.entityType},
          confidence {suggested.confidence.toFixed(2)})
        </p>
        {conflict.resolved ? (
          <p className="text-xs text-success">
            Ya resuelto{conflict.resolvedMode ? ` (modo: ${conflict.resolvedMode})` : ""}.
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">
            Modo de reemplazo (Personalizado)
          </span>
          <Select
            value={mode}
            onChange={setMode}
            options={REPLACEMENT_MODE_OPTIONS}
            aria-label="Modo de reemplazo para este conflicto"
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Aplicar
        </Button>
      </div>
    </Dialog>
  );
}
