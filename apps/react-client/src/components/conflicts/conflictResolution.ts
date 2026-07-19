/**
 * `conflictResolution.ts` — cómputo puro del candidato "sugerido" que
 * `ConflictDialog` muestra como texto informativo (`ui/UX_Guidelines.md` §6:
 * "Resolución sugerida: Regex (mayor confidence + determinístico)").
 *
 * Replica, **solo para mostrar en la UI** (no para decidir nada: la resolución
 * real ya la aplicó el Grouping Engine de forma automática antes de que el
 * usuario abra este diálogo — `architecture/06_Pipeline.md` §9), la política
 * de resolución default documentada en `06_Pipeline.md` §9:
 * - `overlap`: gana el de mayor `confidence`; empate → `source === regex`.
 * - `disagree`: gana `regex`.
 * - `low_confidence` / `ambiguous_canonical`: el primer candidato (arbitrario,
 *   así documentado en `06_Pipeline.md` §9 y §13 caso 10).
 *
 * Nota de ambigüedad (ver reporte del PR): `ui/UX_Guidelines.md` §6 muestra
 * botones "[Usar Regex] [Usar NER]" que emitirían `CONFLICT_RESOLVE_REQUESTED`
 * "con el modo elegido", pero el payload real de ese evento
 * (`core/Contracts.md` líneas 646/705, `architecture/04_Event_System.md` §10
 * línea 144) es `{ documentId, conflictId, mode: ReplacementMode }` —
 * `ReplacementMode` no tiene valores "regex"/"ner" (solo
 * mask/synthetic/placeholder/redact), y no existe ningún otro campo en
 * `ConflictResolveRequested` para expresar "qué candidato/fuente gana". Este
 * módulo y `ConflictDialog` solo implementan el flujo "Personalizado" (elegir
 * un `ReplacementMode` real y confirmar), que sí es consistente con el
 * contrato; los botones de atajo por fuente no se implementan pendiente de
 * aclaración.
 */

import { ConflictReason, DetectionSource } from "@anonly/anonymization-core";
import type { Conflict, ConflictCandidate } from "@anonly/anonymization-core";

export function suggestedCandidate(conflict: Conflict): ConflictCandidate {
  const [first, ...rest] = conflict.candidates;
  if (first === undefined) {
    // Invariante de 03_Data_Model.md §15: "candidates.length >= 2". Si esto
    // ocurre, el snapshot violó su propio contrato antes de llegar acá.
    throw new Error("Conflict.candidates no puede estar vacío (03_Data_Model.md §15).");
  }

  if (conflict.reason === ConflictReason.Overlap) {
    return rest.reduce((best, candidate) => {
      if (candidate.confidence > best.confidence) return candidate;
      if (candidate.confidence === best.confidence && candidate.source === DetectionSource.Regex) {
        return candidate;
      }
      return best;
    }, first);
  }

  if (conflict.reason === ConflictReason.Disagree) {
    return (
      conflict.candidates.find((candidate) => candidate.source === DetectionSource.Regex) ?? first
    );
  }

  // low_confidence / ambiguous_canonical: arbitrario, el primero (06_Pipeline.md §9/§13 caso 10).
  return first;
}
