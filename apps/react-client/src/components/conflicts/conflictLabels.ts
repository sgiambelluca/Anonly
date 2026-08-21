/**
 * `conflictLabels.ts` — etiquetas legibles (es) para `ConflictReason` y
 * `DetectionSource`. Presentacional puro, mismo criterio que
 * `entities/entityTypeLabels.ts`.
 *
 * **Ninguna nombra el pipeline** (ADR-087 §4, en la línea de ADR-083 §6, que
 * ya había sacado "Regex" y "NER" del panel de conflicto): "bbox",
 * "detectores", "Regex" y "NER" son cómo está construida la herramienta, no
 * qué le pasó al documento.
 *
 * `DetectionSource` colapsa a **dos** etiquetas y no cuatro: al usuario le
 * cambia algo saber si una ocurrencia la agregó él o la encontró la
 * herramienta. Que la haya encontrado un patrón, un modelo de nombres o el
 * reconocimiento de texto no cambia ninguna decisión suya — y las tres son la
 * misma respuesta a "¿de dónde salió esto?": de la detección automática.
 */

import { ConflictReason, DetectionSource } from "@anonly/anonymization-core";

export const CONFLICT_REASON_LABEL: Readonly<Record<ConflictReason, string>> = {
  [ConflictReason.Overlap]: "Dos detecciones se superponen",
  [ConflictReason.Disagree]: "No hay acuerdo sobre qué es",
  [ConflictReason.LowConfidence]: "Detección poco confiable",
  [ConflictReason.AmbiguousCanonical]: "El valor se escribe de varias formas",
};

export const DETECTION_SOURCE_LABEL: Readonly<Record<DetectionSource, string>> = {
  [DetectionSource.Regex]: "Detectado automáticamente",
  [DetectionSource.NER]: "Detectado automáticamente",
  [DetectionSource.OCR]: "Detectado automáticamente",
  [DetectionSource.Manual]: "Agregado por vos",
};
