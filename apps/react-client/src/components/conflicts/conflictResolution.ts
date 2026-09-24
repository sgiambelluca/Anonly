/**
 * `conflictResolution.ts` — cómputo puro de lo que `ConflictDialog` necesita
 * decidir (ADR-083): qué **tipos de entidad** ofrecer, y cuál viene
 * preseleccionado.
 *
 * Hasta ADR-083 este módulo calculaba un "candidato sugerido" que el diálogo
 * mostraba como texto informativo, mientras la acción real elegía un
 * `ReplacementMode` — o sea que lo que se sugería y lo que se aplicaba no
 * tenían nada que ver entre sí. Ahora el diálogo elige el tipo, y esto es lo
 * que lo alimenta.
 *
 * El default replica la política del motor (`06_Pipeline.md` §9, ADR-083 §4):
 * gana el de mayor `confidence`, empate a favor de `regex`. Como
 * `regex-engine` emite siempre `confidence: 1.0`, eso coincide con la
 * resolución automática que el motor ya aplicó — el diálogo confirma o
 * contradice, nunca muestra un default distinto del que está vigente.
 */

import { DetectionSource } from "@anonly/anonymization-core";
import type { Conflict, ConflictCandidate, EntityType } from "@anonly/anonymization-core";

/**
 * El candidato que gana por default (ADR-083 §4). Espejo de
 * `defaultCandidateType` del motor: mayor `confidence`, empate a `regex`.
 *
 * A diferencia de la versión anterior, **no se ramifica por `ConflictReason`**:
 * la regla de `disagree` ("gana regex siempre") y la de `overlap` ("mayor
 * confidence, empate a regex") son la misma cosa dado que regex vale 1.0, y
 * tener dos ramas invitaba a que se desincronizaran del motor.
 */
export function defaultCandidate(conflict: Conflict): ConflictCandidate {
  const [first, ...rest] = conflict.candidates;
  if (first === undefined) {
    // Invariante de 03_Data_Model.md §15: "candidates.length >= 2". Si esto
    // ocurre, el snapshot violó su propio contrato antes de llegar acá.
    throw new Error("Conflict.candidates no puede estar vacío (03_Data_Model.md §15).");
  }

  return rest.reduce((best, candidate) => {
    if (candidate.confidence > best.confidence) return candidate;
    if (candidate.confidence === best.confidence && candidate.source === DetectionSource.Regex) {
      return candidate;
    }
    return best;
  }, first);
}

/**
 * Los tipos distintos entre los candidatos, ordenados por `confidence`
 * descendente (ADR-083 §5): el primero es el default y el que el diálogo
 * preselecciona.
 *
 * Devuelve **un solo** elemento cuando todos los candidatos comparten tipo —
 * posible en `low_confidence` y `ambiguous_canonical`, cuyos conflictos no son
 * sobre la clasificación. Ahí el diálogo no ofrece elección y solo permite
 * descartar el aviso.
 */
export function candidateTypes(conflict: Conflict): ReadonlyArray<EntityType> {
  const ordered = [...conflict.candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.source === b.source) return 0;
    return a.source === DetectionSource.Regex ? -1 : 1;
  });

  const seen = new Set<EntityType>();
  const types: EntityType[] = [];
  for (const candidate of ordered) {
    if (seen.has(candidate.entityType)) continue;
    seen.add(candidate.entityType);
    types.push(candidate.entityType);
  }
  return types;
}

/**
 * ADR-106: las escrituras empatadas de un `ambiguous_canonical`, sin repetir y
 * en el orden en que el motor las reportó.
 *
 * `raiseAmbiguousCanonicalConflict` (`grouping-engine`) arma **un candidato por
 * cada forma** que empató, con su `value`. El dato siempre estuvo: la UI
 * mostraba `candidates[0]` y nada más, así que el aviso decía que había varias
 * formas sin decir cuáles.
 */
export function spellingChoices(conflict: Conflict): ReadonlyArray<string> {
  return [...new Set(conflict.candidates.map((candidate) => candidate.value))];
}

export interface ManualOverlapCandidates {
  readonly manual: ConflictCandidate;
  readonly detected: ConflictCandidate;
}

/**
 * ADR-174 §4 / `Components.md` §6.3: los dos candidatos que
 * `ManualOverlapDialog` muestra — la ocurrencia manual retenida
 * (`DetectionSource.Manual`, "lo que marcaste") contra la detección con la
 * que chocó ("lo que ya estaba detectado"). Solo tiene sentido en un
 * conflicto con `Conflict.heldManual` (`03_Data_Model.md` §15); en cualquier
 * otro no hay por qué haber un candidato `Manual`, y se devuelve `null` en
 * vez de asumir una forma que el conflicto no tiene.
 */
export function manualOverlapCandidates(conflict: Conflict): ManualOverlapCandidates | null {
  const manual = conflict.candidates.find(
    (candidate) => candidate.source === DetectionSource.Manual,
  );
  const detected = conflict.candidates.find(
    (candidate) => candidate.source !== DetectionSource.Manual,
  );
  if (manual === undefined || detected === undefined) return null;
  return { manual, detected };
}

/**
 * ADR-175 §4: los conflictos `heldManual` sin resolver de **una** fila
 * (`groupId`), en el orden en que aparecen en `conflicts` — un mismo grupo
 * detectado puede chocar con más de un agregado manual a la vez. `ConflictBadge`
 * los usa para decidir si abre `ManualOverlapDialog` (con todos) en vez de
 * `ConflictDialog`.
 */
export function heldManualConflictIdsForGroup(
  conflicts: ReadonlyArray<Conflict>,
  groupId: string,
): ReadonlyArray<string> {
  return conflicts
    .filter(
      (conflict) =>
        conflict.groupId === groupId && conflict.heldManual === true && !conflict.resolved,
    )
    .map((conflict) => conflict.id);
}

/**
 * ADR-175 §1 / `Components.md` §3.5 (menú ⋯, "Eliminar entidad"): si eliminar
 * el grupo **detectado** de un conflicto `heldManual` lo resuelve solo —se
 * oculta la ocurrencia retenida en vez de quedar colgada—, el toast de
 * "Eliminar entidad" lo dice. Puro: compara el conflicto retenido de ese
 * grupo antes del pedido contra el mismo id después; si pasó a `resolved`,
 * devuelve el valor de lo que el usuario había marcado.
 */
export function removedGroupOverlapReveal(params: {
  readonly conflictsBefore: ReadonlyArray<Conflict>;
  readonly conflictsAfter: ReadonlyArray<Conflict>;
  readonly groupId: string;
}): { readonly value: string } | null {
  const before = params.conflictsBefore.find(
    (conflict) =>
      conflict.groupId === params.groupId && conflict.heldManual === true && !conflict.resolved,
  );
  if (before === undefined) return null;
  const after = params.conflictsAfter.find((conflict) => conflict.id === before.id);
  if (after === undefined || !after.resolved) return null;
  const candidates = manualOverlapCandidates(before);
  if (candidates === null) return null;
  return { value: candidates.manual.value };
}
