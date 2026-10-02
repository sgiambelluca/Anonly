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
import { CheckIcon, InfoIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { applyConflictResolution } from "../entities/applyEdits.js";
import { ENTITY_TYPE_COLOR } from "../entities/entityTypeColors.js";
import { ENTITY_TYPE_SINGULAR } from "../entities/entityTypeLabels.js";
import { ConflictSymbol } from "../entities/warningSymbols.js";

import { CONFLICT_REASON_LABEL } from "./conflictLabels.js";
import { candidateTypes, defaultCandidate, spellingChoices } from "./conflictResolution.js";

export interface ConflictDialogProps {
  readonly conflictId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * El recorrido de "Resolver" (`conflictWalk.ts`): el contador "5/9" que va
   * junto al título. Sin recorrido —el ⚠ de una fila— no se muestra.
   */
  readonly progress?: string;
  /**
   * Qué hacer después de aplicar. Sin esto, se cierra. El recorrido lo usa
   * para pasar al conflicto siguiente sin cerrar el diálogo.
   */
  readonly onApplied?: () => void;
  /**
   * Pasar al conflicto siguiente sin aplicar nada: este queda pendiente. Solo
   * en el recorrido; sin esto no hay botón "Saltear".
   */
  readonly onSkip?: () => void;
}

export function ConflictDialog({
  conflictId,
  open,
  onClose,
  progress,
  onApplied,
  onSkip,
}: ConflictDialogProps) {
  const conflict = useEntitiesStore((state) =>
    state.conflicts.find((candidate) => candidate.id === conflictId),
  );
  // El grupo vigente, para marcar "Actual" la opción que ya está aplicada.
  const groupId = conflict?.groupId;
  const group = useEntitiesStore((state) => {
    if (groupId === undefined) return undefined;
    for (const groups of state.groupsByType.values()) {
      const found = groups.find((candidate) => candidate.id === groupId);
      if (found !== undefined) return found;
    }
    return undefined;
  });
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
    // Elegir la grafía y el tipo es una sola decisión: una entrada de la
    // pila de deshacer (ADR-172 §2). La grafía viaja por
    // `GroupUpdateRequested.patch.canonicalValue`, que existe desde siempre
    // (ADR-106 §2).
    applyConflictResolution({
      conflictId: conflict.id,
      groupId: conflict.groupId,
      spelling: hasSpellingChoice ? selectedSpelling : null,
      entityType: selectedType ?? undefined,
      label: value,
    });
    if (onApplied !== undefined) onApplied();
    else onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Revisar entidad"
      titleAside={
        progress !== undefined ? (
          <span
            aria-label={`Conflicto ${progress.replace("/", " de ")}`}
            className="text-sm tabular-nums text-text-secondary"
          >
            {progress}
          </span>
        ) : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {onSkip !== undefined ? (
            <Button variant="secondary" onClick={onSkip}>
              Saltear
            </Button>
          ) : null}
          <Button variant="primary" className="min-w-[6rem]" onClick={handleApply}>
            {hasChoice || hasSpellingChoice ? "Aplicar" : "Descartar"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-error/10 text-error">
            <ConflictSymbol />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <b className="break-words font-semibold text-text-primary">{value}</b>
            <span className="text-text-secondary">{CONFLICT_REASON_LABEL[conflict.reason]}</span>
          </div>
        </div>

        {hasSpellingChoice ? (
          <ChoiceGroup
            id={`conflict-spelling-${conflict.id}`}
            label="¿Cuál de estas escrituras usamos?"
          >
            {spellings.map((spelling) => (
              <ChoiceOption
                key={spelling}
                name={`conflict-spelling-${conflict.id}`}
                value={spelling}
                checked={selectedSpelling === spelling}
                isCurrent={group?.canonicalValue === spelling}
                onSelect={() => setSelectedSpelling(spelling)}
              >
                {spelling}
              </ChoiceOption>
            ))}
          </ChoiceGroup>
        ) : hasChoice ? (
          <ChoiceGroup id={`conflict-type-${conflict.id}`} label="¿Con qué se identifica?">
            {types.map((type) => (
              <ChoiceOption
                key={type}
                name={`conflict-type-${conflict.id}`}
                value={type}
                checked={selectedType === type}
                isCurrent={group?.type === type}
                dotColor={ENTITY_TYPE_COLOR[type]}
                onSelect={() => setSelectedType(type)}
              >
                {ENTITY_TYPE_SINGULAR[type]}
              </ChoiceOption>
            ))}
          </ChoiceGroup>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-text-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            No hay nada entre qué elegir: este aviso solo se puede descartar.
          </p>
        )}

        {conflict.resolved ? (
          <p className="flex items-center gap-1.5 text-success">
            <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />
            Ya revisado
            {conflict.resolvedType ? ` (${ENTITY_TYPE_SINGULAR[conflict.resolvedType]})` : ""}.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** La pregunta y sus opciones, en la misma caja gris de `EntityTypePicker`. */
function ChoiceGroup({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="font-semibold text-text-secondary">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg-tertiary p-1.5"
      >
        {children}
      </div>
    </div>
  );
}

function ChoiceOption({
  name,
  value,
  checked,
  isCurrent,
  dotColor,
  onSelect,
  children,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  /** La opción que ya está aplicada en el documento. */
  readonly isCurrent: boolean;
  readonly dotColor?: string;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <label
      className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
        checked
          ? "border-accent bg-bg-primary font-semibold ring-2 ring-accent/15"
          : "border-transparent hover:border-border hover:bg-bg-primary"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {dotColor !== undefined ? (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
      ) : null}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {isCurrent ? <span className="shrink-0 font-normal text-text-secondary">Actual</span> : null}
      <span
        aria-hidden
        className={`h-3.5 w-3.5 shrink-0 rounded-full ${
          checked ? "border-4 border-accent" : "border-[1.5px] border-text-secondary/60"
        }`}
      />
    </label>
  );
}
