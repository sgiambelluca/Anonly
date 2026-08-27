/**
 * Agregación de la regla de matcheo (`matching.ts`) en los números que pide
 * ADR-095 §2-§5: recall de cobertura, recall tipado, precisión, sugerencias,
 * y cuántas entidades de `detector: "ner"` quedaron fuera del recall de
 * Regex. Puro: opera sobre `DocumentTruth` + `DetectedEntity[]` ya
 * extraídos, sin tocar el pipeline.
 */
import { isCovered, isFalsePositive, isTypedCovered } from "./matching.js";
import type { DetectedEntity, DocumentTruth } from "./types.js";

export interface DocumentEvaluation {
  readonly documentId: string;
  readonly regexTruthCount: number;
  readonly regexCoveredCount: number;
  readonly regexTypedCoveredCount: number;
  /**
   * Entidades `detector: "ner"` del ground truth. Con NER apagado son las que
   * quedan FUERA del recall (ADR-095 §5); con NER encendido son su
   * denominador. El número es el mismo; qué significa lo decide quién corrió.
   */
  readonly nerTruthCount: number;
  readonly nerCoveredCount: number;
  readonly nerTypedCoveredCount: number;
  readonly detectionCount: number;
  readonly falsePositiveCount: number;
  readonly suggestionCount: number;
  /**
   * Los valores esperados de Regex que NINGUNA detección cubrió. Es la parte
   * accionable del reporte: "4 sin cubrir" manda a buscar, "estas cuatro
   * formas" manda a un patrón concreto.
   */
  readonly missedValues: ReadonlyArray<string>;
  /** Igual que `missedValues`, para las entidades de NER. */
  readonly nerMissedValues: ReadonlyArray<string>;
}

/**
 * Evalúa un documento. `detections`/`suggestionCount` ya vienen filtrados
 * por `classifyGroups` (ADR-095 §4: solo grupos habilitados cuentan).
 *
 * Las entidades del truth con `detector: "ner"` se excluyen del recall de
 * Regex (ADR-095 §5): con NER apagado ningún detector activo podía
 * encontrarlas, así que contarlas como fallo haría que el número mienta en
 * la dirección de "el motor es peor de lo que es". `nerTruthCount` es
 * exactamente cuántas quedaron fuera por eso.
 *
 * Con NER encendido (`tests/measure/`, en un browser) esas mismas entidades
 * SÍ se miden: `nerCoveredCount`/`nerTypedCoveredCount` son su recall. El
 * cálculo es el mismo en los dos casos —la regla de matcheo no cambia— y lo
 * único que decide si el número es un recall o un "cuántas quedaron fuera"
 * es si el detector corrió.
 *
 * La precisión (§3) se mide contra **todas** las entidades esperadas de la
 * página, regex y ner por igual: lo que decide si una detección es falso
 * positivo es si toca algo real, no si el detector correspondiente estaba
 * activo.
 */
export function evaluateDocument(
  truth: DocumentTruth,
  detections: ReadonlyArray<DetectedEntity>,
  suggestionCount: number,
): DocumentEvaluation {
  const regexTruth = truth.entities.filter((entity) => entity.detector === "regex");
  const nerTruth = truth.entities.filter((entity) => entity.detector === "ner");

  const regexCoveredCount = regexTruth.filter((entity) => isCovered(entity, detections)).length;
  const regexTypedCoveredCount = regexTruth.filter((entity) =>
    isTypedCovered(entity, detections),
  ).length;
  const falsePositiveCount = detections.filter((detection) =>
    isFalsePositive(detection, truth.entities),
  ).length;

  const nerCoveredCount = nerTruth.filter((entity) => isCovered(entity, detections)).length;
  const nerTypedCoveredCount = nerTruth.filter((entity) =>
    isTypedCovered(entity, detections),
  ).length;

  const missedValues = regexTruth
    .filter((entity) => !isCovered(entity, detections))
    .map((entity) => `${entity.entityType} ${JSON.stringify(entity.value)}`);
  const nerMissedValues = nerTruth
    .filter((entity) => !isCovered(entity, detections))
    .map((entity) => `${entity.entityType} ${JSON.stringify(entity.value)}`);

  return {
    documentId: truth.documentId,
    regexTruthCount: regexTruth.length,
    regexCoveredCount,
    regexTypedCoveredCount,
    nerTruthCount: nerTruth.length,
    nerCoveredCount,
    nerTypedCoveredCount,
    detectionCount: detections.length,
    falsePositiveCount,
    suggestionCount,
    missedValues,
    nerMissedValues,
  };
}

