/**
 * Formatea el `EvaluationReport` para consola. `console.*` en `tests/` es la
 * salida de la herramienta (P-4/Code_Standards.md §9 rige `packages/`, no
 * `tests/`) — es la forma en que este evaluador reporta, ADR-095 §6.
 */
import type { EvaluationReport } from "./evaluate.js";

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/*
 * Un "1 falso positivo" sin decir DÓNDE no sirve para actuar. Se listan los
 * documentos que aportaron fallos —de recall o de precisión— para que el
 * número lleve a un archivo concreto en vez de a una búsqueda.
 */
function formatOffenders(report: EvaluationReport): ReadonlyArray<string> {
  const lines: string[] = [];

  const conFalsosPositivos = report.perDocument.filter((doc) => doc.falsePositiveCount > 0);
  if (conFalsosPositivos.length > 0) {
    lines.push("", "Documentos con falsos positivos:");
    for (const doc of conFalsosPositivos) {
      lines.push(`  ${doc.documentId}: ${doc.falsePositiveCount}`);
    }
  }

  const conFaltantes = report.perDocument.filter(
    (doc) => doc.regexCoveredCount < doc.regexTruthCount,
  );
  if (conFaltantes.length > 0) {
    lines.push("", "Documentos con entidades de Regex sin cubrir:");
    for (const doc of conFaltantes) {
      lines.push(`  ${doc.documentId}: ${doc.regexTruthCount - doc.regexCoveredCount} sin cubrir`);
    }
  }

  return lines;
}

export function formatReport(report: EvaluationReport): string {
  const { regex, precision } = report;
  const truePositives = precision.totalDetections - precision.falsePositiveCount;

  return [
    `Dataset de referencia (tests/fixtures/reference/) — ${report.documentCount} documentos`,
    "",
    "Regex — único detector activo (NER off, ADR-095 §5):",
    `  recall de cobertura: ${regex.coveredCount}/${regex.totalTruthEntities} (${pct(regex.coverageRecall)})`,
    `  recall tipado:       ${regex.typedCoveredCount}/${regex.totalTruthEntities} (${pct(regex.typedRecall)})`,
    `  precisión:           ${truePositives}/${precision.totalDetections} (${pct(precision.precision)})`,
    "",
    `Entidades detector:"ner" excluidas del recall de Regex (ADR-095 §5): ${report.nerExcludedCount}`,
    `Sugerencias (ADR-094 — grupos enabled:false + needsReview:true, ADR-095 §4): ${report.suggestionCount}`,
    ...formatOffenders(report),
  ].join("\n");
}
