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
function formatOffenders(report: EvaluationReport, nerActive: boolean): ReadonlyArray<string> {
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
    lines.push("", "Entidades de Regex sin cubrir:");
    for (const doc of conFaltantes) {
      lines.push(`  ${doc.documentId}:`);
      for (const missed of doc.missedValues) lines.push(`    ${missed}`);
    }
  }

  if (nerActive) {
    const conFaltantesNer = report.perDocument.filter((doc) => doc.nerMissedValues.length > 0);
    if (conFaltantesNer.length > 0) {
      lines.push("", "Entidades de NER sin cubrir:");
      for (const doc of conFaltantesNer) {
        lines.push(`  ${doc.documentId}:`);
        for (const missed of doc.nerMissedValues) lines.push(`    ${missed}`);
      }
    }
  }

  return lines;
}

/**
 * `detectorLine` describe qué detectores corrieron. Es un parámetro y no una
 * constante porque hay dos consumidores con respuestas distintas:
 * `tests/quality/` corre con NER apagado (ADR-095 §5) y `tests/measure/` lo
 * corre encendido en un browser. Hardcodear "NER off" hacía que el segundo
 * informe afirmara lo contrario de lo que había pasado.
 */
export interface FormatOptions {
  /**
   * `true` cuando NER corrió de verdad (`tests/measure/`, en un browser).
   * Con `false` —el default, `tests/quality/` en Node (ADR-095 §5)— su recall
   * sería 0/N por construcción y publicarlo como métrica sería mentir: se
   * imprime como "cuántas quedaron fuera" en vez de como recall.
   */
  readonly nerActive?: boolean;
}

export function formatReport(report: EvaluationReport, options: FormatOptions = {}): string {
  const { regex, ner, precision } = report;
  const truePositives = precision.totalDetections - precision.falsePositiveCount;
  const nerActive = options.nerActive === true;

  const detectorLine = nerActive
    ? "Regex y NER activos (browser, tests/measure/):"
    : "Regex — único detector activo (NER off, ADR-095 §5):";

  const nerBlock = nerActive
    ? [
        "",
        "NER — informativo en MVP, gate en v1.0 (MVP.md §5):",
        `  recall de cobertura: ${ner.coveredCount}/${ner.totalTruthEntities} (${pct(ner.coverageRecall)})`,
        `  recall tipado:       ${ner.typedCoveredCount}/${ner.totalTruthEntities} (${pct(ner.typedRecall)})`,
      ]
    : [
        "",
        `Entidades detector:"ner" excluidas del recall de Regex (ADR-095 §5): ${ner.totalTruthEntities}`,
      ];

  return [
    `Dataset de referencia (tests/fixtures/reference/) — ${report.documentCount} documentos`,
    "",
    detectorLine,
    `  recall de cobertura: ${regex.coveredCount}/${regex.totalTruthEntities} (${pct(regex.coverageRecall)})`,
    `  recall tipado:       ${regex.typedCoveredCount}/${regex.totalTruthEntities} (${pct(regex.typedRecall)})`,
    `  precisión:           ${truePositives}/${precision.totalDetections} (${pct(precision.precision)})`,
    ...nerBlock,
    "",
    `Sugerencias (ADR-094 — grupos enabled:false + needsReview:true, ADR-095 §4): ${report.suggestionCount}`,
    ...formatOffenders(report, nerActive),
  ].join("\n");
}
