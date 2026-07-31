/**
 * `conflictLabels.ts` — etiquetas legibles (es) para `ConflictReason` y
 * `DetectionSource`, usadas por `ConflictDialog` (`ui/UX_Guidelines.md` §6:
 * "Tipo: Overlap (bbox compartido)", "Regex: DNI (confidence 1.0)").
 * Presentacional puro, mismo criterio que `entities/entityTypeLabels.ts`.
 */

import { ConflictReason, DetectionSource } from "@anonly/anonymization-core";

export const CONFLICT_REASON_LABEL: Readonly<Record<ConflictReason, string>> = {
  [ConflictReason.Overlap]: "Superposición (bbox compartido)",
  [ConflictReason.Disagree]: "Desacuerdo entre detectores",
  [ConflictReason.LowConfidence]: "Confianza baja",
  [ConflictReason.AmbiguousCanonical]: "Valor canónico ambiguo",
};

export const DETECTION_SOURCE_LABEL: Readonly<Record<DetectionSource, string>> = {
  [DetectionSource.Regex]: "Regex",
  [DetectionSource.NER]: "NER",
  [DetectionSource.OCR]: "OCR",
  [DetectionSource.Manual]: "Manual",
};
