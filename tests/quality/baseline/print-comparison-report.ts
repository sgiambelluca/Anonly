/**
 * Formatea un `ComparisonResult` (`compare.ts`) para consola — el mismo rol
 * que `print-report.ts` cumple para `EvaluationReport`, pero separado: los
 * dos shapes no comparten campos y mezclarlos en un solo archivo obligaría a
 * `print-report.ts` a conocer un tipo que no le pertenece. `console.*` en
 * `tests/` es la salida de la herramienta (P-4/Code_Standards.md §9 rige
 * `packages/`, no `tests/`).
 */
import type { ComparisonFailure, ComparisonResult } from "./compare.js";

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatFailure(failure: ComparisonFailure): string {
  const location = [
    failure.documentId !== undefined ? `documento=${failure.documentId}` : undefined,
    failure.entityId !== undefined ? `entidad=${failure.entityId}` : undefined,
  ].filter((part): part is string => part !== undefined);
  const suffix = location.length > 0 ? ` [${location.join(", ")}]` : "";
  return `  - (${failure.kind}) ${failure.message}${suffix}`;
}

export function formatComparisonReport(result: ComparisonResult): string {
  const lines: string[] = [
    result.ok
      ? "Comparación contra la baseline: OK — sin regresiones."
      : `Comparación contra la baseline: FALLÓ — ${result.failures.length} razón(es).`,
  ];

  if (result.summary !== undefined) {
    lines.push(
      "",
      `Documentos comparados: ${result.summary.documentsCompared}`,
      `Cobertura baseline:    ${pct(result.summary.baselineCoverageRate)}`,
      `Cobertura candidato:   ${pct(result.summary.candidateCoverageRate)}`,
    );
  }

  if (result.failures.length > 0) {
    lines.push("", "Razones:");
    for (const failure of result.failures) lines.push(formatFailure(failure));
  }

  return lines.join("\n");
}
