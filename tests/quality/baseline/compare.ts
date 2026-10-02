/**
 * El comparador de baselines (ADR-147 §3/§4/§9). Puro, sin I/O: recibe dos
 * `DetectionBaseline` (`baseline`, la referencia revisada; `candidate`, la
 * medición nueva) y devuelve un veredicto con TODAS las razones de fallo, no
 * solo la primera — el caller (`gate.ts`) decide si aborta con la primera o
 * las junta todas para el reporte.
 *
 * Regla central (ADR-147 §3, primer punto): una entidad `covered: true` en la
 * baseline que no lo está en el candidato es SIEMPRE una regresión, sin
 * importar qué pasó con el resto. La comparación es por entidad individual,
 * documento por documento — nunca agregada ni promediada entre documentos:
 * una mejora en un documento no compensa una pérdida en otro (ADR-147 §3,
 * último párrafo). Por eso este archivo no suma coberturas entre documentos
 * para decidir `ok`; los únicos totales que calcula (`summary`) son
 * informativos, nunca entran en la decisión.
 */
import type { BaselineDocument, BaselineEntity, DetectionBaseline } from "./schema.js";

export type ComparisonFailureKind =
  | "identity-mismatch"
  | "empty-corpus"
  | "missing-document"
  | "failed-document"
  | "denominator-mismatch"
  | "new-false-positives"
  | "lost-coverage"
  | "invalid-metric";

export interface ComparisonFailure {
  readonly kind: ComparisonFailureKind;
  readonly message: string;
  readonly documentId?: string;
  readonly entityId?: string;
}

export interface ComparisonSummary {
  /** Documentos presentes en ambos lados — el resto ya está en `failures` como "missing-document". */
  readonly documentsCompared: number;
  readonly baselineCoverageRate: number;
  readonly candidateCoverageRate: number;
}

export interface ComparisonResult {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<ComparisonFailure>;
  /**
   * Ausente cuando la identidad no coincide: sin runtime/modelo/corpus
   * comparables, ningún total de cobertura significa nada (ver
   * `validateIdentity`).
   */
  readonly summary?: ComparisonSummary;
}

/**
 * Tolerancia opcional POR MÉTRICA (ADR-147 §4: "sin tolerancia implícita").
 * Sin este parámetro, o con `{}`, el comparador se comporta con tolerancia
 * cero — `tolerances.falsePositiveCount ?? 0` en vez de una constante propia.
 *
 * Solo cubre `falsePositiveCount`: la pérdida de cobertura (la regla central)
 * NO tiene tolerancia configurable a propósito — ofrecer un slider ahí
 * convertiría "perder un identificador cubierto" en un número negociable, que
 * es exactamente lo que ADR-147 §3 dice que no puede ser.
 */
export interface ComparatorTolerances {
  readonly falsePositiveCount?: number;
}

/**
 * `0/0` no es un fallo (mismo criterio que `evaluate.ts`'s `safeRatio`,
 * ADR-095 §Validación): un documento `expectedEntityCount: 0` (categoría
 * "empty"/"trampa", ver `DatasetCategory`) no tiene nada que cubrir, y eso no
 * es una división que explote en `NaN`.
 */
function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

/**
 * ADR-147 §6: "el comparador EXIGE que coincida" — dicho explícitamente del
 * runtime. Acá se extiende el mismo tratamiento a `modelHash` y `corpusHash`
 * (decisión de esta implementación, más estricta = más segura, documentada
 * en el reporte de la tarea): si cualquiera de los tres difiere, comparar
 * cobertura no tiene sentido — los ids de entidad y los denominadores
 * dependen del corpus, y el recall depende del modelo. `modelId` y
 * `effectiveConfig`/`commit` quedan como informativos (no exigidos): `modelId`
 * es redundante con `modelHash` (si el hash coincide, el id lo hace por
 * construcción — ver `identity.ts`), y `effectiveConfig`/`commit` describen
 * CÓMO se corrió, no QUÉ se corrió.
 */
