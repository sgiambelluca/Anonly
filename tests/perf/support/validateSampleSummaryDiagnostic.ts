export interface V1PartialDiagnostic {
  readonly expectedRuns: number;
  readonly recordedRuns: number;
  readonly missingRuns: number;
  readonly failedRuns: ReadonlyArray<{
    readonly id: string;
    readonly stage: string;
    readonly kind: string | null;
  }>;
  readonly issues: ReadonlyArray<string>;
}

export function formatIncompleteDiagnostic(
  errorName: string,
  failureStep: string,
  diagnostic: V1PartialDiagnostic | null,
): string {
  return [
    "# M-V1 — diagnóstico incompleto",
    "",
    `Fallo: ${errorName} durante ${failureStep}. No se publican ni reutilizan costos como corridas válidas.`,
    diagnostic === null
      ? "No había un diagnóstico seguro completo antes del fallo."
      : `Esperadas ${diagnostic.expectedRuns}; registradas ${diagnostic.recordedRuns}; faltantes ${diagnostic.missingRuns}; fallidas ${diagnostic.failedRuns.length}; issues ${diagnostic.issues.length}.`,
    ...(diagnostic?.failedRuns.map(
      (run) => `Falla observada: ${run.id}, ${run.stage}, ${run.kind ?? "sin clasificar"}.`,
    ) ?? []),
    ...(diagnostic?.issues.map((issue) => `Diagnóstico seguro: ${issue}.`) ?? []),
    "",
    "INCOMPLETA — este resumen no valida una campaña ni permite copiar sus métricas.",
  ].join("\n");
}
