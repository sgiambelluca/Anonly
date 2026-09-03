/**
 * `ConflictDialog` (`ui/Components.md` §6.2, `ui/UX_Guidelines.md` §6).
 *
 * **ADR-083**: el usuario elige con qué **tipo de entidad** se identifica el
 * valor en disputa, no un modo de reemplazo. Un conflicto es un desacuerdo
 * sobre *qué es* la entidad ("Fiscalía de Quilmes": ¿Organización o
 * Localidad?); el modo de reemplazo se elige en el `ReplacementModeSelect` de
 * la propia fila del grupo y no tenía por qué pedirse acá.
 *
 * Hasta ADR-083 este diálogo mostraba los candidatos por **fuente** ("Regex
 * dice X, NER dice Y") y aplicaba un `ReplacementMode`. Eso tenía dos
 * problemas: le pedía al usuario conocer detalles de implementación del
 * pipeline, y —lo grave— **no resolvía el desacuerdo**: `applyConflictResolve`
 * no tocaba el `entityType`, así que el usuario apretaba "Aplicar" y la
 * discrepancia quedaba igual.
 *
 * Sin `entityType`, el motor aplica el default (mayor `confidence`, empate a
 * Regex) — que coincide con la resolución automática ya vigente, así que
 * confirmar no cambia datos. Ver `conflictResolution.ts`.
 */

import { ConflictReason, type EntityType } from "@anonly/anonymization-core";
import { useEffect, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";

import { CONFLICT_REASON_LABEL } from "./conflictLabels.js";
import { candidateTypes, defaultCandidate, spellingChoices } from "./conflictResolution.js";

export interface ConflictDialogProps {
  readonly conflictId: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ConflictDialog({ conflictId, open, onClose }: ConflictDialogProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.id === conflictId),
  );
  const [selectedType, setSelectedType] = useState<EntityType | null>(null);
  const [selectedSpelling, setSelectedSpelling] = useState<string | null>(null);

  // El default se recalcula al abrir: es el candidato de mayor confidence, o
  // sea el tipo que el motor ya aplicó (ADR-083 §4).
  useEffect(() => {
    if (!open) return;
    // Se lee del store por `getState()` en vez de depender de `conflict`: ese
    // objeto cambia de identidad con cualquier update del store, y tenerlo en
    // las dependencias hacía que el efecto volviera a correr y **pisara la
    // selección en curso del usuario** mientras el diálogo está abierto.
    const current = useEntitiesStore
      .getState()
      .conflicts.find((candidate) => candidate.id === conflictId);
    if (current === undefined) return;
    setSelectedType(defaultCandidate(current).entityType);
    // ADR-106: preselecciona la escritura vigente, para que aplicar sin tocar
    // nada no cambie el valor canónico.
    setSelectedSpelling(
      useEntitiesStore
        .getState()
        .groupsByType.get(defaultCandidate(current).entityType)
        ?.find((group) => group.id === current.groupId)?.canonicalValue ??
        spellingChoices(current)[0] ??
        null,
    );
  }, [open, conflictId]);

  if (conflict === undefined) {
    return (
      <Dialog open={open} onClose={onClose} title="Conflicto">
        <p className="text-sm text-text-secondary">Este conflicto ya no está disponible.</p>
      </Dialog>
    );
  }

  const types = candidateTypes(conflict);
  const value = conflict.candidates[0]?.value ?? "";
  /*
   * ADR-106: dos conflictos distintos piden preguntas distintas.
   *
   * `ambiguous_canonical` es un empate de **escritura**: el motor no pudo
   * desempatar dos formas del mismo valor —misma frecuencia, misma longitud—
   * y eligió la primera. Todos sus candidatos comparten tipo, así que sobre el
   * eje de la clasificación no hay nada que elegir; sobre el eje del VALOR sí,
   * y es justo lo que el usuario quiere decidir.
   *
   * ADR-083 §6 los metía a los dos en la misma bolsa ("no hay elección"), que
   * era cierto solo para el eje que ese ADR miraba.
   */
  const spellings = spellingChoices(conflict);
  const hasSpellingChoice =
    conflict.reason === ConflictReason.AmbiguousCanonical && spellings.length > 1;
  // Un solo tipo entre los candidatos ⇒ no hay clasificación en disputa
  // (`low_confidence`, ADR-083 §5): solo se descarta.
  const hasChoice = types.length > 1;

  // Arrow function, no `function` declaration: preserva el narrowing de
  // `conflict` (por el `if` de arriba) — ver la nota equivalente en
  // `entities/MergeDialog.tsx`.
  const handleApply = (): void => {
    if (hasSpellingChoice && selectedSpelling !== null) {
      // El mecanismo ya existía: `canonicalValue` está en
      // `GroupUpdateRequested.patch` desde siempre (ADR-106 §2).
      actions.updateGroup(conflict.groupId, { canonicalValue: selectedSpelling });
    }
    actions.resolveConflict(conflict.id, selectedType ?? undefined);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Revisar entidad">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-primary">
          <span className="font-medium">&quot;{value}&quot;</span>
        </p>
        <p className="text-sm text-text-secondary">{CONFLICT_REASON_LABEL[conflict.reason]}</p>

        {hasSpellingChoice ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-text-secondary">
              ¿Cuál de estas escrituras usamos?
            </legend>
            {spellings.map((spelling) => (
              <label key={spelling} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name={`conflict-spelling-${conflict.id}`}
                  value={spelling}
                  checked={selectedSpelling === spelling}
                  onChange={() => setSelectedSpelling(spelling)}
                />
                {spelling}
              </label>
            ))}
          </fieldset>
        ) : hasChoice ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-text-secondary">
              ¿Con qué se identifica?
            </legend>
            {types.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name={`conflict-type-${conflict.id}`}
                  value={type}
                  checked={selectedType === type}
                  onChange={() => setSelectedType(type)}
                />
                {ENTITY_TYPE_LABEL[type]}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-text-secondary">
            No hay nada entre qué elegir: este aviso solo se puede descartar.
          </p>
        )}

        {conflict.resolved ? (
          <p className="text-sm text-success">
            Ya revisado
            {conflict.resolvedType ? ` (${ENTITY_TYPE_LABEL[conflict.resolvedType]})` : ""}.
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button variant="primary" onClick={handleApply}>
          {hasChoice ? "Aplicar" : "Descartar"}
        </Button>
      </div>
    </Dialog>
  );
}