function validateIdentity(
  baseline: DetectionBaseline,
  candidate: DetectionBaseline,
): ReadonlyArray<ComparisonFailure> {
  const failures: ComparisonFailure[] = [];

  if (baseline.identity.runtime !== candidate.identity.runtime) {
    failures.push({
      kind: "identity-mismatch",
      message:
        `runtime distinto (baseline="${baseline.identity.runtime}", ` +
        `candidato="${candidate.identity.runtime}"): rebaseline explícito requerido.`,
    });
  }
  if (baseline.identity.modelHash !== candidate.identity.modelHash) {
    failures.push({
      kind: "identity-mismatch",
      message:
        `modelHash distinto (baseline="${baseline.identity.modelHash}", ` +
        `candidato="${candidate.identity.modelHash}"): corpus/modelo distinto, rebaseline explícito requerido.`,
    });
  }
  if (baseline.identity.corpusHash !== candidate.identity.corpusHash) {
    failures.push({
      kind: "identity-mismatch",
      message:
        `corpusHash distinto (baseline="${baseline.identity.corpusHash}", ` +
        `candidato="${candidate.identity.corpusHash}"): corpus/modelo distinto, rebaseline explícito requerido.`,
    });
  }

  return failures;
}

function isFiniteCount(value: number): boolean {
  return Number.isFinite(value);
}

function compareDocumentMetrics(
  documentId: string,
  baseDoc: BaselineDocument,
  candDoc: BaselineDocument,
  tolerances: ComparatorTolerances,
): ComparisonFailure[] {
  const failures: ComparisonFailure[] = [];

  if (
    !isFiniteCount(baseDoc.expectedEntityCount) ||
    !isFiniteCount(candDoc.expectedEntityCount) ||
    !isFiniteCount(baseDoc.falsePositiveCount) ||
    !isFiniteCount(candDoc.falsePositiveCount)
  ) {
    failures.push({
      kind: "invalid-metric",
      documentId,
      message: `"${documentId}" tiene un conteo no numérico (NaN/Infinity) en baseline o candidato.`,
    });
  }

  if (baseDoc.ok === false) {
    failures.push({
      kind: "failed-document",
      documentId,
      message: `"${documentId}" falló en la baseline (ok:false).`,
    });
  }
  if (candDoc.ok === false) {
    failures.push({
      kind: "failed-document",
      documentId,
      message: `"${documentId}" falló en el candidato (ok:false).`,
    });
  }

  if (baseDoc.expectedEntityCount !== candDoc.expectedEntityCount) {
    failures.push({
      kind: "denominator-mismatch",
      documentId,
      message:
        `expectedEntityCount cambió en "${documentId}": baseline=${baseDoc.expectedEntityCount}, ` +
        `candidato=${candDoc.expectedEntityCount}. El corpus cambió: exige rebaseline explícito, no un ajuste silencioso.`,
    });
  }

  const falsePositiveTolerance = tolerances.falsePositiveCount ?? 0;
  if (candDoc.falsePositiveCount > baseDoc.falsePositiveCount + falsePositiveTolerance) {
    failures.push({
      kind: "new-false-positives",
      documentId,
      message:
        `Falsos positivos aumentaron en "${documentId}": baseline=${baseDoc.falsePositiveCount}, ` +
        `candidato=${candDoc.falsePositiveCount}.`,
    });
  }

  return failures;
}

/**
 * La regla central (ADR-147 §3, primer punto). Solo mira entidades
 * `covered: true` en la baseline: una que ya no estaba cubierta y sigue sin
 * estarlo no es una regresión (aunque tampoco es una mejora).
 */