export interface DetectorReport {
  readonly totalTruthEntities: number;
  readonly coveredCount: number;
  readonly typedCoveredCount: number;
  readonly coverageRecall: number;
  readonly typedRecall: number;
}

export interface PrecisionReport {
  readonly totalDetections: number;
  readonly falsePositiveCount: number;
  readonly precision: number;
}

export interface EvaluationReport {
  readonly documentCount: number;
  readonly regex: DetectorReport;
  /**
   * Las entidades `detector: "ner"` del ground truth. Solo es un RECALL si
   * NER corrió de verdad (`tests/measure/`); con NER apagado
   * (`tests/quality/`, ADR-095 §5) `coveredCount` es 0 por construcción y lo
   * único que informa es `totalTruthEntities`, o sea cuántas quedaron fuera.
   */
  readonly ner: DetectorReport;
  readonly precision: PrecisionReport;
  readonly suggestionCount: number;
  readonly perDocument: ReadonlyArray<DocumentEvaluation>;
}

/**
 * `0/0` no es un fallo del dataset (los documentos "vacíos"/"trampa" del
 * dataset lo producen a propósito) sino la ausencia de la pregunta: sin
 * denominador, no hay nada que haya salido mal. ADR-095 §Validación lo pide
 * explícito para precisión ("uno en el que no detecta nada produce precisión
 * 1 sin dividir por cero"); se aplica con el mismo criterio a los recalls.
 */
function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

interface Totals {
  readonly regexTruthCount: number;
  readonly regexCoveredCount: number;
  readonly regexTypedCoveredCount: number;
  readonly nerTruthCount: number;
  readonly nerCoveredCount: number;
  readonly nerTypedCoveredCount: number;
  readonly detectionCount: number;
  readonly falsePositiveCount: number;
  readonly suggestionCount: number;
}

const EMPTY_TOTALS: Totals = {
  regexTruthCount: 0,
  regexCoveredCount: 0,
  regexTypedCoveredCount: 0,
  nerTruthCount: 0,
  nerCoveredCount: 0,
  nerTypedCoveredCount: 0,
  detectionCount: 0,
  falsePositiveCount: 0,
  suggestionCount: 0,
};

function sumTotals(a: Totals, doc: DocumentEvaluation): Totals {
  return {
    regexTruthCount: a.regexTruthCount + doc.regexTruthCount,
    regexCoveredCount: a.regexCoveredCount + doc.regexCoveredCount,
    regexTypedCoveredCount: a.regexTypedCoveredCount + doc.regexTypedCoveredCount,
    nerTruthCount: a.nerTruthCount + doc.nerTruthCount,
    nerCoveredCount: a.nerCoveredCount + doc.nerCoveredCount,
    nerTypedCoveredCount: a.nerTypedCoveredCount + doc.nerTypedCoveredCount,
    detectionCount: a.detectionCount + doc.detectionCount,
    falsePositiveCount: a.falsePositiveCount + doc.falsePositiveCount,
    suggestionCount: a.suggestionCount + doc.suggestionCount,
  };
}

/** Suma las evaluaciones por documento en el reporte del dataset entero. */
export function aggregateEvaluations(
  perDocument: ReadonlyArray<DocumentEvaluation>,
): EvaluationReport {
  const totals = perDocument.reduce(sumTotals, EMPTY_TOTALS);

  return {
    documentCount: perDocument.length,
    regex: {
      totalTruthEntities: totals.regexTruthCount,
      coveredCount: totals.regexCoveredCount,
      typedCoveredCount: totals.regexTypedCoveredCount,
      coverageRecall: safeRatio(totals.regexCoveredCount, totals.regexTruthCount),
      typedRecall: safeRatio(totals.regexTypedCoveredCount, totals.regexTruthCount),
    },
    ner: {
      totalTruthEntities: totals.nerTruthCount,
      coveredCount: totals.nerCoveredCount,
      typedCoveredCount: totals.nerTypedCoveredCount,
      coverageRecall: safeRatio(totals.nerCoveredCount, totals.nerTruthCount),
      typedRecall: safeRatio(totals.nerTypedCoveredCount, totals.nerTruthCount),
    },
    precision: {
      totalDetections: totals.detectionCount,
      falsePositiveCount: totals.falsePositiveCount,
      precision: safeRatio(
        totals.detectionCount - totals.falsePositiveCount,
        totals.detectionCount,
      ),
    },
    suggestionCount: totals.suggestionCount,
    perDocument,
  };
}
