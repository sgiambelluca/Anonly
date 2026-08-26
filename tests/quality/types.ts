/**
 * Tipos del evaluador de recall/precisión (ADR-095). Espejan el formato de
 * `tests/fixtures/reference/*.truth.json` y `manifest.json`
 * (`tests/fixtures/README.md` "Dataset de referencia") y la forma mínima que
 * necesita la regla de matcheo de ADR-095 §1: una entidad esperada es un
 * `(entityType, value, pageIndex, detector)`, y una detección real es un
 * `(entityType, value, pageIndex, source)` — el mismo shape, sin el campo que
 * no tiene sentido del otro lado.
 */
import type { DetectionSource, EntityType } from "@anonly/shared";

export type TruthDetector = "regex" | "ner";

export interface TruthEntity {
  readonly entityType: EntityType;
  readonly value: string;
  readonly pageIndex: number;
  readonly detector: TruthDetector;
}

export interface DocumentTruth {
  readonly documentId: string;
  readonly entities: ReadonlyArray<TruthEntity>;
}

export type DatasetCategory = "dense" | "sparse" | "trap" | "empty";

export interface ManifestEntry {
  readonly documentId: string;
  readonly pdf: string;
  readonly truth: string;
  readonly category: DatasetCategory;
  readonly entityCount: number;
}

export interface ReferenceManifest {
  readonly documents: ReadonlyArray<ManifestEntry>;
}

/**
 * Una detección real del pipeline: el valor de UNA ocurrencia (no de un
 * grupo — `classifyGroups` ya resolvió cada miembro a su `Occurrence`) y la
 * página donde apareció. `source` es el detector real que la produjo
 * (`DetectionSource.Regex` | `.NER` | `.Manual`).
 */
export interface DetectedEntity {
  readonly entityType: EntityType;
  readonly value: string;
  readonly pageIndex: number;
  readonly source: DetectionSource;
}