function compareDocumentCoverage(
  documentId: string,
  baseDoc: BaselineDocument,
  candDoc: BaselineDocument,
): ComparisonFailure[] {
  const failures: ComparisonFailure[] = [];
  const candEntitiesById = new Map<string, BaselineEntity>(
    candDoc.entities.map((entity) => [entity.id, entity]),
  );

  for (const entity of baseDoc.entities) {
    if (!entity.covered) continue;

    const candEntity = candEntitiesById.get(entity.id);
    if (candEntity === undefined) {
      failures.push({
        kind: "lost-coverage",
        documentId,
        entityId: entity.id,
        message:
          `Entidad "${entity.id}" (${entity.entityType}, página ${entity.pageIndex}) estaba cubierta ` +
          `en la baseline y no aparece en el candidato.`,
      });
      continue;
    }
    if (!candEntity.covered) {
      failures.push({
        kind: "lost-coverage",
        documentId,
        entityId: entity.id,
        message:
          `Entidad "${entity.id}" (${entity.entityType}, página ${entity.pageIndex}) perdió cobertura: ` +
          `estaba cubierta en la baseline y no lo está en el candidato.`,
      });
    }
  }

  return failures;
}

function countCovered(doc: BaselineDocument): number {
  return doc.entities.filter((entity) => entity.covered).length;
}

/** Compara `baseline` contra `candidate`. Ver cabecera del archivo. */
export function compareBaselines(
  baseline: DetectionBaseline,
  candidate: DetectionBaseline,
  tolerances: ComparatorTolerances = {},
): ComparisonResult {
  const identityFailures = validateIdentity(baseline, candidate);
  if (identityFailures.length > 0) {
    // ADR-147 §6: "NO se intenta comparar cobertura entre runtimes distintos"
    // — se extiende a modelo/corpus por el mismo motivo (ver
    // `validateIdentity`). Ningún total de `summary` significaría nada acá.
    return { ok: false, failures: identityFailures };
  }

  const failures: ComparisonFailure[] = [];

  if (baseline.documents.length === 0) {
    failures.push({ kind: "empty-corpus", message: "La baseline no tiene documentos." });
  }
  if (candidate.documents.length === 0) {
    failures.push({ kind: "empty-corpus", message: "El candidato no tiene documentos." });
  }

  const baseById = new Map<string, BaselineDocument>(
    baseline.documents.map((doc) => [doc.documentId, doc]),
  );
  const candById = new Map<string, BaselineDocument>(
    candidate.documents.map((doc) => [doc.documentId, doc]),
  );

  for (const documentId of baseById.keys()) {
    if (!candById.has(documentId)) {
      failures.push({
        kind: "missing-document",
        documentId,
        message: `"${documentId}" está en la baseline pero falta en el candidato.`,
      });
    }
  }
  for (const documentId of candById.keys()) {
    if (!baseById.has(documentId)) {
      failures.push({
        kind: "missing-document",
        documentId,
        message: `"${documentId}" está en el candidato pero no en la baseline (asimetría del corpus).`,
      });
    }
  }

  let documentsCompared = 0;
  let totalBaselineCovered = 0;
  let totalCandidateCovered = 0;
  let totalEntities = 0;

  for (const [documentId, baseDoc] of baseById) {
    const candDoc = candById.get(documentId);
    if (candDoc === undefined) continue; // ya reportado arriba como missing-document

    documentsCompared += 1;
    failures.push(...compareDocumentMetrics(documentId, baseDoc, candDoc, tolerances));
    // Por entidad, nunca agregado entre documentos (ver cabecera del archivo).
    failures.push(...compareDocumentCoverage(documentId, baseDoc, candDoc));

    totalEntities += baseDoc.entities.length;
    totalBaselineCovered += countCovered(baseDoc);
    totalCandidateCovered += countCovered(candDoc);
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      documentsCompared,
      baselineCoverageRate: safeRatio(totalBaselineCovered, totalEntities),
      candidateCoverageRate: safeRatio(totalCandidateCovered, totalEntities),
    },
  };
}
